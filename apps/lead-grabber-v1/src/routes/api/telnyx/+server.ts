import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	TELNYX_API_KEY,
	TELNYX_PHONE_NUMBER,
	TELNYX_MESSAGING_PROFILE_ID
} from '$env/static/private';
import { PUBLIC_BASE_URL } from '$env/static/public';
import { normalizeUrl } from '$lib/utils';
import { normalizePhoneNumber } from '$lib/utils/phone';
import { logCommunication } from '$lib/utils/communication-log';
import { getFirstCompanyNumber } from '$lib/company-numbers';
import { prisma } from '$lib/db';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { message, phoneNumber, threadId } = await request.json();
	const companyId = locals.user?.company?.id;
	let fromNumber: string = TELNYX_PHONE_NUMBER;

	try {
		if (companyId) {
			// Find all numbers for the company safely
			const companyNumbers = await prisma.companyPhoneNumber.findMany({
				where: { companyId },
				select: { phoneNumber: true }
			});
			const validNumbers = companyNumbers.map(n => normalizePhoneNumber(n.phoneNumber)).filter(Boolean);
			
			// Find the last communication log with this customer to see which number was used
			const formattedPhoneNumber = normalizePhoneNumber(phoneNumber);
			const lastLog = await prisma.communicationLog.findFirst({
				where: {
					companyId,
					OR: [
						{ source: formattedPhoneNumber },
						{ destination: formattedPhoneNumber }
					]
				},
				orderBy: { created: 'desc' }
			});

			let matchedNumber: string | null = null;
			if (lastLog) {
				const srcNorm = normalizePhoneNumber(lastLog.source || '');
				const destNorm = normalizePhoneNumber(lastLog.destination || '');
				if (validNumbers.includes(destNorm)) {
					matchedNumber = destNorm;
				} else if (validNumbers.includes(srcNorm)) {
					matchedNumber = srcNorm;
				}
			}

			if (matchedNumber) {
				fromNumber = matchedNumber;
				console.log(`[Outbound Route] Found matching company number from last communication: ${fromNumber}`);
			} else {
				const telnyxNorm = normalizePhoneNumber(TELNYX_PHONE_NUMBER);
				if (validNumbers.includes(telnyxNorm)) {
					fromNumber = TELNYX_PHONE_NUMBER;
				} else if (validNumbers.length > 0) {
					const allowedNum = validNumbers.find(n => n !== '+12016277128');
					fromNumber = allowedNum || validNumbers[0];
				}
			}
		}

		// Normalize phone number
		const formattedPhoneNumber = normalizePhoneNumber(phoneNumber);

		// Log the request being sent to Telnyx
		console.log('Sending to Telnyx:', {
			from: fromNumber,
			to: formattedPhoneNumber,
			profileId: TELNYX_MESSAGING_PROFILE_ID,
			apiKeyLength: TELNYX_API_KEY?.length || 0 // Don't log the actual key, just its length for debugging
		});

		// Call Telnyx API to send SMS
		const response = await fetch('https://api.telnyx.com/v2/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${TELNYX_API_KEY}`
			},
			body: JSON.stringify({
				from: fromNumber,
				to: formattedPhoneNumber,
				text: message,
				messaging_profile_id: TELNYX_MESSAGING_PROFILE_ID, // Required for SMS/MMS
				webhook_url: normalizeUrl(PUBLIC_BASE_URL, '/api/telnyx/webhook'),
				webhook_failover_url: normalizeUrl(PUBLIC_BASE_URL, '/api/telnyx/webhook-backup'),
				use_profile_webhooks: false, // Use our custom webhooks instead of profile defaults
				type: 'SMS' // Explicitly set message type
			})
		});

		// Log the full response for debugging
		const responseText = await response.text();
		console.log('Telnyx API raw response:', responseText);

		let result;
		try {
			result = JSON.parse(responseText);
		} catch (e) {
			console.error('Failed to parse Telnyx response as JSON:', e);
			throw new Error('Invalid response from Telnyx API');
		}

		console.log('Telnyx API parsed response:', result);

		if (!response.ok) {
			const errorDetail = result.errors?.[0]?.detail || 'Failed to send message';
			console.error('Telnyx API error:', errorDetail, result);
			throw new Error(errorDetail);
		}

		await logCommunication({
			type: 'sms',
			direction: 'outbound',
			status: 'success',
			source: fromNumber,
			destination: formattedPhoneNumber,
			company_id: companyId ?? undefined,
			summary: message.substring(0, 50) + '...',
			content: message,
			metadata: {
				telnyx_id: result.data?.id
			}
		});

		if (threadId && threadId.startsWith('emergency-')) {
			const profiledbUrl = process.env.PROFILEDB_URL || 'http://localhost:6277';
			try {
				await fetch(`${profiledbUrl}/api/v1/telemetry/events`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': 'Bearer clearsky_pixel_api_key'
					},
					body: JSON.stringify({
						tenantSlug: 'clearsky-demo',
						eventType: 'sms_sent',
						phone: formattedPhoneNumber,
						payload: {
							detail: `SMS Sent: "${message}"`,
							to: formattedPhoneNumber,
							body: message,
							provider: 'telnyx_voice',
							sessionId: 'sess_sms_inbox_reply'
						}
					})
				});
				console.log('📡 Synced outbound emergency SMS to ProfileDB successfully');
			} catch (e) {
				console.warn('[Telnyx Outbound Sync] failed to sync to profiledb:', e);
			}
		}

		return json({
			success: true,
			telnyxId: result.data?.id,
			threadId: formattedPhoneNumber
		});
	} catch (error) {
		console.error('Telnyx API error:', error);

		// Log failed attempt if we have enough info
		if (companyId) {
			try {
				await logCommunication({
					type: 'sms',
					direction: 'outbound',
					status: 'failed',
					source: fromNumber,
					destination: normalizePhoneNumber(phoneNumber),
					company_id: companyId,
					content: message,
					metadata: { error: error instanceof Error ? error.message : String(error) }
				});
			} catch (e) {
				console.error('Failed to log error', e);
			}
		}

		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : String(error)
			},
			{ status: 500 }
		);
	}
};
