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

		// If it's an outbound EMAIL, send it via Brevo (dev mode logs instead of sending).
		if (log.type === 'email' && log.direction === 'outbound') {
			const m = (log.metadata as any) || {};
			const subject = m.subject || log.summary || 'A message from us';
			try {
				const { sendEmail } = await import('$lib/server/brevo');
				await sendEmail({ to: [{ email: log.destination || '' }], subject, htmlContent: log.content || '' });
				console.log(`[Confirm Outbound Email] Sent to ${log.destination}`);
			} catch (e: any) {
				console.error('Email send failed during confirmation:', e?.message || e);
				return json({ success: false, error: 'Failed to send email' }, { status: 500 });
			}
		}

		// Update the log status to completed (simulating dispatch)
		const updatedLog = await prisma.communicationLog.update({
			where: { id: log.id },
			data: { status: 'completed' } 
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
