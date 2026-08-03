/**
 * ClearSky spec: POST /api/sms/send (recipients[], message, fromNumber?).
 * Proxies to Telnyx; keeps API key on server.
 */
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
import { requireAuth, unauthorized } from '$lib/api/spec';
import { createOrUpdateContact } from '$lib/utils/contacts';

export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const body = await request.json().catch(() => ({}));
	const recipients = Array.isArray(body.recipients) ? body.recipients : [];
	const message = typeof body.message === 'string' ? body.message : '';
	let fromNumber: string | null =
		typeof body.fromNumber === 'string' ? body.fromNumber.trim() : null;

	if (!recipients.length || !message) {
		return json(
			{ success: false, error: 'recipients and message are required', code: 400 },
			{ status: 400 }
		);
	}

	if (!fromNumber && auth.companyId) {
		const companyNumber = await getFirstCompanyNumber(prisma, auth.companyId);
		fromNumber = companyNumber?.phoneNumber ?? TELNYX_PHONE_NUMBER;
	}
	fromNumber = fromNumber ?? TELNYX_PHONE_NUMBER;

	// Universal context check (outbound): a sent SMS should join the container that topic and
	// people live in — even if the last exchange happened on EMAIL or VOICE, not just SMS in the
	// last 48h. Falls back to the plain phone-window lookup when the matcher is unsure.
	async function findRecentThreadId(
		companyId: string,
		phone: string,
		message: string
	): Promise<string | null> {
		try {
			const { resolveContextContainer } = await import('$lib/server/container/thread-resolver');
			const resolution = await resolveContextContainer({
				companyId,
				contactId: null,
				customerProfileId: null,
				phone,
				email: null,
				channel: 'sms',
				direction: 'outbound',
				subject: null,
				content: message.slice(0, 4000)
			});
			if (resolution.matched && resolution.commId) return resolution.commId;
		} catch (e) {
			console.error('[Telnyx SMS] Context thread lookup failed:', e);
		}
		try {
			const recent = await prisma.communicationLog.findFirst({
				where: {
					companyId,
					OR: [{ source: phone }, { destination: phone }],
					communicationThreadId: { not: null },
					created: { gte: new Date(Date.now() - 48 * 3600 * 1000) }
				},
				select: { communicationThreadId: true },
				orderBy: { created: 'desc' }
			});
			return recent?.communicationThreadId ?? null;
		} catch (e) {
			console.error('[Telnyx SMS] Failed to find recent thread:', e);
			return null;
		}
	}

	const results: { recipient: string; messageId?: string; status: string; error?: string }[] = [];
	for (const to of recipients) {
		const formatted = normalizePhoneNumber(to);
		try {
			const payload = {
				from: fromNumber,
				to: formatted,
				text: message,
				messaging_profile_id: TELNYX_MESSAGING_PROFILE_ID,
				webhook_url: normalizeUrl(PUBLIC_BASE_URL, '/api/telnyx/webhook'),
				webhook_failover_url: normalizeUrl(PUBLIC_BASE_URL, '/api/telnyx/webhook-backup'),
				use_profile_webhooks: false,
				type: 'SMS'
			};
			console.log(`[Telnyx SMS] Sending to ${formatted} from ${fromNumber}`);
			console.log('[Telnyx SMS] Payload:', JSON.stringify(payload, null, 2));

			const response = await fetch('https://api.telnyx.com/v2/messages', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TELNYX_API_KEY}`
				},
				body: JSON.stringify(payload)
			});
			console.log(`[Telnyx SMS] Response Status: ${response.status} ${response.statusText}`);
			const result = await response.json();
			if (response.ok && result.data?.id) {
				console.log('[Telnyx SMS] API Success:', JSON.stringify(result, null, 2));
				// Resolve/create the recipient contact so the comms log row links to the customer
				// (same as the inbound webhook path) instead of appearing as a bare number.
				let customerId: string | null = null;
				try {
					const contact = await createOrUpdateContact({
						company_id: auth.companyId,
						phone: formatted
					});
					customerId = contact?.id ?? null;
				} catch (contactErr) {
					console.error('[Telnyx SMS] Failed to resolve contact:', contactErr);
				}
				await logCommunication({
					type: 'sms',
					direction: 'outbound',
					status: 'success',
					source: fromNumber,
					destination: formatted,
					company_id: auth.companyId,
					user_id: auth.id,
					customer_id: customerId ?? undefined,
					summary: message.slice(0, 50) + (message.length > 50 ? '...' : ''),
					content: message,
					thread_id: (await findRecentThreadId(auth.companyId, formatted, message)) || undefined,
					metadata: { telnyx_id: result.data.id, thread_id: formatted }
				});
				results.push({ recipient: formatted, messageId: result.data.id, status: 'sent' });
			} else {
				console.error('[Telnyx SMS] API Error:', JSON.stringify(result, null, 2));
				const err = result.errors?.[0]?.detail ?? 'Send failed';
				results.push({ recipient: formatted, status: 'failed', error: err });
			}
		} catch (e) {
			results.push({
				recipient: formatted,
				status: 'failed',
				error: e instanceof Error ? e.message : String(e)
			});
		}
	}

	const failed = results.filter((r) => r.status === 'failed').length;
	return json({
		success: failed === 0,
		data: { results },
		message:
			failed === 0
				? `SMS sent to ${results.length} recipient(s)`
				: `Failed to send SMS to ${failed} recipient(s)`,
		...(failed > 0 && { error: `Failed to send SMS to ${failed} recipient(s)` })
	});
};
