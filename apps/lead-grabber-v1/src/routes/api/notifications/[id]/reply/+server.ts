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
import { logCommunication } from '$lib/utils/communication-log';

/** Reply via SMS/email/call - marks as read and triggers send. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const n = await prisma.notification.findFirst({
		where: { id: params.id, companyId: auth.companyId }
	});
	if (!n) {
		return json({ success: false, error: 'Notification not found', code: 404 }, { status: 404 });
	}

	const body = await request.json().catch(() => ({}));
	const message = typeof body.message === 'string' ? body.message.trim() : '';
	const replyMethod = body.replyMethod; // sms | email | call

	if (!message || !['sms', 'email', 'call'].includes(replyMethod)) {
		return json(
			{ success: false, error: 'message and replyMethod (sms|email|call) are required', code: 400 },
			{ status: 400 }
		);
	}

	await prisma.notification.update({
		where: { id: params.id },
		data: { read: true }
	});

	if (replyMethod === 'sms') {
		const destinationPhone = normalizePhoneNumber(n.sourceIdentifier || '');
		if (!destinationPhone) {
			return json({ success: false, error: 'No valid destination phone number found' }, { status: 400 });
		}

		let fromNumber = TELNYX_PHONE_NUMBER;
		const companyNumbers = await prisma.companyPhoneNumber.findMany({
			where: { companyId: auth.companyId },
			select: { phoneNumber: true }
		});
		const validNumbers = companyNumbers.map(num => normalizePhoneNumber(num.phoneNumber)).filter(Boolean);
		const telnyxNorm = normalizePhoneNumber(TELNYX_PHONE_NUMBER);
		if (validNumbers.includes(telnyxNorm)) {
			fromNumber = TELNYX_PHONE_NUMBER;
		} else if (validNumbers.length > 0) {
			fromNumber = validNumbers[0];
		}

		console.log(`[Notification Reply SMS] Sending from: ${fromNumber} to: ${destinationPhone}`);

		try {
			const response = await fetch('https://api.telnyx.com/v2/messages', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TELNYX_API_KEY}`
				},
				body: JSON.stringify({
					from: fromNumber,
					to: destinationPhone,
					text: message,
					messaging_profile_id: TELNYX_MESSAGING_PROFILE_ID,
					webhook_url: normalizeUrl(PUBLIC_BASE_URL, '/api/telnyx/webhook'),
					webhook_failover_url: normalizeUrl(PUBLIC_BASE_URL, '/api/telnyx/webhook-backup'),
					use_profile_webhooks: false,
					type: 'SMS'
				})
			});

			if (!response.ok) {
				const responseText = await response.text();
				console.error('Telnyx send failed during notification reply:', responseText);
				let result;
				try {
					result = JSON.parse(responseText);
				} catch (e) {}
				const errorDetail = result?.errors?.[0]?.detail || 'Failed to send SMS via Telnyx';
				return json({ success: false, error: errorDetail }, { status: 500 });
			}

			const parsedResponse = await response.json();

			await logCommunication({
				type: 'sms',
				direction: 'outbound',
				status: 'success',
				source: fromNumber,
				destination: destinationPhone,
				company_id: auth.companyId,
				summary: message.substring(0, 50) + '...',
				content: message,
				metadata: {
					telnyx_id: parsedResponse.data?.id
				}
			});

			// Update the message thread (inbox chat) in the local database
			try {
				const messageThread = await prisma.message.findFirst({
					where: {
						OR: [
							{ threadId: destinationPhone },
							{ customerPhone: destinationPhone }
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
									content: message,
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
				console.error('Failed to update message thread during notification reply:', dbErr);
			}

		} catch (error: any) {
			console.error('Error sending reply SMS:', error);
			return json({ success: false, error: error?.message || 'Failed to send SMS' }, { status: 500 });
		}
	}

	return json({ success: true, message: 'Reply sent successfully' });
};
