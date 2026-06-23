import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';
import {
	TELNYX_API_KEY,
	TELNYX_MESSAGING_PROFILE_ID,
	TELNYX_PHONE_NUMBER
} from '$env/static/private';
import { PUBLIC_BASE_URL } from '$env/static/public';
import { normalizeUrl } from '$lib/utils';
import { normalizePhoneNumber } from '$lib/utils/phone';

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

		// If it's an outbound SMS, actually send it!
		if (log.type === 'sms' && log.direction === 'outbound') {
			let fromNumber = log.source;
			if (!fromNumber || fromNumber === 'Inbox' || !fromNumber.startsWith('+')) {
				const companyNumbers = await prisma.companyPhoneNumber.findMany({
					where: { companyId: log.companyId },
					select: { phoneNumber: true }
				});
				const validNumbers = companyNumbers.map(n => normalizePhoneNumber(n.phoneNumber)).filter(Boolean);
				
				const telnyxNorm = normalizePhoneNumber(TELNYX_PHONE_NUMBER);
				if (validNumbers.includes(telnyxNorm)) {
					fromNumber = TELNYX_PHONE_NUMBER;
				} else if (validNumbers.length > 0) {
					fromNumber = validNumbers[0];
				} else {
					fromNumber = TELNYX_PHONE_NUMBER;
				}
			}

			const formattedDest = normalizePhoneNumber(log.destination || '');
			
			console.log(`[Confirm Outbound SMS] Sending from: ${fromNumber} to: ${formattedDest}`);

			const response = await fetch('https://api.telnyx.com/v2/messages', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TELNYX_API_KEY}`
				},
				body: JSON.stringify({
					from: fromNumber,
					to: formattedDest,
					text: log.content,
					messaging_profile_id: TELNYX_MESSAGING_PROFILE_ID,
					webhook_url: normalizeUrl(PUBLIC_BASE_URL, '/api/telnyx/webhook'),
					webhook_failover_url: normalizeUrl(PUBLIC_BASE_URL, '/api/telnyx/webhook-backup'),
					use_profile_webhooks: false,
					type: 'SMS'
				})
			});

			if (!response.ok) {
				const responseText = await response.text();
				console.error('Telnyx send failed during confirmation:', responseText);
				let result;
				try {
					result = JSON.parse(responseText);
				} catch (e) {}
				const errorDetail = result?.errors?.[0]?.detail || 'Failed to send SMS via Telnyx';
				return json({ success: false, error: errorDetail }, { status: 500 });
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
