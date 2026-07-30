import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { sendAutomatedSms } from '$lib/server/sms';

export const POST: RequestHandler = async ({ params, request }) => {
	const { id } = params;
	try {
		const { action, rejectReason } = await request.json();

		const approval = await prisma.commApproval.findUnique({
			where: { id },
			include: { container: { include: { customerProfile: true } } }
		});

		if (!approval) {
			return json({ error: 'Approval not found' }, { status: 404 });
		}

		if (approval.state !== 'pending') {
			return json({ error: 'Approval is not in pending state' }, { status: 400 });
		}

		if (action === 'approve') {
			await prisma.commApproval.update({
				where: { id },
				data: { state: 'approved', approvedBy: 'user' }
			});

			const contextPayload: any = approval.contextPayload || {};
			const companyId = approval.container.companyId;

			// If it's SMS, we send it via sendAutomatedSms and log to the SAME commId thread!
			if (approval.draftType === 'sms') {
				const customerPhone = contextPayload.destination || approval.container.customerProfile?.phoneNumber;
				if (customerPhone) {
					try {
						await sendAutomatedSms(customerPhone, approval.draftContent, contextPayload.source);
						console.log(`[Approval API] SMS approved and sent to ${customerPhone}`);

						// Log outbound SMS under the SAME commId thread (Requirement 3)
						const { logCommunication } = await import('$lib/utils/communication-log');
						await logCommunication({
							type: 'sms',
							direction: 'outbound',
							status: 'success',
							source: contextPayload.source || undefined,
							destination: customerPhone,
							company_id: companyId,
							summary: `Appointment Confirmation (${contextPayload.product || 'Sales Opportunity'})`,
							content: approval.draftContent,
							thread_id: approval.commId,
							metadata: { commId: approval.commId, approvalId: id }
						});
					} catch (e) {
						console.error(`[Approval API] Failed to send SMS on approval:`, e);
						return json({ error: 'Failed to send SMS' }, { status: 500 });
					}
				}
			}
			// Email: attempt to send the confirmation (Requirement 5)
			if (approval.draftType === 'email') {
				const cp: any = approval.contextPayload || {};
				const to = cp.extractedEmail || approval.container.customerProfile?.email || null;
				const contactId = approval.container.customerProfile?.id;
				if (to) {
					try {
						const { sendEmail } = await import('$lib/server/brevo');
						const raw = approval.draftContent || '';
						const subjMatch = raw.match(/^\s*Subject:\s*(.+)$/im);
						const subject = subjMatch
							? subjMatch[1].trim()
							: cp.subject || `Appointment Confirmation - ${cp.product || 'Sales Opportunity'}`;
						const body = raw.replace(/^\s*Subject:\s*.+$/im, '').trim();
						let htmlContent = `<div style="font-family:sans-serif;white-space:pre-wrap">${body
							.replace(/&/g, '&amp;')
							.replace(/</g, '&lt;')
							.replace(/\n/g, '<br>')}</div>`;
						if (contactId) {
							const { injectEmailTracking } = await import('$lib/server/email/tracking-inject');
							const result = await injectEmailTracking(htmlContent, contactId, companyId);
							htmlContent = result.htmlContent;
						}
						await sendEmail({
							to: [{ email: to }],
							subject,
							htmlContent
						});
						console.log(`[Approval API] Email approved and sent to ${to}`);

						// Log outbound Email under the SAME commId thread (Requirement 3)
						const { logCommunication } = await import('$lib/utils/communication-log');
						await logCommunication({
							type: 'email',
							direction: 'outbound',
							status: 'success',
							destination: to,
							company_id: companyId,
							summary: subject,
							content: body,
							thread_id: approval.commId,
							metadata: { commId: approval.commId, approvalId: id, subject }
						});
					} catch (e) {
						console.error(`[Approval API] Email send failed (continuing to booking):`, e);
					}
				} else {
					console.warn('[Approval API] Email draft approved but no recipient email on file — skipping send.');
				}
			}

			let booking: { status: string; htmlLink?: string | null } = { status: 'not_attempted' };
			if (contextPayload.proposedDate) {
				const attendee = contextPayload.extractedEmail || null;
				const phone = approval.container.customerProfile?.phoneNumber || null;
				let contactName = approval.container.customerProfile?.name;
				if (!contactName && phone) {
					const c = await prisma.contact.findFirst({
						where: { companyId, OR: [{ phone }, { cell: phone }] },
						select: { name: true }
					});
					if (c?.name) contactName = c.name;
				}
				const displayName = contactName || phone || 'Customer';
				const reason = contextPayload.booking_reason || contextPayload.product || contextPayload.purpose || contextPayload.sub_intent || 'Sales Opportunity';
				const description = `Subject / Reason: ${reason}\n\nDraft Content:\n${approval.draftContent || 'N/A'}\n\nBooked via AI Assistant`;

				console.log(
					`[Approval API] Booking attempt → approval=${id} company=${companyId} date=${contextPayload.proposedDate} attendee=${attendee || 'none'}`
				);
				try {
					const { bookAppointment } = await import('$lib/server/google-calendar');
					const result = await bookAppointment(companyId, contextPayload.proposedDate, {
						summary: `Appointment — ${displayName} (${reason})`,
						description,
						attendeeEmail: attendee,
						phone
					});
					booking = { status: result.status, htmlLink: result.htmlLink };
					if (result.status === 'booked') {
						console.log(
							`[Approval API] ✅ Booked in Google Calendar → approval=${id} date=${contextPayload.proposedDate} link=${result.htmlLink || 'n/a'}`
						);
					}
				} catch (e) {
					booking = { status: 'error' };
					console.error(`[Approval API] ❌ Booking threw → approval=${id}:`, e);
				}

				// Notify Rory / reps internally (no approval needed - Requirement 4)
				try {
					const { notifyRepsOfBooking } = await import('$lib/server/rep-notify');
					const dateLabel = new Date(contextPayload.proposedDate).toLocaleString('en-US', {
						weekday: 'short',
						month: 'short',
						day: 'numeric',
						hour: 'numeric',
						minute: '2-digit'
					});
					await notifyRepsOfBooking(companyId, `New appointment: ${displayName} (${reason}) — ${dateLabel}`, {
						contactName: displayName,
						reason,
						commId: approval.commId
					});
				} catch (nErr) {
					console.error('[Approval API] Internal notify failed:', nErr);
				}
			}

			return json({ success: true, state: 'approved', booking });
		} else if (action === 'reject') {
			await prisma.commApproval.update({
				where: { id },
				data: { state: 'rejected', rejectedReason: rejectReason || 'Manually rejected' }
			});
			return json({ success: true, state: 'rejected' });
		} else {
			return json({ error: 'Invalid action' }, { status: 400 });
		}
	} catch (e: any) {
		console.error('[Approval API] Error processing approval:', e);
		return json({ error: e.message || 'Internal error' }, { status: 500 });
	}
};
