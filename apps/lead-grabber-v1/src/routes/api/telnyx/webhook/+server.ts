// src/routes/api/telnyx/webhook/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { normalizePhoneNumber } from '$lib/utils/phone';
import { logCommunication } from '$lib/utils/communication-log';
import { createOrUpdateContact } from '$lib/utils/contacts';
import { getCompanyIdByPhoneNumber } from '$lib/company-numbers';
import { isA2pEnabled, forwardSmsWebhook } from '$lib/server/a2p-client';
import { PipelineSimulator } from '$lib/server/pipeline-simulator';

async function handleWebhook(request: Request) {
	return await POST({ request } as Parameters<typeof POST>[0]);
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const rawBody = await request.text();
		console.log('Webhook raw body:', rawBody);

		let smsText = '';
		let smsSender = 'Anonymous';
		let smsId = `sms_${Date.now()}`;
		let isOutbound = false;
		let eventType = 'unknown';
		try {
			const parsed = JSON.parse(rawBody);
			eventType = parsed.data?.event_type || 'unknown';
			const msgPayload = parsed.data?.payload || parsed;
			const direction = msgPayload.direction;
			if (eventType === 'message.sent' || eventType === 'message.finalized' || direction === 'outbound') {
				isOutbound = true;
			}
			smsText = msgPayload.text || '';
			smsSender = msgPayload.from?.phone_number || msgPayload.from || 'Anonymous';
			smsId = msgPayload.id || smsId;
		} catch (e) {}

		// Skip completely if this is an outbound event to prevent loops and double logging
		if (isOutbound) {
			console.log(`--- [WEBHOOK] Ignoring outbound event: ${eventType} ---`);
			return json({ success: true, message: 'Ignored outbound event' });
		}

		// RUN SVELTEKIT INTERNAL AI SIGNALS PIPELINE:
		PipelineSimulator.run({
			author_name: smsSender,
			customer_phone: smsSender !== 'Anonymous' ? smsSender : undefined,
			rating: 0,
			comment: smsText,
			mode: 'sms',
			sessionId: smsId
		}).then(async (pipelineResult) => {
			if (!pipelineResult.success) {
				console.error('❌ SMS Pipeline run failed:', pipelineResult.error);
				return;
			}

			// Persist the full pipeline package into ProfileDB
			const profiledbUrl = process.env.PROFILEDB_URL || 'http://localhost:6277';
			const res = await fetch(`${profiledbUrl}/api/v1/telemetry/events`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': 'Bearer clearsky_pixel_api_key'
				},
				body: JSON.stringify({
					tenantSlug: 'clearsky-demo',
					fingerprintId: smsId,
					eventType: 'sms_received',
					pageUrl: null,
					scoreDelta: 10,
					phone: smsSender !== 'Anonymous' ? smsSender : null,
					name: smsSender !== 'Anonymous' ? smsSender : null,
					payload: {
						provider: 'telnyx_sms',
						event_type: 'sms_received',
						textContent: smsText,
						rating: 0,
						author_name: smsSender,
						customer_phone: smsSender !== 'Anonymous' ? smsSender : null,
						pipeline_logs: pipelineResult.logs,
						signals: pipelineResult.signals,
						enrichments: pipelineResult.enrichments,
						decision: pipelineResult.decision,
						execution: pipelineResult.execution,
						outcome: pipelineResult.outcome,
						feedback: pipelineResult.feedback,
						ai_protocol: pipelineResult.ai_protocol
					}
				})
			});
			if (res.ok) {
				console.log('📡 Pipeline executed and SMS event logged to ProfileDB successfully');
			} else {
				console.error('❌ Failed to log SMS event to ProfileDB:', res.statusText);
			}

			// SMS Notification for event alerts
			try {
				const parsed = JSON.parse(rawBody);
				const msgPayload = parsed.data?.payload || parsed;
				const toNumberRaw = msgPayload.to;
				const toNumber = Array.isArray(toNumberRaw)
					? (toNumberRaw[0]?.phone_number || toNumberRaw[0])
					: (toNumberRaw?.phone_number || toNumberRaw);
				const companyId = toNumber ? await getCompanyIdByPhoneNumber(prisma, toNumber) : null;

				if (companyId) {
					const action = pipelineResult.decision?.action_queue?.find(
						(act: any) => act.action_id === 'ACT-A2P-002' || act.title?.toLowerCase().includes('owner notification')
					);
					if (action) {
						console.log(`[SMS Webhook Pipeline] Owner notification triggered for SMS from ${smsSender}`);
						const alertMsg = `[Alert] Urgent SMS from ${smsSender}: "${smsText.substring(0, 100)}${smsText.length > 100 ? '...' : ''}"`;
						const { sendOwnerSmsAlert } = await import('$lib/server/sms-alert');
						await sendOwnerSmsAlert(companyId, alertMsg);
					}
				}
			} catch (err) {
				console.error('[SMS Pipeline SMS Alert Error]', err);
			}
		}).catch(err => console.error('[SMS Pipeline Error]', err));

		// Forward to A2P backend when configured (replaces local SMS/messages/comm-log handling)
		if (isA2pEnabled()) {
			try {
				const { ok, status, body: a2pBody } = await forwardSmsWebhook(rawBody);
				return json(a2pBody ?? { ok }, { status: status >= 200 && status < 300 ? 200 : status });
			} catch (a2pError) {
				console.error('[A2P Forwarding Failed - falling back to local handling]:', a2pError);
			}
		}

		// Parse the webhook payload
		const payload = JSON.parse(rawBody);
		console.log('Webhook payload:', payload);

		let messageData;

		if (payload.data?.event_type === 'message.received') {
			messageData = payload.data.payload;
		} else if (payload.record_type === 'message' && payload.direction === 'inbound') {
			messageData = payload;
		} else {
			console.log('Unknown webhook format or not an inbound message:', payload);
			return json({ success: true });
		}

		const phoneNumber = messageData.from?.phone_number || messageData.from;
		const content = messageData.text;
		const media = messageData.media || [];

		if (!phoneNumber) {
			console.error('Missing phone number in webhook:', messageData);
			return json({ success: false, error: 'Missing phone number' });
		}

		const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
		const toNumberRaw = messageData.to;
		const toNumber = Array.isArray(toNumberRaw)
			? (toNumberRaw[0]?.phone_number || toNumberRaw[0])
			: (toNumberRaw?.phone_number || toNumberRaw);
		const companyId = toNumber ? await getCompanyIdByPhoneNumber(prisma, toNumber) : null;
		console.log(
			'Normalized phone:',
			normalizedPhoneNumber,
			'to (our number):',
			toNumber,
			'companyId:',
			companyId ?? 'none'
		);

		const threadId = normalizedPhoneNumber;

		try {
			// Find existing message by threadId or customerPhone
			const existingMessage = await prisma.message.findFirst({
				where: {
					OR: [{ threadId: normalizedPhoneNumber }, { customerPhone: normalizedPhoneNumber }]
				}
			});

			let customerName: string;

			if (existingMessage) {
				customerName = existingMessage.customerName ?? 'Unknown Customer';
				const companyIdForThread = companyId ?? existingMessage.companyId;
				const prevMessages = (existingMessage.messages as Array<Record<string, unknown>>) ?? [];
				const newMsg = {
					content,
					timestamp: new Date().toISOString(),
					is_agent_reply: false,
					...(media.length > 0 && { media })
				};

				await prisma.message.update({
					where: { id: existingMessage.id },
					data: {
						...(companyIdForThread && { companyId: companyIdForThread }),
						messages: [...prevMessages, newMsg],
						status: 'new'
					}
				});
			} else {
				if (!companyId) {
					console.log('Inbound SMS to unassigned number, skipping thread creation');
					return json({ success: true });
				}
				const nameMatch = content.match(/(?:I'm|I am)\s+(?:new\s+customer,\s+)?([A-Za-z]+)/i);
				customerName = nameMatch?.[1] ?? 'Unknown Customer';

				await prisma.message.create({
					data: {
						threadId,
						companyId,
						customerPhone: phoneNumber,
						customerName,
						messages: [
							{
								content,
								timestamp: new Date().toISOString(),
								is_agent_reply: false,
								...(media.length > 0 && { media })
							}
						],
						status: 'new'
					}
				});
			}

			const effectiveCompanyId = companyId ?? existingMessage?.companyId ?? null;
			const contact = effectiveCompanyId
				? await createOrUpdateContact({
						company_id: effectiveCompanyId,
						phone: normalizedPhoneNumber,
						name: customerName !== 'Unknown Customer' ? customerName : undefined
					})
				: undefined;

			await logCommunication({
				type: 'sms',
				direction: 'inbound',
				status: 'success',
				source: phoneNumber,
				destination: toNumber || 'Inbox',
				company_id: companyId ?? undefined,
				customer_id: contact?.id ?? undefined,
				summary: content.substring(0, 50) + '...',
				content,
				metadata: {
					thread_id: threadId,
					telnyx_event: payload.data?.event_type
				}
			});

			return json({ success: true });
		} catch (dbError) {
			console.error('Database error:', dbError);
			return json(
				{ success: false, error: dbError instanceof Error ? dbError.message : String(dbError) },
				{ status: 500 }
			);
		}
	} catch (err) {
		console.error('Webhook processing error:', err);
		return json(
			{ success: false, error: err instanceof Error ? err.message : String(err) },
			{ status: 500 }
		);
	}
};

export const GET: RequestHandler = () => json({ success: true });
export const PUT: RequestHandler = async ({ request }) => handleWebhook(request);
export const OPTIONS: RequestHandler = () => json({ success: true });
