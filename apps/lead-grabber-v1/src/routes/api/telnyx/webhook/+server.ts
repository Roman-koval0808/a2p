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
import { draftResponse } from '$lib/ai/openai';
import { TELNYX_API_KEY, TELNYX_MESSAGING_PROFILE_ID } from '$env/static/private';
import { PUBLIC_BASE_URL } from '$env/static/public';
import { normalizeUrl } from '$lib/utils';

async function handleWebhook(request: Request) {
	return await POST({ request } as Parameters<typeof POST>[0]);
}

function extractNameFromSms(content: string): string | null {
	if (!content) return null;
	const clauses = content.split(/[.,\/#!$%\^&\*;:{}=\-_`~()\n?]/);
	const patterns = [
		/(?:I'm|I am)\s+(?:new\s+customer,\s+)?([A-Za-z]+)/i,
		/this is\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
		/my name is\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
		/([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+here/i,
		/([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+speaking/i
	];
	const blacklist = ['a', 'the', 'an', 'some', 'someone', 'here', 'speaking', 'there', 'just', 'please', 'we', 'you', 'they', 'our', 'my', 'your', 'about', 'not', 'this', 'is', 'am', 'hello', 'hi', 'good', 'morning', 'afternoon', 'evening'];
	
	for (const clause of clauses) {
		const trimmedClause = clause.trim();
		for (const pattern of patterns) {
			const match = trimmedClause.match(pattern);
			if (match && match[1]) {
				const candidate = match[1].trim();
				const words = candidate.split(/\s+/);
				const validWords = words.filter(w => !blacklist.includes(w.toLowerCase()));
				if (validWords.length > 0) {
					return validWords.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
				}
			}
		}
	}
	return null;
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

		// Resolve company early for tenant isolation
		const parsedForTo = JSON.parse(rawBody);
		const payloadForTo = parsedForTo.data?.payload || parsedForTo;
		const toNumberRaw = payloadForTo.to;
		const toNumber = Array.isArray(toNumberRaw)
			? (toNumberRaw[0]?.phone_number || toNumberRaw[0])
			: (toNumberRaw?.phone_number || toNumberRaw);
		const companyId = toNumber ? await getCompanyIdByPhoneNumber(prisma, toNumber) : null;

		// --- BACKGROUND PROCESSING ---
		// We execute the heavy AI pipeline and DB logging in the background so we can respond
		// to Telnyx immediately with 200 OK. This prevents Telnyx from timing out and retrying
		// the webhook, which was causing duplicate messages.
		Promise.resolve().then(async () => {
			// RUN SVELTEKIT INTERNAL AI SIGNALS PIPELINE synchronously:
			let pipelineResult = null;
			try {
				pipelineResult = await PipelineSimulator.run({
					author_name: smsSender !== 'Anonymous' ? smsSender : 'Anonymous',
					customer_phone: smsSender !== 'Anonymous' ? smsSender : undefined,
					rating: 0,
					comment: smsText,
					mode: 'sms',
					sessionId: smsId
				});
			} catch (err) {
				console.error('[SMS Pipeline Error]', err);
			}

		const extractedName = pipelineResult?.ai_protocol?.raw_response?.customer_name || null;
		const pipelineAuthorName = extractedName || smsSender;
		
		const lowerText = smsText.toLowerCase();
		const emergencyKeywords = ['burst', 'flood', 'leak', 'emergency', 'pipe', 'water', 'immediate', 'urgent'];
		const bookingKeywords = ['book', 'appointment', 'estimate', 'quote', 'schedule', 'renovate', 'renovation', 'toilet', 'shower', 'fixture'];
		const hasEmergency = emergencyKeywords.some(kw => lowerText.includes(kw));
		const scoreDelta = hasEmergency ? 15 : (bookingKeywords.some(kw => lowerText.includes(kw)) ? 20 : 10);

		let draftText = '';
		if (hasEmergency) {
			const namePart = extractedName && extractedName !== 'Unknown Customer' ? ` ${extractedName}` : '';
			draftText = `Hi${namePart}, we received your urgent message. Our team has been notified immediately and will be in touch with you shortly.`;
		} else {
			if (pipelineResult && pipelineResult.success) {
				if (pipelineResult.execution?.execution_output_package?.execution_records) {
					for (const rec of pipelineResult.execution.execution_output_package.execution_records) {
						if (rec.generated_output) {
							try {
								const parsedOutput = typeof rec.generated_output === 'string'
									? JSON.parse(rec.generated_output)
									: rec.generated_output;
								if (parsedOutput.draft_reply) {
									draftText = parsedOutput.draft_reply;
									break;
								}
							} catch (e) {}
						}
					}
				}
			}

			if (!draftText && smsText && companyId) {
				try {
					draftText = await draftResponse(smsText, [{ role: 'customer', content: smsText }], 'sms') || '';
				} catch (err) {
					console.error('Error generating fallback draft response:', err);
				}
			}
		}

		if (pipelineResult && pipelineResult.success) {
			// Persist the full pipeline package into ProfileDB
			if (companyId) {
				const compId = companyId as string;
				try {
					const profiledbUrl = process.env.PROFILEDB_URL || 'http://localhost:6277';
					const res = await fetch(`${profiledbUrl}/api/v1/telemetry/events`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'Authorization': 'Bearer clearsky_pixel_api_key'
						},
						body: JSON.stringify({
							tenantSlug: compId,
							fingerprintId: smsId,
							eventType: 'sms_received',
							pageUrl: null,
							scoreDelta: scoreDelta,
							phone: smsSender !== 'Anonymous' ? smsSender : null,
							name: extractedName || (smsSender !== 'Anonymous' ? smsSender : null),
							payload: {
								provider: 'telnyx_sms',
								event_type: 'sms_received',
								textContent: smsText,
								rating: 0,
								author_name: extractedName || smsSender,
								customer_phone: smsSender !== 'Anonymous' ? smsSender : null,
								contains_emergency_keywords: hasEmergency,
								urgency_level: hasEmergency ? 'high' : 'medium',
								pipeline_logs: pipelineResult.logs,
								signals: pipelineResult.signals,
								enrichments: pipelineResult.enrichments,
								decision: pipelineResult.decision,
								execution: pipelineResult.execution,
								outcome: pipelineResult.outcome,
								feedback: pipelineResult.feedback,
								ai_protocol: pipelineResult.ai_protocol,
								externalEventId: smsId
							}
						})
					});
					if (res.ok) {
						console.log('📡 Pipeline executed and SMS event logged to ProfileDB successfully');
					} else {
						console.error('❌ Failed to log SMS event to ProfileDB:', res.statusText);
					}
				} catch (dbErr) {
					console.error('❌ ProfileDB logging error:', dbErr);
				}
			} else {
				console.log('📡 Skipping ProfileDB logging for unassigned number');
			}

			// SMS Notification for event alerts
			try {
				if (companyId) {
					const action = pipelineResult.decision?.action_queue?.find(
						(act: any) => act.action_id === 'ACT-A2P-002' || act.title?.toLowerCase().includes('owner notification')
					);
					if (action) {
						console.log(`[SMS Webhook Pipeline] Owner notification triggered for SMS from ${smsSender}`);
						const alertMsg = `[Alert] Urgent SMS from ${pipelineAuthorName}: "${smsText.substring(0, 100)}${smsText.length > 100 ? '...' : ''}"`;
						const { sendOwnerSmsAlert } = await import('$lib/server/sms-alert');
						await sendOwnerSmsAlert(companyId, alertMsg);
					}
				}
			} catch (err) {
				console.error('[SMS Pipeline SMS Alert Error]', err);
			}
		}

		// Log separate outbound draft event if generated
		if (draftText && companyId) {
			const compId = companyId as string;
			try {
				const profiledbUrl = process.env.PROFILEDB_URL || 'http://localhost:6277';
				const draftRes = await fetch(`${profiledbUrl}/api/v1/telemetry/events`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': 'Bearer clearsky_pixel_api_key'
					},
					body: JSON.stringify({
						tenantSlug: compId,
						fingerprintId: `${smsId}_draft`,
						eventType: hasEmergency ? 'sms_auto_reply' : 'sms_draft',
						pageUrl: null,
						scoreDelta: 0,
						phone: smsSender !== 'Anonymous' ? smsSender : null,
						name: extractedName || (smsSender !== 'Anonymous' ? smsSender : null),
						intentBucket: hasEmergency ? 'AutoReply' : 'Confirm',
						payload: {
							provider: 'telnyx_sms',
							event_type: hasEmergency ? 'sms_auto_reply' : 'sms_draft',
							textContent: draftText,
							body: draftText,
							draftResponse: draftText,
							draft_reply: draftText,
							author_name: 'AI Agent',
							customer_phone: smsSender !== 'Anonymous' ? smsSender : null,
							contains_emergency_keywords: hasEmergency,
							urgency_level: hasEmergency ? 'high' : 'medium',
							pipeline_logs: pipelineResult?.logs || [],
							signals: pipelineResult?.signals || [],
							enrichments: pipelineResult?.enrichments || [],
							decision: pipelineResult?.decision || {},
							execution: pipelineResult?.execution || {},
							outcome: pipelineResult?.outcome || {},
							feedback: pipelineResult?.feedback || {},
							ai_protocol: pipelineResult?.ai_protocol || {},
							externalEventId: `${smsId}_draft`
						}
					})
				});
				if (draftRes.ok) {
					console.log('📡 Outbound draft event logged to ProfileDB successfully');
				} else {
					console.error('❌ Failed to log Outbound draft event to ProfileDB:', draftRes.statusText);
				}
			} catch (dbErr) {
				console.error('❌ ProfileDB draft logging error:', dbErr);
			}

			// Also log as a pending CommunicationLog or send auto-reply
			try {
				// We need contact if we want to link it, let's try to get or create contact
				const contact = await createOrUpdateContact({
					company_id: compId,
					phone: normalizePhoneNumber(phoneNumber),
					name: extractedName !== 'Unknown Customer' ? extractedName : undefined
				});

				if (hasEmergency) {
					const response = await fetch('https://api.telnyx.com/v2/messages', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${TELNYX_API_KEY}`
						},
						body: JSON.stringify({
							from: toNumber,
							to: phoneNumber,
							text: draftText,
							messaging_profile_id: TELNYX_MESSAGING_PROFILE_ID,
							webhook_url: normalizeUrl(PUBLIC_BASE_URL, '/api/telnyx/webhook'),
							webhook_failover_url: normalizeUrl(PUBLIC_BASE_URL, '/api/telnyx/webhook-backup'),
							use_profile_webhooks: false,
							type: 'SMS'
						})
					});

					let telnyxId = undefined;
					if (response.ok) {
						const parsedResponse = await response.json();
						telnyxId = parsedResponse.data?.id;
						console.log('📡 Sent emergency auto-reply via Telnyx successfully');
					} else {
						console.error('❌ Failed to send emergency auto-reply:', await response.text());
					}

					await logCommunication({
						type: 'sms',
						direction: 'outbound',
						status: 'success',
						source: toNumber || 'Inbox',
						destination: phoneNumber,
						company_id: compId,
						customer_id: contact?.id ?? undefined,
						summary: draftText.substring(0, 50) + '...',
						content: draftText,
						metadata: {
							thread_id: normalizePhoneNumber(phoneNumber),
							is_auto_reply: true,
							telnyx_id: telnyxId
						}
					});
				} else {
					await logCommunication({
						type: 'sms',
						direction: 'outbound',
						status: 'pending_approval',
						source: toNumber || 'Inbox',
						destination: phoneNumber,
						company_id: compId,
						customer_id: contact?.id ?? undefined,
						summary: draftText.substring(0, 50) + '...',
						content: draftText,
						metadata: {
							thread_id: normalizePhoneNumber(phoneNumber),
							is_draft: true
						}
					});
					console.log('📡 Logged pending_approval draft to local CommunicationLog');
				}
			} catch (draftErr) {
				console.error('Failed to log/send draft:', draftErr);
			}
		}

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
		// companyId and toNumber already resolved above
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
				if ((customerName === 'Unknown Customer' || customerName.startsWith('+')) && extractedName) {
					customerName = extractedName;
				}
				const companyIdForThread = companyId ?? existingMessage.companyId;
				const prevMessages = (existingMessage.messages as Array<Record<string, unknown>>) ?? [];
				const newMsg = {
					content,
					timestamp: new Date().toISOString(),
					is_agent_reply: false,
					...(media.length > 0 && { media })
				};
				
				const finalMessages = [...prevMessages, newMsg];
				if (hasEmergency && draftText) {
					finalMessages.push({
						content: draftText,
						timestamp: new Date().toISOString(),
						is_agent_reply: true,
						agent_name: 'AI Agent'
					});
				}

				await prisma.message.update({
					where: { id: existingMessage.id },
					data: {
						...(companyIdForThread && { companyId: companyIdForThread }),
						messages: finalMessages,
						status: hasEmergency ? 'replied' : 'new',
						customerName,
						updated: new Date(),
						...(hasEmergency && { urgency: 'red', intent: 'emergency', draftResponse: null }),
						...(!hasEmergency && draftText && { draftResponse: draftText })
					}
				});
			} else {
				if (!companyId) {
					console.log('Inbound SMS to unassigned number, skipping thread creation');
					return json({ success: true });
				}
				customerName = extractedName ?? 'Unknown Customer';

				const initialMessages = [
					{
						content,
						timestamp: new Date().toISOString(),
						is_agent_reply: false,
						...(media.length > 0 && { media })
					}
				];
				if (hasEmergency && draftText) {
					initialMessages.push({
						content: draftText,
						timestamp: new Date().toISOString(),
						is_agent_reply: true,
						agent_name: 'AI Agent'
					});
				}

				await prisma.message.create({
					data: {
						threadId,
						companyId,
						customerPhone: phoneNumber,
						customerName,
						messages: initialMessages,
						status: hasEmergency ? 'replied' : 'new',
						...(hasEmergency && { urgency: 'red', intent: 'emergency' }),
						...(!hasEmergency && draftText && { draftResponse: draftText })
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
		} catch (dbError) {
			console.error('Database error in background task:', dbError);
		}
		}).catch(err => {
			console.error('Unhandled error in background webhook processing:', err);
		});

		// Respond immediately to prevent retries
		return json({ success: true });
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
