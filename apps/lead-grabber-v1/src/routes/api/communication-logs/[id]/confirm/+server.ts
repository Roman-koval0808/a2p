import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';
import {
	TELNYX_API_KEY,
	TELNYX_MESSAGING_PROFILE_ID,
	TELNYX_PHONE_NUMBER,
	TELNYX_CONNECTION_ID
} from '$env/static/private';
import { PUBLIC_BASE_URL } from '$env/static/public';
import { normalizeUrl } from '$lib/utils';
import { normalizePhoneNumber, formatPhoneForDialing } from '$lib/utils/phone';

export const POST: RequestHandler = async ({ params, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	try {
		const log = await prisma.communicationLog.findFirst({
			where: { id: params.id, companyId: auth.companyId }
		});

		if (!log) {
			return json({ success: false, error: 'Communication log not found' }, { status: 404 });
		}

		if (log.status !== 'pending_approval') {
			return json({ success: false, error: 'Communication log is not pending approval' }, { status: 400 });
		}

		const meta = (log.metadata as any) || {};

		// The customer asked to be CALLED, not texted — place a call instead of sending the draft.
		// Dial the number they left in their message (meta.callback_number), else their own line.
		if (meta.confirm_action === 'call') {
			const to = normalizePhoneNumber(meta.callback_number || log.destination || '');
			if (!to) {
				return json({ success: false, error: 'No callback number available to dial' }, { status: 400 });
			}
			const { resolveSmsSender } = await import('$lib/server/company-sender');
			const from = await resolveSmsSender(log.companyId, meta.preferred_from);
			if (!from) {
				return json(
					{ success: false, error: 'No active company number to call from. Check Manage Numbers.' },
					{ status: 400 }
				);
			}
			console.log(`[Confirm → Callback] Placing call from ${from} to ${to}`);
			const res = await fetch('https://api.telnyx.com/v2/calls', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TELNYX_API_KEY}` },
				body: JSON.stringify({
					connection_id: TELNYX_CONNECTION_ID,
					to: formatPhoneForDialing(to),
					from,
					webhook_url: normalizeUrl(PUBLIC_BASE_URL, '/api/telnyx/call-webhook'),
					answering_machine_detection: 'premium'
				})
			});
			if (!res.ok) {
				const body = await res.text();
				console.error('[Confirm → Callback] Telnyx call failed:', body);
				let e: any;
				try {
					e = JSON.parse(body);
				} catch {}
				return json(
					{ success: false, error: e?.errors?.[0]?.detail || 'Failed to place callback' },
					{ status: 500 }
				);
			}
			const updated = await prisma.communicationLog.update({
				where: { id: log.id },
				data: { status: 'completed', metadata: { ...meta, callback_placed_to: to } }
			});
			return json({ success: true, data: updated, action: 'call' });
		}

		// If it's an outbound SMS, actually send it!
		if (log.type === 'sms' && log.direction === 'outbound') {
			// Strip any "(Ext 1 - Billing)" annotation, then normalize.
			let fromNumber = normalizePhoneNumber((log.source || '').replace(/\s*\([^)]*\)\s*$/, '').trim());
			const companyNumbers = await prisma.companyPhoneNumber.findMany({
				where: { companyId: log.companyId },
				select: { phoneNumber: true }
			});
			const validNumbers = companyNumbers.map((n) => normalizePhoneNumber(n.phoneNumber)).filter(Boolean);

			// The draft's `from` must be one of THIS company's real (bought) numbers; otherwise
			// Telnyx rejects it ("Invalid source number"). If it isn't, use the company's own
			// number. The env TELNYX_PHONE_NUMBER is only an absolute last resort (no company numbers).
			if (!fromNumber || !fromNumber.startsWith('+') || !validNumbers.includes(fromNumber)) {
				fromNumber = validNumbers[0] || TELNYX_PHONE_NUMBER;
			}

			const formattedDest = normalizePhoneNumber(log.destination || '');
			
			console.log(`[Confirm Outbound SMS] Sending from: ${fromNumber} to: ${formattedDest}`);

			const doSend = (includeFrom: boolean) =>
				fetch('https://api.telnyx.com/v2/messages', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${TELNYX_API_KEY}`
					},
					body: JSON.stringify({
						...(includeFrom ? { from: fromNumber } : {}),
						to: formattedDest,
						text: log.content,
						messaging_profile_id: TELNYX_MESSAGING_PROFILE_ID,
						webhook_url: normalizeUrl(PUBLIC_BASE_URL, '/api/telnyx/webhook'),
						webhook_failover_url: normalizeUrl(PUBLIC_BASE_URL, '/api/telnyx/webhook-backup'),
						use_profile_webhooks: false,
						type: 'SMS'
					})
				});

			let response = await doSend(true);
			if (!response.ok) {
				const firstText = await response.text();
				let firstErr: any;
				try {
					firstErr = JSON.parse(firstText);
				} catch (e) {}
				const code = firstErr?.errors?.[0]?.code;
				const detail = (firstErr?.errors?.[0]?.detail || '').toLowerCase();
				// If Telnyx rejects the `from` number (not on the account / messaging profile),
				// retry letting the messaging profile's number pool pick a valid sender.
				if (code === '10004' || detail.includes('source number') || detail.includes('from number')) {
					console.warn(
						`[Confirm Outbound SMS] from=${fromNumber} rejected (${firstErr?.errors?.[0]?.detail}); retrying via messaging profile ${TELNYX_MESSAGING_PROFILE_ID}`
					);
					response = await doSend(false);
					if (!response.ok) {
						const retryText = await response.text();
						console.error('Telnyx send failed (retry via messaging profile):', retryText);
						let r;
						try {
							r = JSON.parse(retryText);
						} catch (e) {}
						return json(
							{ success: false, error: r?.errors?.[0]?.detail || 'Failed to send SMS via Telnyx' },
							{ status: 500 }
						);
					}
				} else {
					console.error('Telnyx send failed during confirmation:', firstText);
					return json(
						{ success: false, error: firstErr?.errors?.[0]?.detail || 'Failed to send SMS via Telnyx' },
						{ status: 500 }
					);
				}
			}

			// Update the message thread (inbox chat) in the local database
			try {
				const messageThread = await prisma.message.findFirst({
					where: {
						OR: [
							{ threadId: formattedDest },
							{ customerPhone: formattedDest }
						]
					}
				});

				if (messageThread) {
					const existingMessages = (Array.isArray(messageThread.messages)
						? messageThread.messages
						: []) as any[];

					await prisma.message.update({
						where: { id: messageThread.id },
						data: {
							messages: [
								...existingMessages,
								{
									content: log.content,
									timestamp: new Date().toISOString(),
									is_agent_reply: true,
									agent_id: locals.user?.id,
									agent_name: locals.user?.name || 'AI Assistant'
								}
							],
							status: 'replied',
							draftResponse: null
						}
					});
				}
			} catch (dbErr) {
				console.error('Failed to update message thread during confirmation:', dbErr);
			}
		}

		// If it's an outbound EMAIL, attempt to send — but never fail the confirmation (and never
		// block the booking below) if mail is deferred. Prefer the company's CONNECTED Google
		// account (same one used for Calendar); fall back to the single-account GMAIL_* sender.
		if (log.type === 'email' && log.direction === 'outbound') {
			const m = (log.metadata as any) || {};
			const subjMatch = (log.content || '').match(/^\s*Subject:\s*(.+)$/im);
			const subject = subjMatch
				? subjMatch[1].trim()
				: m.subject || log.summary || `Appointment Confirmation — ${m.product || m.purpose || 'Sales Opportunity'}`;
			let htmlBody = (log.content || '').replace(/^\s*Subject:\s*.+(\r?\n)+/i, '').trim();
			const to = log.destination || '';
			// Guard: a half-transcribed address ("romankovalenko", no domain) makes Gmail 400. Don't
			// attempt to send to a non-address — the booking below still proceeds.
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
				console.warn(
					`[Confirm Outbound Email] Recipient "${to}" is not a valid email — skipping send. Fix the address before confirming to email the customer.`
				);
			} else {
				if (log.customerId) {
					const { injectEmailTracking } = await import('$lib/server/email/tracking-inject');
					const result = await injectEmailTracking(htmlBody, log.customerId, log.companyId);
					htmlBody = result.htmlContent;
				}
				let sentMessageId: string | undefined = undefined;
				try {
					const { sendEmailViaConnectedGmail } = await import('$lib/server/gmail-send');
					const res = await sendEmailViaConnectedGmail(log.companyId, { to, subject, htmlContent: htmlBody });
					sentMessageId = res.messageId;
					console.log(`[Confirm Outbound Email] ✅ Sent via connected Google account to ${to}`);
				} catch (connErr: any) {
					console.warn('[Confirm Outbound Email] Connected Gmail unavailable:', connErr?.message || connErr);
					try {
						const { sendEmailViaGmail } = await import('$lib/server/gmail-send');
						const res = await sendEmailViaGmail({ to, subject, htmlContent: htmlBody });
						sentMessageId = res.messageId;
						console.log(`[Confirm Outbound Email] ✅ Sent via fallback Gmail to ${to}`);
					} catch (e: any) {
						console.warn('[Confirm Outbound Email] Email dispatch deferred (no sender available):', e?.message || e);
					}
				}

				if (sentMessageId) {
					try {
						const updatedMeta = { ...(log.metadata as object), email_message_id: sentMessageId };
						await prisma.communicationLog.update({
							where: { id: log.id },
							data: { metadata: updatedMeta }
						});
					} catch (dbErr) {
						console.error('[Confirm Outbound Email] Failed to save email_message_id:', dbErr);
					}
				}
			}
		}

		// Finalize booking if this draft was for an appointment hold
		if (meta.holdId) {
			try {
				const activeHold = await prisma.commHold.findUnique({ where: { id: meta.holdId } });
				if (activeHold && activeHold.status === 'tentative') {
					await prisma.commHold.update({
						where: { id: activeHold.id },
						data: { status: 'booked' }
					});
					
					const { cancelTimersForContainer } = await import('$lib/server/timer/timer-service');
					if (meta.commId) {
						await cancelTimersForContainer(meta.commId, 'hold_expiry', 'confirmed_by_agent');
					}

					// Resolve contact name for display
					let contactName: string | undefined = undefined;
					if (log.customerId) {
						const c = await prisma.contact.findUnique({ where: { id: log.customerId }, select: { name: true } });
						if (c?.name) contactName = c.name;
					}
					if (!contactName && log.destination) {
						const c = await prisma.contact.findFirst({
							where: { companyId: log.companyId, OR: [{ phone: log.destination }, { cell: log.destination }] },
							select: { name: true }
						});
						if (c?.name) contactName = c.name;
					}
					const displayName = contactName || log.destination || 'Customer';
					const reason = meta.booking_reason || meta.product || meta.purpose || meta.sub_intent || meta.intent || 'Sales Opportunity';
					const description = `Subject / Reason: ${reason}\n\nSummary:\n${log.summary || log.content || 'N/A'}\n\nBooked via AI Assistant`;

					if (log.companyId && activeHold.startTime) {
						const { createEvent } = await import('$lib/server/google-calendar');
						const startISO = new Date(activeHold.startTime).toISOString();
						const endISO = activeHold.endTime
							? new Date(activeHold.endTime).toISOString()
							: new Date(new Date(activeHold.startTime).getTime() + 60 * 60 * 1000).toISOString();

						const attendee = meta.extractedEmail || undefined;
						console.log(
							`[Confirm → Booking] Attempt → hold=${meta.holdId} company=${log.companyId} start=${startISO} attendee=${attendee || 'none'}`
						);
						const ev = await createEvent(log.companyId, {
							summary: `Appointment — ${displayName} (${reason})`,
							description,
							startISO,
							endISO,
							attendeeEmail: attendee,
							email: attendee,
							phone: log.destination || undefined,
							addMeet: true
						});

						if (ev?.eventId) {
							await prisma.commHold.update({
								where: { id: activeHold.id },
								data: { calendarEventId: ev.eventId }
							});
							console.log(
								`[Confirm → Booking] ✅ Booked → hold=${meta.holdId} event=${ev.eventId} link=${ev.htmlLink || 'n/a'}`
							);
						}
					}

					// Notify Rory / reps internally (no approval needed)
					try {
						const { notifyRepsOfBooking } = await import('$lib/server/rep-notify');
						const dateLabel = new Date(activeHold.startTime).toLocaleString('en-US', {
							weekday: 'short',
							month: 'short',
							day: 'numeric',
							hour: 'numeric',
							minute: '2-digit'
						});
						await notifyRepsOfBooking(log.companyId, `New appointment: ${displayName} (${reason}) — ${dateLabel}`, {
							contactName: displayName,
							reason,
							commId: log.communicationThreadId || meta.commId
						});
					} catch (nErr) {
						console.error('[Confirm → Booking] Internal notify failed:', nErr);
					}
				}
			} catch (err) {
				console.error('Failed to finalize booking from UI confirmation:', err);
			}
		}

		// Update the log status to completed and record confirmation metadata
		const updatedLog = await prisma.communicationLog.update({
			where: { id: log.id },
			data: { 
				status: 'completed',
				metadata: {
					...meta,
					is_draft: false,
					email_confirmed: true,
					email_confirmed_at: new Date().toISOString()
				} as any
			} 
		});

		if (updatedLog.communicationThreadId) {
			await prisma.communicationThread.update({
				where: { id: updatedLog.communicationThreadId },
				data: { status: 'open' }
			});
		}

		return json({ success: true, data: updatedLog });
	} catch (error: any) {
		console.error('Error confirming communication log:', error);
		return json({ success: false, error: error?.message || 'Internal server error' }, { status: 500 });
	}
};
