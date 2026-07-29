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

			// If it's SMS, we send it via sendAutomatedSms
			if (approval.draftType === 'sms') {
				const contextPayload: any = approval.contextPayload || {};
				const customerPhone = contextPayload.destination || approval.container.customerProfile?.phoneNumber;
				if (customerPhone) {
					try {
						await sendAutomatedSms(customerPhone, approval.draftContent, contextPayload.source);
						console.log(`[Approval API] SMS approved and sent to ${customerPhone}`);
					} catch (e) {
						console.error(`[Approval API] Failed to send SMS on approval:`, e);
						return json({ error: 'Failed to send SMS' }, { status: 500 });
					}
				}
			}
			// Email: attempt to send the confirmation, but NEVER block the booking on it — mail may
			// not be configured yet (no Brevo key), and a failed send must not stop the calendar hold
			// from being confirmed. Best-effort only.
			if (approval.draftType === 'email') {
				const cp: any = approval.contextPayload || {};
				const to = cp.extractedEmail || approval.container.customerProfile?.email || null;
				if (to) {
					try {
						const { sendEmail } = await import('$lib/server/brevo');
						const raw = approval.draftContent || '';
						const subjMatch = raw.match(/^\s*Subject:\s*(.+)$/im);
						const subject = subjMatch ? subjMatch[1].trim() : 'Appointment Confirmation';
						const body = raw.replace(/^\s*Subject:\s*.+$/im, '').trim();
						await sendEmail({
							to: [{ email: to }],
							subject,
							htmlContent: `<div style="font-family:sans-serif;white-space:pre-wrap">${body
								.replace(/&/g, '&amp;')
								.replace(/</g, '&lt;')
								.replace(/\n/g, '<br>')}</div>`
						});
						console.log(`[Approval API] Email approved and sent to ${to}`);
					} catch (e) {
						// Non-fatal: log and continue to booking.
						console.error(`[Approval API] Email send failed (continuing to booking):`, e);
					}
				} else {
					console.warn('[Approval API] Email draft approved but no recipient email on file — skipping send.');
				}
			}

			const contextPayload: any = approval.contextPayload || {};
			let booking: { status: string; htmlLink?: string | null } = { status: 'not_attempted' };
			if (contextPayload.proposedDate) {
				const companyId = approval.container.companyId;
				const attendee = contextPayload.extractedEmail || null;
				console.log(
					`[Approval API] Booking attempt → approval=${id} company=${companyId} date=${contextPayload.proposedDate} attendee=${attendee || 'none'}`
				);
				try {
					const { bookAppointment } = await import('$lib/server/google-calendar');
					const result = await bookAppointment(companyId, contextPayload.proposedDate, {
						summary: `Appointment: ${contextPayload.product || 'Services'}`,
						description: 'Booked via AI Assistant',
						attendeeEmail: attendee,
						phone: approval.container.customerProfile?.phoneNumber || null
					});
					booking = { status: result.status, htmlLink: result.htmlLink };
					if (result.status === 'booked') {
						console.log(
							`[Approval API] ✅ Booked in Google Calendar → approval=${id} date=${contextPayload.proposedDate} link=${result.htmlLink || 'n/a'}`
						);
					} else if (result.status === 'busy') {
						console.warn(
							`[Approval API] ⚠️ NOT booked — slot already busy → approval=${id} date=${contextPayload.proposedDate}`
						);
					} else {
						// 'failed' — most often no Google Calendar connection for this company, or a
						// token/scope error (see the preceding [google-calendar] log line for the cause).
						console.error(
							`[Approval API] ❌ Booking FAILED (status=failed) → approval=${id} company=${companyId} date=${contextPayload.proposedDate}. Likely no calendar connection or a token/scope error — see [google-calendar] logs above.`
						);
					}
				} catch (e) {
					booking = { status: 'error' };
					console.error(`[Approval API] ❌ Booking threw → approval=${id}:`, e);
				}
			} else {
				console.log(
					`[Approval API] No booking — approval=${id} draft has no contextPayload.proposedDate (nothing to schedule).`
				);
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
