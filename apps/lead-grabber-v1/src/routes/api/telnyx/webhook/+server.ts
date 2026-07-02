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
import { draftConversationalReply } from '$lib/server/conversation';
import { getBookingUrl } from '$lib/utils/booking';
import { getBookingLinkIfConnected, getConnectionInfo, getCustomerAppointments } from '$lib/server/google-calendar';
import { ingestTelemetryEvent } from '$lib/server/profiledb/telemetry';
import { TELNYX_API_KEY, TELNYX_MESSAGING_PROFILE_ID, ANTHROPIC_AI_KEY } from '$env/static/private';
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
	const blacklist = [
		'a',
		'the',
		'an',
		'some',
		'someone',
		'here',
		'speaking',
		'there',
		'just',
		'please',
		'we',
		'you',
		'they',
		'our',
		'my',
		'your',
		'about',
		'not',
		'this',
		'is',
		'am',
		'hello',
		'hi',
		'good',
		'morning',
		'afternoon',
		'evening'
	];

	for (const clause of clauses) {
		const trimmedClause = clause.trim();
		for (const pattern of patterns) {
			const match = trimmedClause.match(pattern);
			if (match && match[1]) {
				const candidate = match[1].trim();
				const words = candidate.split(/\s+/);
				const validWords = words.filter((w) => !blacklist.includes(w.toLowerCase()));
				if (validWords.length > 0) {
					return validWords
						.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
						.join(' ');
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

		let parsed: any;
		try {
			parsed = JSON.parse(rawBody);
		} catch (err) {
			console.error('Failed to parse webhook body:', err);
			return json({ success: false, error: 'Invalid JSON' }, { status: 400 });
		}

		const eventType = parsed.data?.event_type || 'unknown';
		const messagePayload = parsed.data?.payload || parsed;
		const direction = messagePayload.direction || '';
		// Only process inbound SMS message.received events
		if (eventType !== 'message.received') {
			console.log(`--- [WEBHOOK] Ignoring non-inbound-SMS event: ${eventType} ---`);
			return json({ success: true, message: 'Ignored non-inbound-SMS event' });
		}

		const smsText = messagePayload.text || '';
		const phoneNumber = messagePayload.from?.phone_number || messagePayload.from || '';
		const smsSender = phoneNumber || 'Anonymous';
		const smsId = messagePayload.id || `sms_${Date.now()}`;
		const media = messagePayload.media || [];
		const normalizedPhoneNumber = phoneNumber ? normalizePhoneNumber(phoneNumber) : '';
		const threadId = normalizedPhoneNumber || `sms_${Date.now()}`;

		const toNumberRaw = messagePayload.to;
		const toNumber = Array.isArray(toNumberRaw)
			? toNumberRaw[0]?.phone_number || toNumberRaw[0]
			: toNumberRaw?.phone_number || toNumberRaw;

		if (!phoneNumber) {
			console.error('Missing phone number in webhook:', messagePayload);
			return json({ success: false, error: 'Missing phone number' }, { status: 400 });
		}

		let companyId = toNumber ? await getCompanyIdByPhoneNumber(prisma, toNumber) : null;
		if (!companyId && normalizedPhoneNumber) {
			const existingMessage = await prisma.message.findFirst({
				where: {
					OR: [{ threadId: normalizedPhoneNumber }, { customerPhone: normalizedPhoneNumber }]
				}
			});
			if (existingMessage) {
				companyId = existingMessage.companyId;
			}
		}

		// --- BACKGROUND PROCESSING ---
		// We execute the heavy AI pipeline and DB logging in the background so we can respond
		// to Telnyx immediately with 200 OK. This prevents Telnyx from timing out and retrying
		// the webhook, which was causing duplicate messages.
		Promise.resolve()
			.then(async () => {
				// RUN SVELTEKIT INTERNAL AI SIGNALS PIPELINE synchronously:
				let pipelineResult = null;
				try {
					pipelineResult = await PipelineSimulator.run({
						author_name: smsSender !== 'Anonymous' ? smsSender : 'Anonymous',
						customer_phone: smsSender !== 'Anonymous' ? smsSender : undefined,
						rating: 0,
						comment: smsText,
						mode: 'sms',
						sessionId: smsId,
						companyId: companyId || undefined
					});
				} catch (err) {
					console.error('[SMS Pipeline Error]', err);
				}

				const extractedName = pipelineResult?.ai_protocol?.raw_response?.customer_name || null;
				const pipelineAuthorName = extractedName || smsSender;

				const lowerText = smsText.toLowerCase();
				const emergencyKeywords = [
					'burst',
					'flood',
					'leak',
					'emergency',
					'pipe',
					'water',
					'immediate',
					'urgent'
				];
				const bookingKeywords = [
					'book',
					'appointment',
					'estimate',
					'quote',
					'schedule',
					'renovate',
					'renovation',
					'toilet',
					'shower',
					'fixture'
				];
				const hasEmergency = emergencyKeywords.some((kw) => lowerText.includes(kw));
				const scoreDelta = hasEmergency
					? 15
					: bookingKeywords.some((kw) => lowerText.includes(kw))
						? 20
						: 10;

				let draftText = '';
				if (hasEmergency) {
					const namePart =
						extractedName && extractedName !== 'Unknown Customer' ? ` ${extractedName}` : '';
					draftText = `Hi${namePart}, we received your urgent message. Our team has been notified immediately and will be in touch with you shortly.`;
				} else {
					if (pipelineResult && pipelineResult.success) {
						if (pipelineResult.execution?.execution_output_package?.execution_records) {
							for (const rec of pipelineResult.execution.execution_output_package
								.execution_records) {
								if (rec.generated_output) {
									try {
										const parsedOutput =
											typeof rec.generated_output === 'string'
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

				}

				// Conversational reply: draft a natural, context-aware response that continues the
				// thread — and if the customer proposed an appointment time, check it against the
				// company's business hours and confirm or suggest an alternative. Overrides the
				// generic pipeline draft above. Falls back to it if this fails.
				try {
					if (companyId) {
						const cid = companyId as string;
						const last10 = (p: string | null | undefined) =>
							(p || '').replace(/\D/g, '').slice(-10);
						const callerDigits = last10(normalizedPhoneNumber || phoneNumber);

						// Build history from the UNIFIED CommunicationLog so context follows across
						// BOTH channels — the original call/voicemail AND the SMS thread — not just SMS.
						// Match by normalized digits so different phone formats still stitch together.
						const recentLogs = await prisma.communicationLog.findMany({
							where: {
								companyId: cid,
								created: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
							},
							orderBy: { created: 'asc' },
							take: 100
						});
						const history = recentLogs
							.filter(
								(l) => last10(l.source) === callerDigits || last10(l.destination) === callerDigits
							)
							.map((l) => {
								const meta = (l.metadata as any) || {};
								const isVoice = l.type === 'voice';
								const body = isVoice ? l.content || l.summary || meta.summary || '' : l.content || '';
								const prefix = isVoice
									? l.direction === 'inbound'
										? '[Voicemail] '
										: '[Call] '
									: '';
								return {
									from: (l.direction === 'inbound' ? 'customer' : 'business') as
										| 'customer'
										| 'business',
									text: `${prefix}${body}`.trim()
								};
							})
							.filter((t) => t.text);
						const company = await prisma.company.findUnique({
							where: { id: cid },
							include: { locations: true }
						});
						const contact = await prisma.contact.findFirst({
							where: { companyId: cid, phone: normalizedPhoneNumber }
						});
						// Self-service link: pasted Appointment Schedule link, or our booking page when
						// Google Calendar is connected — the customer self-picks from live availability.
						const bookingLink = getBookingUrl(company) || (await getBookingLinkIfConnected(cid));
						// If they ask about their appointment history, look it up on the calendar.
						const asksAppointments =
							/\b(appointment|appt|last (time|appointment|visit)|when .*(was|were|is|are|scheduled|booked)|history|scheduled|booked|come out|came out|visit|next (appointment|appt|visit))\b/i.test(
								smsText
							);
						let appointments: { startISO: string; title: string; isPast: boolean }[] | undefined;
						if (asksAppointments) {
							const gconn = await getConnectionInfo(cid);
							if (gconn.connected) {
								// Match by phone (their texting number — reliable), then email, then name.
								appointments = await getCustomerAppointments(cid, {
									phone: contact?.phone || normalizedPhoneNumber,
									email: contact?.email,
									name: contact?.name
								});
							}
						}
						const conv = await draftConversationalReply({
							message: smsText,
							history,
							companyName: company?.name || 'us',
							customerName: contact?.name || extractedName || null,
							customerPhone: contact?.phone || normalizedPhoneNumber,
							locations: (company as any)?.locations || [],
							accountBalance: contact?.accountBalance ?? null,
							bookingUrl: bookingLink,
							appointments,
							apiKey: ANTHROPIC_AI_KEY
						});
						if (conv?.reply) {
							draftText = conv.reply;
							console.log(
								`[Conversational reply] booked=${conv.booked} available=${conv.available} -> "${conv.reply}"`
							);
						}
					}
				} catch (convErr) {
					console.error('[Conversational reply] failed:', convErr);
				}

				if (pipelineResult && pipelineResult.success) {
					// Persist the full pipeline package into ProfileDB
					if (companyId) {
						const compId = companyId as string;
						try {
							const result = await ingestTelemetryEvent({
								body: {
									isTest: true,
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
								},
								headers: { authorization: 'Bearer clearsky_pixel_api_key' }
							});
							if (result.status >= 200 && result.status < 300) {
								console.log('📡 Pipeline executed and SMS event logged to ProfileDB successfully');
							} else {
								console.error('❌ Failed to log SMS event to ProfileDB:', result.body);
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
							const action = pipelineResult?.decision?.action_queue?.find(
								(act: any) =>
									act.action_id === 'ACT-A2P-002' ||
									act.title?.toLowerCase().includes('owner notification')
							);
							if (hasEmergency || action) {
								console.log(
									`[SMS Webhook Pipeline] Owner notification triggered for SMS from ${smsSender} (hasEmergency=${hasEmergency})`
								);
								const alertMsg = `[Alert] Urgent SMS from ${pipelineAuthorName}: "${smsText.substring(0, 100)}${smsText.length > 100 ? '...' : ''}"`;
								const { sendOwnerSmsAlert } = await import('$lib/server/sms-alert');
								await sendOwnerSmsAlert(companyId, alertMsg);
							}
						}
					} catch (err) {
						console.error('[SMS Pipeline SMS Alert Error]', err);
					}
				}


				// Forward to A2P backend when configured (replaces local SMS/messages/comm-log handling)
				if (isA2pEnabled()) {
					try {
						const { ok, status, body: a2pBody } = await forwardSmsWebhook(rawBody);
						return json(a2pBody ?? { ok }, {
							status: status >= 200 && status < 300 ? 200 : status
						});
					} catch (a2pError) {
						console.error('[A2P Forwarding Failed - falling back to local handling]:', a2pError);
					}
				}

				console.log(
					'Normalized phone:',
					normalizedPhoneNumber,
					'to (our number):',
					toNumber,
					'companyId:',
					companyId ?? 'none'
				);

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
						if (
							(customerName === 'Unknown Customer' || customerName.startsWith('+')) &&
							extractedName
						) {
							customerName = extractedName;
						}
						const companyIdForThread = companyId ?? existingMessage.companyId;
						const prevMessages = (existingMessage.messages as Array<Record<string, unknown>>) ?? [];
						const newMsg = {
							content: smsText,
							timestamp: new Date().toISOString(),
							is_agent_reply: false,
							...(media.length > 0 && { media })
						};

						const finalMessages = [...prevMessages, newMsg];

						await prisma.message.update({
							where: { id: existingMessage.id },
							data: {
								...(companyIdForThread && { companyId: companyIdForThread }),
								messages: finalMessages,
								status: 'new',
								customerName,
								updated: new Date(),
								...(hasEmergency && { urgency: 'red', intent: 'emergency' }),
								draftResponse: draftText || null
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
								content: smsText,
								timestamp: new Date().toISOString(),
								is_agent_reply: false,
								...(media.length > 0 && { media })
							}
						];

						await prisma.message.create({
							data: {
								threadId,
								companyId,
								customerPhone: phoneNumber,
								customerName,
								messages: initialMessages,
								status: 'new',
								...(hasEmergency && { urgency: 'red', intent: 'emergency' }),
								draftResponse: draftText || null
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

					const inboundCommLog = await logCommunication({
						type: 'sms',
						direction: 'inbound',
						status: 'success',
						source: phoneNumber,
						destination: toNumber || 'Inbox',
						company_id: companyId ?? undefined,
						customer_id: contact?.id ?? undefined,
						summary: smsText.substring(0, 50) + '...',
						content: smsText,
						metadata: {
							thread_id: threadId,
							telnyx_event: eventType
						}
					});

					// Log separate outbound draft event if generated
					if (draftText && effectiveCompanyId) {
						const compId = effectiveCompanyId as string;
						try {
							const result = await ingestTelemetryEvent({
								body: {
									isTest: true,
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
								},
								headers: { authorization: 'Bearer clearsky_pixel_api_key' }
							});
							if (result.status >= 200 && result.status < 300) {
								console.log('📡 Outbound draft event logged to ProfileDB successfully');
							} else {
								console.error(
									'❌ Failed to log Outbound draft event to ProfileDB:',
									result.body
								);
							}
						} catch (dbErr) {
							console.error('❌ ProfileDB draft logging error:', dbErr);
						}

						// Also log as a pending CommunicationLog or send auto-reply
						try {
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
									thread_id: normalizedPhoneNumber,
									is_draft: true,
									is_emergency: hasEmergency,
									commId: inboundCommLog?.communicationThreadId
								}
							});
							console.log('📡 Logged pending_approval draft to local CommunicationLog');
						} catch (draftErr) {
							console.error('Failed to log/send draft:', draftErr);
						}
					}

					// --- SMS → Orchestrator: extract intent and route through orchestrator ---
					if (inboundCommLog?.id && effectiveCompanyId && smsText.trim()) {
						try {
							const { analyzeCallLog } = await import('$lib/server/openai');
							const analysis = await analyzeCallLog(smsText);
							console.log('[SMS Orchestrator] AI analysis:', analysis.intent, analysis.sub_intent, analysis.datetime);

							// Update commLog metadata with AI-extracted fields
							await prisma.communicationLog.update({
								where: { id: inboundCommLog.id },
								data: {
									summary: analysis.summary || inboundCommLog.summary,
									metadata: {
										...((inboundCommLog.metadata as Record<string, any>) || {}),
										intent: analysis.intent,
										sub_intent: analysis.sub_intent,
										datetime: analysis.datetime,
										urgency: analysis.urgency,
										sentiment: analysis.sentiment
									}
								}
							});

							// Fire orchestrator (same as voice path)
							const { process_orchestrator } = await import('$lib/server/orchestrator');
							await process_orchestrator(inboundCommLog.id, 'sms_ai_ready');
						} catch (orchErr) {
							console.error('[SMS Orchestrator] Error:', orchErr);
						}
					}
				} catch (dbError) {
					console.error('Database error in background task:', dbError);
				}
			})
			.catch((err) => {
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
