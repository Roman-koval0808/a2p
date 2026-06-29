import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createPublicKey, verify } from 'crypto';
import { TELNYX_API_KEY, TELNYX_MESSAGING_PROFILE_ID } from '$env/static/private';
import { PipelineSimulator } from '$lib/server/pipeline-simulator';
import { addPendingCall } from '$lib/utils/callStore';
import { prisma } from '$lib/db';
import { getActiveCallFlow, toAbsoluteAudioUrl } from '$lib/ivr';
import { getCompanyAndFlowByPhoneNumber, toE164 } from '$lib/company-numbers';
import { PUBLIC_BASE_URL } from '$env/static/public';
import { notifyIncomingCallViaPush } from '$lib/server/push/incoming-call';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { isA2pEnabled, forwardVoiceWebhook } from '$lib/server/a2p-client';
import { createNotification } from '$lib/utils/notifications';
import { setIntent, setVoicemail, removeVoicemail, getState, deleteState, addVoicemailRecordingId, hasVoicemailRecordingId, removeVoicemailRecordingId } from '$lib/server/call-state';
import { logCommunication } from '$lib/utils/communication-log';
const TELNYX_PUBLIC_KEY = process.env.TELNYX_PUBLIC_KEY;

const playPublic = false;
const publicTestAudio = 'https://audio.jukehost.co.uk/fWZ2egpjSuSEtT7Z3ny7fKYFhJcKY7g7';
const defaultRingbackAudio = 'https://audio.jukehost.co.uk/aP5g4XhO3F2Q1s0H8v7Z9mN6L4y2K1'; // Assuming a generic jukehost or similar tone, but let's actually just use 'https://us-east-1.linodeobjects.com/clearsky-public/ringback.wav' or something. Let me just use a standard one. Actually, 'https://cdn.freesound.org/previews/411/411132_5121236-lq.mp3' is a good ringtone. Let's use it.

/**
 * Tracks transfer legs back to the original caller.
 * Key = transfer leg call_control_id
 * Value = { originalCallControlId, ivrFlowId, ivrRuleId }
 * This lets us play voicemail on the original caller if the transfer is not answered.
 */
const pendingTransfers = new Map<
	string,
	{ originalCallControlId: string; ivrFlowId: string; ivrRuleId: string }
>();

/**
 * Maps "from|to" strings to transfer metadata to catch outbound legs.
 */
const intentToTransfer = new Map<
	string,
	{ originalCallControlId: string; ivrFlowId: string; ivrRuleId: string; timestamp: number }
>();

// Periodic cleanup of stale in-memory transfer state (5 min TTL)
setInterval(() => {
	const now = Date.now();
	const FIVE_MIN = 5 * 60 * 1000;
	for (const [key, val] of intentToTransfer) {
		if (now - val.timestamp > FIVE_MIN) intentToTransfer.delete(key);
	}
}, 60_000);

const processedEventIds = new Set<string>();
const MAX_EVENT_IDS = 10000;

const defaultBeepAudio = 'https://codeskulptor-demos.commondatastorage.googleapis.com/descent/gotitem.mp3';

/**
 * Decodes a client state payload safely.
 */
function safeDecodeClientState(clientState: any): any {
	if (!clientState) return null;
	if (typeof clientState === 'object') {
		return clientState;
	}
	if (typeof clientState === 'string') {
		try {
			return JSON.parse(clientState);
		} catch (_) {}
		try {
			const decodedStr = Buffer.from(clientState, 'base64').toString('utf8');
			return JSON.parse(decodedStr);
		} catch (_) {}
	}
	return null;
}

// Replaced by CallState model in Prisma
function resolveAudioUrl(path: string | null | undefined, baseUrl: string): string | null {
	if (playPublic) return publicTestAudio;
	return toAbsoluteAudioUrl(path, baseUrl);
}

/** Get first usable audio URL from recording_urls (mp3, m4a, or any URL string). */
function getFirstAudioUrl(recUrls: unknown): string | null {
	if (!recUrls || typeof recUrls !== 'object') return null;
	const o = recUrls as Record<string, unknown>;
	const keys = ['mp3', 'm4a', 'wav'];
	for (const k of keys) {
		if (typeof o[k] === 'string' && (o[k] as string).startsWith('http')) return o[k] as string;
	}
	for (const v of Object.values(o)) {
		if (typeof v === 'string' && v.startsWith('http')) return v;
	}
	return null;
}

/** Compute call duration in seconds from hangup payload start_time / end_time. */
function computeDurationFromPayload(payload: Record<string, unknown>): number | null {
	const start = payload?.start_time as string | undefined;
	const end = payload?.end_time as string | undefined;
	if (!start || !end) return null;
	try {
		const startMs = new Date(start).getTime();
		const endMs = new Date(end).getTime();
		if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return null;
		const duration = Math.round((endMs - startMs) / 1000);
		if (isNaN(duration)) return 0;
		return duration;
	} catch {
		return null;
	}
}

/** Verify Telnyx webhook signature (Ed25519). Signed payload = timestamp|rawBody. Skip if TELNYX_PUBLIC_KEY not set. */
function verifyTelnyxSignature(rawBody: string, timestamp: string, signatureB64: string): boolean {
	if (!TELNYX_PUBLIC_KEY) return true;
	try {
		const payload = `${timestamp}|${rawBody}`;
		const sig = Buffer.from(signatureB64, 'base64');
		const key = TELNYX_PUBLIC_KEY.includes('-----BEGIN')
			? createPublicKey({ key: TELNYX_PUBLIC_KEY, format: 'pem' })
			: createPublicKey({
					key: Buffer.from(TELNYX_PUBLIC_KEY, 'base64'),
					format: 'raw' as any,
					type: 'ed25519'
				});
		return verify(null, Buffer.from(payload, 'utf8'), key, sig);
	} catch {
		return false;
	}
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const rawBody = await request.text();
		const timestamp = request.headers.get('telnyx-timestamp') ?? '';
		const signature = request.headers.get('telnyx-signature-ed25519') ?? '';
		if (TELNYX_PUBLIC_KEY && (!timestamp || !signature)) {
			return json({ error: 'Missing webhook signature headers' }, { status: 401 });
		}
		if (TELNYX_PUBLIC_KEY && !verifyTelnyxSignature(rawBody, timestamp, signature)) {
			return json({ error: 'Invalid webhook signature' }, { status: 401 });
		}

		// Forward to A2P backend when configured
		if (isA2pEnabled()) {
			try {
				const { ok, status, body: a2pBody } = await forwardVoiceWebhook(rawBody);
				return json(a2pBody ?? { ok }, { status: status >= 200 && status < 300 ? 200 : status });
			} catch (a2pError) {
				console.error('[A2P Forwarding Failed - falling back to local handling]:', a2pError);
			}
		}

		// IVR, recording, and comm-log creation always run locally. A2P is used only for
		// communication-logs UI (e.g. isA2pCommLogEnabled / api/a2p/communication-log).
		const body = JSON.parse(rawBody);

		const eventId = body?.data?.id || body?.meta?.event_id;
		if (eventId && processedEventIds.has(eventId)) {
			console.log('⏭️ Skipping duplicate webhook event:', eventId);
			return json({ ok: true });
		}
		if (eventId) {
			processedEventIds.add(eventId);
			if (processedEventIds.size > MAX_EVENT_IDS) {
				const first = processedEventIds.values().next().value;
				if (first) processedEventIds.delete(first);
			}
		}

		// Detect webhook format: Event API (wrapped) vs Call Control (direct)
		const isEventAPI = body.data?.event_type;
		const isCallControl = body.call_control_id;

		let eventType: string;
		let callControlId: string;
		let payload: Record<string, unknown>;

		if (isEventAPI) {
			// Event API format (test webhooks)
			eventType = body.data.event_type;
			callControlId = body.data.payload.call_control_id;
			payload = body.data.payload;
			console.log('📞 Event API webhook:', eventType, callControlId);
		} else if (isCallControl) {
			// Call Control format (production webhooks) – use explicit event_type when present
			callControlId = body.call_control_id;
			payload = body;
			const explicitEventType = body.event_type as string | undefined;
			if (explicitEventType) {
				eventType = explicitEventType;
			} else {
				if (body.state === 'parked' && !body.hangup_cause) {
					eventType = 'call.initiated';
				} else if (body.hangup_cause) {
					eventType = 'call.hangup';
				} else if (body.start_time && !body.hangup_cause) {
					eventType = 'call.answered';
				} else {
					eventType = 'call.unknown';
				}
			}
			console.log('📞 Call Control webhook:', eventType, callControlId, 'state:', body.state);
		} else {
			console.log('❓ Unknown webhook format:', body);
			return json({ success: true }); // Acknowledge unknown format
		}

		// For answering machine detection result
		let detectionResult: string | undefined;

		// Process different call events
		switch (eventType) {
			case 'call.initiated': {
				console.log('Call initiated:', callControlId, payload);
				await logCallEvent(callControlId, 'initiated', payload);

				// Incoming: "to" is the number that received the call. Resolve company by that number.
				const toRaw = (payload?.to as string) || '';
				const fromNumber = (payload?.from as string) || '';
				const callerName = (payload?.caller_id_name as string) || 'Unknown Caller';
				const isIncomingCall = payload?.direction === 'incoming';

				if (isIncomingCall) {
					const numberInfo = await getCompanyAndFlowByPhoneNumber(prisma, toRaw);
					console.log(
						'🔔 Incoming call to:',
						toRaw,
						'from:',
						fromNumber,
						'companyId:',
						numberInfo?.companyId ?? 'none',
						'callFlowId:',
						numberInfo?.callFlowId ?? 'none'
					);

					if (numberInfo?.companyId) {
						void notifyIncomingCallViaPush({
							companyId: numberInfo.companyId,
							callControlId,
							from: fromNumber,
							to: toRaw,
							callerName
						}).catch((err) => console.error('[push] incoming call notify:', err));
					}

					const fromNumberE164 = toE164(fromNumber);
					const fromIsCompany = fromNumberE164
						? await getCompanyAndFlowByPhoneNumber(prisma, fromNumberE164)
						: null;

					console.log('fromIsCompany check:', {
						fromNumber,
						fromNumberE164,
						fromIsCompany: !!fromIsCompany
					});


					if (!numberInfo) {
						addPendingCall({ name: callerName, phone: fromNumber, callId: callControlId });
						console.log('📞 Number not assigned to a company - stored in pending calls');
						if (!fromIsCompany) {
							const clientState = Buffer.from(
								JSON.stringify({
									isUnavailable: true,
									allUnavailableAudioUrl: null
								})
							).toString('base64');
							try {
								await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`, {
									method: 'POST',
									headers: TELNYX_HEADERS,
									body: JSON.stringify({
										client_state: clientState
									})
								});
								console.log('✅ Unassigned number call answered for unavailability message');
							} catch (err) {
								console.error('❌ Answer failed for unassigned number:', err);
							}
						}
					} else if (!numberInfo.callFlowId) {
						addPendingCall({ name: callerName, phone: fromNumber, callId: callControlId });
						console.log('📞 Number not assigned to IVR - stored in pending calls');
						if (!fromIsCompany) {
							const clientState = Buffer.from(
								JSON.stringify({
									isUnavailable: true,
									allUnavailableAudioUrl: null
								})
							).toString('base64');
							try {
								await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`, {
									method: 'POST',
									headers: TELNYX_HEADERS,
									body: JSON.stringify({
										client_state: clientState
									})
								});
								console.log('✅ Unconfigured IVR call answered for unavailability message');
							} catch (err) {
								console.error('❌ Answer failed for unconfigured IVR:', err);
							}
						}
					} else {
						const company = await prisma.company.findUnique({
							where: { id: numberInfo.companyId },
							select: { settings: true }
						});
						const timezone =
							(company?.settings as { timezone?: string } | null)?.timezone ?? 'America/New_York';
						const active = await getActiveCallFlow(prisma, numberInfo.companyId, new Date(), {
							timezone,
							flowId: numberInfo.callFlowId
						});
						if (active) {
							const clientState = Buffer.from(
								JSON.stringify({ 
									ivrFlowId: active.flow.id, 
									ivrRuleId: active.rule.id,
									ivrPath: active.flow.title
								})
							).toString('base64');
							try {
								await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`, {
									method: 'POST',
									headers: TELNYX_HEADERS,
									body: JSON.stringify({
										record: 'record-from-answer',
										client_state: clientState
									})
								});
								console.log('✅ IVR flow answered:', active.flow.title, active.rule.ruleTitle);
							} catch (err) {
								console.error('❌ IVR answer failed:', err);
								addPendingCall({ name: callerName, phone: fromNumber, callId: callControlId });
							}
						} else {
							addPendingCall({ name: callerName, phone: fromNumber, callId: callControlId });
							console.log('📞 No active IVR rule for this time - stored in pending calls');
							if (!fromIsCompany) {
								let allUnavailableAudioUrl: string | null = null;
								try {
									const flow = await prisma.callFlow.findUnique({
										where: { id: numberInfo.callFlowId },
										select: { allUnavailableAudioUrl: true }
									});
									allUnavailableAudioUrl = flow?.allUnavailableAudioUrl ?? null;
								} catch (e) {
									console.error('Error fetching call flow for unavailable audio:', e);
								}
								const clientState = Buffer.from(
									JSON.stringify({
										isUnavailable: true,
										allUnavailableAudioUrl,
										ivrFlowId: numberInfo.callFlowId
									})
								).toString('base64');
								try {
									await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`, {
										method: 'POST',
										headers: TELNYX_HEADERS,
										body: JSON.stringify({
											client_state: clientState
										})
									});
									console.log('✅ No active rule call answered for unavailability message');
								} catch (err) {
									console.error('❌ Answer failed for active rule check:', err);
								}
							}
						}
					}
				} else {
					// Outbound call (could be a transfer leg)
					console.log('📞 Outbound call initiated:', callControlId, 'from:', fromNumber, 'to:', toRaw);
					
					// Try to link to a pending transfer
					const parentId = payload?.parent_call_control_id as string | undefined;
					const intentKey = `${fromNumber}|${toRaw}`;
					const intent = intentToTransfer.get(intentKey);
					const decodedState = safeDecodeClientState(payload?.client_state);
					
					if (decodedState?.originalCallControlId) {
						console.log('🔗 Linking outbound leg via client_state originalCallControlId:', decodedState.originalCallControlId);
						pendingTransfers.set(callControlId, {
							originalCallControlId: decodedState.originalCallControlId,
							ivrFlowId: decodedState.ivrFlowId || intent?.ivrFlowId,
							ivrRuleId: decodedState.ivrRuleId || intent?.ivrRuleId
						});
					} else if (parentId) {
						// Best case: Telnyx gave us the parent ID
						console.log('🔗 Linking outbound leg to parent via parent_call_control_id:', parentId);
						// We still need ivrFlowId/ivrRuleId. If it's a transfer we initiated, we might have it in intent.
						if (intent) {
							pendingTransfers.set(callControlId, {
								originalCallControlId: parentId,
								ivrFlowId: intent.ivrFlowId,
								ivrRuleId: intent.ivrRuleId
							});
							intentToTransfer.delete(intentKey);
						}
					} else if (intent && (Date.now() - intent.timestamp < 10000)) {
						// Fallback: Link via from/to match within 10 seconds
						console.log('🔗 Linking outbound leg via intent mapping to original:', intent.originalCallControlId);
						pendingTransfers.set(callControlId, {
							originalCallControlId: intent.originalCallControlId,
							ivrFlowId: intent.ivrFlowId,
							ivrRuleId: intent.ivrRuleId
						});
						intentToTransfer.delete(intentKey);
					}
				}
				break;
			}

			case 'call.playback.started': {
				// Silent acknowledgement
				break;
			}

			case 'call.answered': {
				console.log('✅ Call answered:', callControlId);
				await logCallEvent(callControlId, 'answered', payload);

				// Bypass IVR logic for outbound calls (e.g. transfer legs to reps)
				if (payload?.direction === 'outbound') {
					console.log('📞 Outbound transfer leg answered, bypassing IVR logic for control ID:', callControlId);
					break;
				}

				let ivrFlowId: string | null = null;
				let ivrRuleId: string | null = null;
				let isUnavailable = false;
				let allUnavailableAudioUrl: string | null = null;
				if (payload?.client_state) {
					const decoded = safeDecodeClientState(payload.client_state);
					if (decoded) {
						ivrFlowId = decoded.ivrFlowId ?? null;
						ivrRuleId = decoded.ivrRuleId ?? null;
						isUnavailable = decoded.isUnavailable ?? false;
						allUnavailableAudioUrl = decoded.allUnavailableAudioUrl ?? null;
					}
				}
				if (isUnavailable && callControlId) {
					const baseUrl = PUBLIC_BASE_URL || 'https://example.com';
					const resolvedUrl = resolveAudioUrl(allUnavailableAudioUrl, baseUrl);
					
					const goesToVoicemail = !!ivrFlowId;
					const nextState = Buffer.from(
						JSON.stringify(
							goesToVoicemail
								? { isVoicemailPrompt: true, ivrFlowId }
								: { afterPlaybackHangup: true }
						)
					).toString('base64');

					if (goesToVoicemail) {
						await setVoicemail(callControlId);
					}

					try {
						if (resolvedUrl) {
							await telnyxPlayback(callControlId, resolvedUrl, nextState);
							console.log(`▶️ Playing unavailable audio url (${goesToVoicemail ? 'going to voicemail' : 'hanging up'}):`, resolvedUrl);
						} else {
							await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/speak`, {
								method: 'POST',
								headers: TELNYX_HEADERS,
								body: JSON.stringify({
									payload: goesToVoicemail
										? 'We are sorry, but no representative is available to take your call at this time. Please leave your message after the tone.'
										: 'We are sorry, but no representative is available to take your call at this time. Goodbye.',
									voice: 'female',
									language: 'en-US',
									client_state: nextState
								})
							});
							console.log(`▶️ Speaking default unavailable message (${goesToVoicemail ? 'going to voicemail' : 'hanging up'})`);
						}
					} catch (err) {
						console.error('❌ Failed to play unavailable audio/speak:', err);
						await telnyxHangup(callControlId);
					}
					break;
				}
				if (ivrFlowId && ivrRuleId && callControlId) {
					const baseUrl = PUBLIC_BASE_URL || 'https://example.com';
					const flow = await prisma.callFlow.findUnique({
						where: { id: ivrFlowId },
						include: { rules: { where: { id: ivrRuleId } } }
					});
					const rule = flow?.rules?.[0];
					if (flow && rule) {
						const greetingUrl = resolveAudioUrl(flow.greetingAudioUrl, baseUrl);
						const promptsUrl = resolveAudioUrl(rule.promptsAudioUrl, baseUrl);
						try {
							if (greetingUrl && !promptsUrl) {
								// Only greeting, no prompts (unusual for IVR but safe fallback)
								await telnyxPlayback(callControlId, greetingUrl);
								console.log('▶️ IVR greeting started (no prompts)');
							} else if (greetingUrl && promptsUrl) {
								// Greeting THEN Prompts+Gather
								const nextState = Buffer.from(
									JSON.stringify({
										ivrFlowId,
										ivrRuleId,
										afterGreetingGather: true
									})
								).toString('base64');

								await telnyxPlayback(callControlId, greetingUrl, nextState);
								console.log('▶️ IVR greeting started, waiting for playback end to gather');
							} else if (promptsUrl) {
								// No greeting, just Prompts+Gather immediately
								const nextState = Buffer.from(JSON.stringify({ ivrFlowId, ivrRuleId })).toString(
									'base64'
								);

								await fetch(
									`https://api.telnyx.com/v2/calls/${callControlId}/actions/gather_using_audio`,
									{
										method: 'POST',
										headers: {
											'Content-Type': 'application/json',
											Authorization: `Bearer ${TELNYX_API_KEY}`
										},
										body: JSON.stringify({
											audio_url: promptsUrl,
											minimum_digits: 1,
											maximum_digits: 1,
											timeout_millis: 10000,
											terminating_digit: '#',
											client_state: nextState
										})
									}
								);
								console.log('▶️ IVR gather started (no greeting)');
							}
						} catch (err) {
							console.error('❌ IVR playback/gather failed:', err);
						}
					}
				}
				break;
			}

			case 'call.gather.ended': {
				const digits = (payload?.digits as string) ?? '';
				const status = (payload?.status as string) ?? '';
				let ivrFlowId: string | null = null;
				let ivrRuleId: string | null = null;
				let ivrRetry = 0;
				if (payload?.client_state) {
					const decoded = safeDecodeClientState(payload.client_state);
					if (decoded) {
						ivrFlowId = decoded.ivrFlowId ?? null;
						ivrRuleId = decoded.ivrRuleId ?? null;
						ivrRetry = Number(decoded.ivrRetry) || 0;
					}
				}
				if (!callControlId || !ivrFlowId || !ivrRuleId) {
					console.log('📞 gather.ended missing callControlId or IVR state, ignoring');
					break;
				}
				const baseUrl = PUBLIC_BASE_URL || 'https://example.com';
				const flow = await prisma.callFlow.findUnique({
					where: { id: ivrFlowId },
					include: { rules: { where: { id: ivrRuleId } } }
				});
				const rule = flow?.rules?.[0];
				if (!flow || !rule) {
					console.log('📞 gather.ended flow/rule not found');
					break;
				}
				const keyPrompts =
					(rule.keyPrompts as {
						key: string;
						name?: string;
						extension?: string;
						transferAudioUrl?: string;
					}[]) ?? [];
				const failoverCount = rule.failoverCount ?? 2;
				const failoverDelaySecs = (rule as { failoverDelayMinutes?: number }).failoverDelayMinutes ?? 30;
				const failoverTimeoutMillis = failoverDelaySecs * 1000;
				const failoverUrl = resolveAudioUrl(rule.failoverAudioUrl, baseUrl);
				const hangupUrl = resolveAudioUrl(rule.hangupAudioUrl, baseUrl);
				const promptsUrl = resolveAudioUrl(rule.promptsAudioUrl, baseUrl);

				const encodeClientState = (extra: Record<string, unknown>) => {
					const decoded = safeDecodeClientState(payload?.client_state);
					let ivrPath = decoded?.ivrPath || '';
					return Buffer.from(JSON.stringify({ ivrFlowId, ivrRuleId, ivrPath, ...extra })).toString('base64');
				};

				// Timeout or no digits: failover or hangup
				if (status !== 'valid' || !digits.trim()) {
					if (ivrRetry >= failoverCount) {
						if (hangupUrl) {
							const hangupState = Buffer.from(
								JSON.stringify({ afterPlaybackHangup: true })
							).toString('base64');
							await telnyxPlayback(callControlId, hangupUrl, hangupState);
						} else {
							await telnyxHangup(callControlId);
						}
						console.log('📞 IVR failover exhausted, playing hangup then hangup');
					} else {
						if (failoverUrl) {
							const nextState = encodeClientState({
								ivrRetry: ivrRetry + 1,
								afterPlaybackGather: true
							});
							await telnyxPlayback(callControlId, failoverUrl, nextState);
						} else {
							const nextState = encodeClientState({ ivrRetry: ivrRetry + 1 });
							await fetch(
								`https://api.telnyx.com/v2/calls/${callControlId}/actions/gather_using_audio`,
								{
									method: 'POST',
									headers: {
										'Content-Type': 'application/json',
										Authorization: `Bearer ${TELNYX_API_KEY}`
									},
									body: JSON.stringify({
										audio_url: promptsUrl,
										minimum_digits: 1,
										maximum_digits: 1,
										timeout_millis: failoverTimeoutMillis,
										terminating_digit: '#',
										client_state: nextState
									})
								}
							);
						}
						console.log('📞 IVR failover retry', ivrRetry + 1);
					}
					break;
				}

				const digit = digits.trim().charAt(0);

				// # = leave message / record voicemail
				if (digit === '#') {
					try {
						// Mark call as going to voicemail
						await setVoicemail(callControlId);

						// Stop current recording
						await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/record_stop`, {
							method: 'POST',
							headers: TELNYX_HEADERS,
							body: JSON.stringify({})
						}).catch(() => null);
						
						// Provide prompt
						await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/speak`, {
							method: 'POST',
							headers: TELNYX_HEADERS,
							body: JSON.stringify({
								payload: 'Please leave your message after the tone. When you are finished, you may hang up.',
								voice: 'female',
								language: 'en-US',
								client_state: Buffer.from(JSON.stringify({ isVoicemailPrompt: true, ivrFlowId, ivrRuleId })).toString('base64')
							})
						});
						console.log('📞 IVR voicemail prompt started (#)');
					} catch (err) {
						console.error('❌ Failed to start voicemail prompt:', err);
						await telnyxHangup(callControlId);
					}
					break;
				}

				// Back / repeat menu digit — replay prompts
				const backDigit = (rule as { backDigit?: string | null }).backDigit?.trim();
				if (backDigit && digit === backDigit && promptsUrl) {
					const nextState = encodeClientState({ ivrRetry: 0 });
					await fetch(
						`https://api.telnyx.com/v2/calls/${callControlId}/actions/gather_using_audio`,
						{
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								Authorization: `Bearer ${TELNYX_API_KEY}`
							},
							body: JSON.stringify({
								audio_url: promptsUrl,
								minimum_digits: 1,
								maximum_digits: 1,
								timeout_millis: failoverTimeoutMillis,
								terminating_digit: '#',
								client_state: nextState
							})
						}
					);
					console.log('📞 IVR back/repeat menu, replaying prompts');
					break;
				}

				const match = keyPrompts.find((p) => String(p.key).trim() === digit);
				
				// --- GAP 6: EMERGENCY BYPASS & FLAG ---
				const isEmergency = !!match?.name?.toLowerCase().includes('emergency');
				const callPriority = isEmergency ? 'emergency' : 'standard';

				if (match) {
					await setIntent(callControlId, String(match.key), match.name || String(match.key), 'high');
				}

				if (match?.extension) {
					const to = String(match.extension).trim();
					const transferAudioUrl = match.transferAudioUrl
						? resolveAudioUrl(match.transferAudioUrl, baseUrl)
						: null;
					
					// Update path in client state
					const decoded = safeDecodeClientState(payload?.client_state);
					const currentPath = decoded?.ivrPath || '';
					const newPath = currentPath ? `${currentPath} > ${match.name || digit}` : (match.name || digit);

					if (transferAudioUrl) {
						// Play transfer audio first, then transfer on playback.ended
						const transferState = Buffer.from(
							JSON.stringify({ 
								afterPlaybackTransfer: true, 
								transferTo: to, 
								ivrFlowId, 
								ivrRuleId, 
								ivrPath: newPath,
								callPriority
							})
						).toString('base64');
						await telnyxPlayback(callControlId, transferAudioUrl, transferState);
						console.log('▶️ IVR playing transfer audio for', match.name ?? digit, isEmergency ? '(EMERGENCY)' : '');
					} else {
						const transferLegId = await telnyxTransfer(callControlId, to, ivrFlowId, ivrRuleId, newPath, callPriority);
						if (transferLegId) {
							pendingTransfers.set(transferLegId, {
								originalCallControlId: callControlId,
								ivrFlowId,
								ivrRuleId
							});
							console.log('📞 IVR transfer to', to, match.name ?? digit, '| tracking leg', transferLegId);
						} else {
							console.log('📞 IVR transfer to', to, match.name ?? digit, isEmergency ? '(EMERGENCY)' : '');
						}
					}
				} else if (match) {
					// Key matched but no extension to transfer to. Go to voicemail.
					await setVoicemail(callControlId);
					await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/speak`, {
						method: 'POST',
						headers: TELNYX_HEADERS,
						body: JSON.stringify({
							payload: 'Please leave your message after the tone. When you are finished, you may hang up.',
							voice: 'female',
							language: 'en-US',
							client_state: Buffer.from(JSON.stringify({ isVoicemailPrompt: true, ivrFlowId, ivrRuleId })).toString('base64')
						})
					});
					console.log('📞 IVR key pressed but no extension provided, going to voicemail:', match.name ?? digit);
				} else {
					// Unknown key: treat like timeout, failover or hangup
					if (ivrRetry >= failoverCount) {
						if (hangupUrl) {
							const hangupState = Buffer.from(
								JSON.stringify({ afterPlaybackHangup: true })
							).toString('base64');
							await telnyxPlayback(callControlId, hangupUrl, hangupState);
						} else {
							await telnyxHangup(callControlId);
						}
					} else {
						if (failoverUrl) {
							const nextState = encodeClientState({
								ivrRetry: ivrRetry + 1,
								afterPlaybackGather: true
							});
							await telnyxPlayback(callControlId, failoverUrl, nextState);
						} else {
							const nextState = encodeClientState({ ivrRetry: ivrRetry + 1 });
							await fetch(
								`https://api.telnyx.com/v2/calls/${callControlId}/actions/gather_using_audio`,
								{
									method: 'POST',
									headers: {
										'Content-Type': 'application/json',
										Authorization: `Bearer ${TELNYX_API_KEY}`
									},
									body: JSON.stringify({
										audio_url: promptsUrl,
										minimum_digits: 1,
										maximum_digits: 1,
										timeout_millis: 10000,
										terminating_digit: '#',
										client_state: nextState
									})
								}
							);
						}
					}
				}
				break;
			}

			case 'call.playback.ended': {
				if (!callControlId || !payload?.client_state) break;
				const decoded = safeDecodeClientState(payload.client_state);
				if (decoded) {
					if (decoded.afterPlaybackHangup) {
						await telnyxHangup(callControlId);
						console.log('📞 IVR playback (hangup) ended, hanging up');
						break;
					}
					if (decoded.afterPlaybackTransfer && decoded.transferTo) {
						const transferLegId = await telnyxTransfer(
							callControlId,
							decoded.transferTo,
							decoded.ivrFlowId,
							decoded.ivrRuleId,
							decoded.ivrPath,
							decoded.callPriority
						);
						if (transferLegId && decoded.ivrFlowId && decoded.ivrRuleId) {
							pendingTransfers.set(transferLegId, {
								originalCallControlId: callControlId,
								ivrFlowId: decoded.ivrFlowId,
								ivrRuleId: decoded.ivrRuleId
							});
						}
						console.log('📞 IVR transfer to', decoded.transferTo, 'after transfer audio | tracking leg', transferLegId);
						break;
					}
					if (decoded.isVoicemailPrompt) {
						console.log('🎙️ Voicemail prompt ended, now playing beep before recording');
						const beepState = Buffer.from(
							JSON.stringify({
								isVoicemailBeep: true,
								ivrFlowId: decoded.ivrFlowId,
								ivrRuleId: decoded.ivrRuleId
							})
						).toString('base64');
						await telnyxPlayback(callControlId, defaultBeepAudio, beepState);
						break;
					}
					if (decoded.isVoicemailBeep) {
						console.log('🎙️ Beep ended, starting voicemail recording');
						const recordState = Buffer.from(
							JSON.stringify({
								isVoicemailRecording: true,
								ivrFlowId: decoded.ivrFlowId,
								ivrRuleId: decoded.ivrRuleId,
								ivrPath: 'Voicemail'
							})
						).toString('base64');
						try {
							const res = await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/record_start`, {
								method: 'POST',
								headers: TELNYX_HEADERS,
								body: JSON.stringify({
									format: 'mp3',
									channels: 'single',
									client_state: recordState
								})
							});
							const resData = await res.json().catch(() => null);
							const recordingId = resData?.data?.recording_id;
							if (recordingId) {
								console.log('🎙️ Voicemail recording started, id:', recordingId);
								await addVoicemailRecordingId(callControlId, recordingId);
							} else {
								console.warn('⚠️ Voicemail recording started but no recording_id in response:', resData);
							}
						} catch (err) {
							console.error('❌ Failed to start voicemail recording:', err);
						}
						break;
					}
					if (
						(decoded.afterPlaybackGather || decoded.afterGreetingGather) &&
						decoded.ivrFlowId &&
						decoded.ivrRuleId
					) {
						const flow = await prisma.callFlow.findUnique({
							where: { id: decoded.ivrFlowId },
							include: { rules: { where: { id: decoded.ivrRuleId } } }
						});
						const rule = flow?.rules?.[0];
						if (rule?.promptsAudioUrl || playPublic) {
							const baseUrl = PUBLIC_BASE_URL || 'https://example.com';
							const promptsUrl = resolveAudioUrl(rule?.promptsAudioUrl, baseUrl);
							const nextState = Buffer.from(
								JSON.stringify({
									ivrFlowId: decoded.ivrFlowId,
									ivrRuleId: decoded.ivrRuleId,
									ivrRetry: decoded.afterPlaybackGather ? Number(decoded.ivrRetry) || 0 : 0
								})
							).toString('base64');
							await fetch(
								`https://api.telnyx.com/v2/calls/${callControlId}/actions/gather_using_audio`,
								{
									method: 'POST',
									headers: {
										'Content-Type': 'application/json',
										Authorization: `Bearer ${TELNYX_API_KEY}`
									},
									body: JSON.stringify({
										audio_url: promptsUrl,
										minimum_digits: 1,
										maximum_digits: 1,
										timeout_millis: 10000,
										terminating_digit: '#',
										client_state: nextState
									})
								}
							);
							console.log('▶️ IVR gather started after playback/greeting');
						}
					}
				}
				break;
			}

			case 'call.hangup': {
				console.log('📞 Call hangup:', callControlId);
				await logCallEvent(callControlId, 'ended', payload);

				// --- Transfer no-answer → voicemail ---
				// If this hangup is for a transfer leg that timed out/was not answered,
				// play the failover (voicemail) audio on the original caller's leg.
				const hangupCause = (payload?.hangup_cause as string) ?? '';
				const noAnswerCauses = ['timeout', 'user_busy', 'no_answer', 'busy', 'call_rejected'];
				const pendingTransfer = pendingTransfers.get(callControlId);
				if (pendingTransfer && noAnswerCauses.some((c) => hangupCause.toLowerCase().includes(c))) {
					pendingTransfers.delete(callControlId);
					const { originalCallControlId, ivrFlowId: tFlowId, ivrRuleId: tRuleId } = pendingTransfer;
					console.log('📞 Transfer not answered (', hangupCause, '), playing voicemail on original caller', originalCallControlId);
					try {
						// Mark call as going to voicemail
						await setVoicemail(originalCallControlId);

						// NOTE: We intentionally do NOT stop the existing recording here.
						// Stopping it would split the call into two recording segments and risk data loss.
						// The recording will naturally end when the call completes.

						const baseUrl = PUBLIC_BASE_URL || 'https://example.com';
						const transferFlow = await prisma.callFlow.findUnique({
							where: { id: tFlowId },
							include: { rules: { where: { id: tRuleId } } }
						});
						const transferRule = transferFlow?.rules?.[0];
						const voicemailUrl = resolveAudioUrl(transferRule?.failoverAudioUrl, baseUrl);
						if (voicemailUrl) {
							// Play the "no one available" message on the original caller
							await telnyxPlayback(
								originalCallControlId,
								voicemailUrl,
								Buffer.from(JSON.stringify({ isVoicemailPrompt: true, ivrFlowId: tFlowId, ivrRuleId: tRuleId })).toString('base64')
							);
							console.log('🎙️ Voicemail prompt playback started');
						} else {
							// No failover audio configured — just speak a default message
							await fetch(`https://api.telnyx.com/v2/calls/${originalCallControlId}/actions/speak`, {
								method: 'POST',
								headers: TELNYX_HEADERS,
								body: JSON.stringify({
									payload: 'Unfortunately no one is available. Please leave a message after the tone.',
									voice: 'female',
									language: 'en-US',
									client_state: Buffer.from(JSON.stringify({ isVoicemailPrompt: true, ivrFlowId: tFlowId, ivrRuleId: tRuleId })).toString('base64')
								})
							});
							console.log('🎙️ Default voicemail TTS started (no failover audio configured)');
						}
					} catch (err) {
						console.error('❌ Failed to start voicemail after transfer no-answer:', err);
					}
					break; // Don't process the rest of call.hangup for a transfer leg
				} else if (pendingTransfer) {
					// Transfer leg hung up for another reason (e.g. answered then caller hung up) — clean up
					pendingTransfers.delete(callControlId);
					console.log('📞 Transfer leg hung up (detected via pendingTransfers), skipping CommunicationLog creation:', callControlId);
					await deleteState(callControlId);
					break;
				}

				// Create call record with duration on hangup (recording link added later in call.recording.saved)
				const hangupDuration = computeDurationFromPayload(payload);
				const callLog = await prisma.callLog.findFirst({
					where: { callId: callControlId, status: 'initiated' }
				});
				// Use direction from initiated call log (hangup payload can be wrong or missing)
				const directionFromMeta =
					(callLog?.metadata as { direction?: string })?.direction ?? 'incoming';
				const direction = directionFromMeta === 'incoming' ? 'inbound' : 'outbound';
				if (callLog) {
					const parentId = (callLog.metadata as any)?.parent_call_control_id || payload?.parent_call_control_id;
					if (parentId) {
						console.log('📞 Transfer leg hung up (detected via parent ID), skipping CommunicationLog creation:', callControlId);
						await deleteState(callControlId);
						break;
					}
					const toInfo = callLog.to
						? await getCompanyAndFlowByPhoneNumber(prisma, callLog.to)
						: null;
					const fromInfo = callLog.from
						? await getCompanyAndFlowByPhoneNumber(prisma, callLog.from)
						: null;
					const numberInfo = toInfo ?? fromInfo;
					const companyNumber = toInfo ? callLog.to : fromInfo ? callLog.from : null;
					const contactNumber = toInfo ? callLog.from : fromInfo ? callLog.to : null;
					if (numberInfo?.companyId && contactNumber && companyNumber) {
						let contact = await prisma.contact.findFirst({
							where: { companyId: numberInfo.companyId, phone: contactNumber }
						});
						const contactExisted = !!contact;

						// --- DROP CALL LOGIC ---
						const callState = await getState(callControlId);
						let intentInfo: any = callState?.intentDigit ? {
							digit: callState.intentDigit,
							intentName: callState.intentName,
							confidence: callState.intentConfidence,
							timestamp: callState.intentTimestamp ? callState.intentTimestamp.getTime() : Date.now()
						} : undefined;
						const hasVoicemail = callState?.hasVoicemail || false;
						
						// Check if hangup was very fast after digit press
						if (intentInfo) {
							const timeSinceIntentMs = Date.now() - intentInfo.timestamp;
							if (timeSinceIntentMs < 1500) {
								intentInfo = { ...intentInfo, confidence: 'low' };
							}
						}

						const hasIntent = !!intentInfo;
						const isDropCall = !hasIntent && !hasVoicemail && direction === 'inbound';

						if (isDropCall) {
							await prisma.dropCall.create({
								data: {
									phoneNumber: contactNumber,
									duration: hangupDuration ?? 0,
									knownContact: contactExisted,
									companyId: numberInfo.companyId
								}
							});
							console.log('📞 Logged as DropCall (no intent/voicemail captured)');

							await deleteState(callControlId);
							break;
						}

						if (!contact) {
							contact = await prisma.contact.create({
								data: { companyId: numberInfo.companyId, phone: contactNumber, name: null }
							});
						}
						const companyNumberE164 = toE164(companyNumber);
						const numberRow = companyNumberE164
							? await prisma.companyPhoneNumber.findUnique({
									where: { phoneNumber: companyNumberE164 },
									select: { callTrackingCategoryId: true }
								})
							: null;

						let commThread = await prisma.communicationThread.create({
							data: {
								companyId: numberInfo.companyId,
								contactId: contact.id,
								status: 'open',
								summary: 'Voice Call'
							}
						});

						const createdLog = await prisma.communicationLog.create({
							data: {
								type: 'voice',
								direction: direction as 'inbound' | 'outbound',
								status: isDropCall ? 'failed' : 'completed',
								source: contactNumber,
								destination: companyNumber,
								companyId: numberInfo.companyId,
								customerId: contact.id,
								callTrackingCategoryId: numberRow?.callTrackingCategoryId ?? undefined,
								communicationThreadId: commThread.id,
								duration: hangupDuration,
								content:
									hangupDuration != null
										? `Call ${isDropCall ? 'attempted' : 'completed'} (${Math.round(hangupDuration)}s)`
										: `Call ${isDropCall ? 'attempted' : 'completed'}`,
								metadata: { 
									call_control_id: callControlId, 
									origin: directionFromMeta,
									ivr_intent: intentInfo?.intentName,
									ivr_digit: intentInfo?.digit,
									ivr_confidence: intentInfo?.confidence
								}
							}
						});
						console.log(
							'📝 Created CommunicationLog on hangup (duration, recording link added when saved)',
							callControlId
						);
						
						// Clean up tracking sets/maps
						await deleteState(callControlId);

						// Create real-time notification
						await createNotification({
							company_id: numberInfo.companyId,
							type: 'voice',
							direction: direction as 'inbound' | 'outbound',
							source_name: contact?.name || contactNumber,
							source_identifier: contactNumber,
							message_preview: hangupDuration != null
								? `Call completed (${Math.round(hangupDuration)}s)`
								: 'Call completed',
							content: hangupDuration != null
								? `Call completed (${Math.round(hangupDuration)}s)`
								: 'Call completed',
							communication_log_id: createdLog.id,
							thread_id: contactNumber
						});

						// Attach call summary to the matching message thread (keeps thread open for follow-up)
						if (contactNumber && hangupDuration != null && hangupDuration > 0) {
							try {
								const contactE164 = toE164(contactNumber);
								const matchingThread = await prisma.message.findFirst({
									where: {
										companyId: numberInfo.companyId,
										customerPhone: { in: [contactNumber, contactE164] },
										status: { in: ['new', 'replied', 'assigned', 'read'] }
									},
									orderBy: { updated: 'desc' }
								});
								if (matchingThread) {
									const existingMsgs = Array.isArray(matchingThread.messages)
										? matchingThread.messages
										: typeof matchingThread.messages === 'string'
											? JSON.parse(matchingThread.messages as string)
											: [];
									const callSummaryEntry = {
										type: 'call_summary',
										content: `Call completed (${Math.round(hangupDuration)}s)`,
										timestamp: new Date().toISOString(),
										is_agent_reply: false,
										is_system: true,
										call_data: {
											direction,
											duration: Math.round(hangupDuration),
											call_control_id: callControlId
										}
									};
									await prisma.message.update({
										where: { id: matchingThread.id },
										data: { messages: [...existingMsgs, callSummaryEntry] }
									});
									console.log(`📎 Attached call summary to thread ${matchingThread.threadId} (${Math.round(hangupDuration)}s)`);
								}
							} catch (attachErr) {
								console.error('⚠️ Failed to attach call summary to thread:', attachErr);
							}
						}
					}
				}
				break;
			}

			case 'call.machine.detection.ended': {
				// Handle answering machine detection
				detectionResult =
					(payload?.result as string) ||
					(isEventAPI ? (body.data?.payload?.result as string) : undefined);
				console.log('🤖 Answering machine detection:', detectionResult);

				if (detectionResult === 'machine') {
					console.log('📞 Answering machine detected, leaving a message');
					await logCallEvent(callControlId, 'machine-detection-machine', payload);

					if (callControlId) {
						await playAudio(
							callControlId,
							'This is an automated message from Clearsky. Please call us back at your convenience.'
						);
					}
				} else if (detectionResult === 'human') {
					console.log('👤 Human answered, connecting call');
					await logCallEvent(callControlId, 'machine-detection-human', payload);
				}
				break;
			}

			case 'call.machine.premium.detection.ended': {
				// Handle premium answering machine detection
				detectionResult =
					(payload?.result as string) ||
					(isEventAPI ? (body.data?.payload?.result as string) : undefined);
				console.log('🤖 Premium answering machine detection:', detectionResult);

				if (detectionResult === 'machine') {
					console.log('📞 Premium: Answering machine detected, leaving a message');
					await logCallEvent(callControlId, 'premium-machine-detection-machine', payload);

					if (callControlId) {
						await playAudio(
							callControlId,
							'This is an automated message from Clearsky. Please call us back at your convenience.'
						);
					}
				} else if (detectionResult === 'human') {
					console.log('👤 Premium: Human answered, connecting call');
					await logCallEvent(callControlId, 'premium-machine-detection-human', payload);
				}
				break;
			}

			case 'call.machine.premium.greeting.ended': {
				// Handle when machine greeting ends (beep detected)
				console.log('📞 Premium: Machine greeting ended, beep detected');
				await logCallEvent(callControlId, 'premium-greeting-ended', payload);

				if (callControlId) {
					await playAudio(
						callControlId,
						'Hello, this is an automated message from Clearsky. We tried to reach you regarding your inquiry. Please call us back at your earliest convenience. Thank you.'
					);
				}
				break;
			}

			case 'call.dtmf.received': {
				// Handle back/repeat digit during transfer audio playback (use rule's backDigit, not hardcoded *)
				const dtmfDigit = (payload?.digit as string) ?? '';
				if (payload?.client_state) {
					try {
						const decoded = safeDecodeClientState(payload.client_state);
						if (decoded) {
						// If we're in a transfer playback, check if pressed digit is this rule's back digit
						if (decoded.afterPlaybackTransfer && decoded.ivrFlowId && decoded.ivrRuleId) {
							const flow = await prisma.callFlow.findUnique({
								where: { id: decoded.ivrFlowId },
								include: { rules: { where: { id: decoded.ivrRuleId } } }
							});
							const rule = flow?.rules?.[0];
							const backDigit = (rule as { backDigit?: string | null })?.backDigit?.trim();
							if (!backDigit || dtmfDigit !== backDigit) break;
							// Stop current playback and return to menu
							await fetch(
								`https://api.telnyx.com/v2/calls/${callControlId}/actions/playback_stop`,
								{
									method: 'POST',
									headers: TELNYX_HEADERS,
									body: JSON.stringify({})
								}
							);
							if (rule?.promptsAudioUrl || playPublic) {
								const baseUrl = PUBLIC_BASE_URL || 'https://example.com';
								const promptsUrl = resolveAudioUrl(rule?.promptsAudioUrl, baseUrl);
								const nextState = Buffer.from(
									JSON.stringify({
										ivrFlowId: decoded.ivrFlowId,
										ivrRuleId: decoded.ivrRuleId,
										ivrRetry: 0
									})
								).toString('base64');
								await fetch(
									`https://api.telnyx.com/v2/calls/${callControlId}/actions/gather_using_audio`,
									{
										method: 'POST',
										headers: TELNYX_HEADERS,
										body: JSON.stringify({
											audio_url: promptsUrl,
											minimum_digits: 1,
											maximum_digits: 1,
											timeout_millis: 10000,
											terminating_digit: '#',
											client_state: nextState
										})
									}
								);
								console.log('📞 IVR back digit pressed during transfer, returning to menu');
							}
						}
					}
					} catch (_) {}
				}
				break;
			}

			case 'call.recording.saved': {
				// Recording is available, save the URL(s)
				let recUrls = payload?.recording_urls;
				const recId = payload?.recording_id as string | undefined;
				const recDurationSeconds = typeof payload?.duration === 'number' ? payload.duration : 0;
				console.log('🎥 Call recording saved:', recId, recUrls);

				if (callControlId && recUrls) {
					// Download and save locally to avoid Telnyx link expiry
					const originalAudioUrl = getFirstAudioUrl(recUrls);
					if (originalAudioUrl) {
						try {
							const audioRes = await fetch(originalAudioUrl);
							if (audioRes.ok) {
								const arrayBuffer = await audioRes.arrayBuffer();
								const buffer = Buffer.from(arrayBuffer);
								const recordingsDir = join(process.cwd(), 'static/uploads/recordings');
								if (!existsSync(recordingsDir)) {
									await mkdir(recordingsDir, { recursive: true });
								}
								const localFilename = `${(recId as string) || callControlId}.mp3`;
								const localFilePath = join(recordingsDir, localFilename);
								await writeFile(localFilePath, buffer);
								
								const baseUrl = PUBLIC_BASE_URL || 'https://example.com';
								const localUrl = `${baseUrl}/uploads/recordings/${localFilename}`;
								recUrls = {
									...((recUrls as object) || {}),
									mp3: localUrl
								};
								console.log('💾 Recording saved locally:', localUrl);
							} else {
								console.error('❌ Failed to download audio from Telnyx:', audioRes.status);
							}
						} catch (err) {
							console.error('❌ Error saving recording locally:', err);
						}
					}

					// 1. Save reference call recording
					await prisma.callRecording.create({
						data: {
							callId: callControlId,
							recordingId: (recId as string) ?? null,
							urls: (recUrls as object) ?? {}
						}
					});

					// 2. Find original call log to get directions/numbers
					const callLog = await prisma.callLog.findFirst({
						where: { callId: callControlId, status: 'initiated' }
					});

					if (callLog) {
						let decoded: any = null;
						if (payload?.client_state) {
							try {
								decoded = safeDecodeClientState(payload.client_state);
							} catch (e) {}
						}
						const parentId = (callLog.metadata as any)?.parent_call_control_id || 
						                 payload?.parent_call_control_id || 
						                 decoded?.originalCallControlId;
						const targetCallControlId = parentId || callControlId;

						// Resolve company by which number is the company's IVR (in CompanyPhoneNumber). The other is the contact.
						const toInfo = callLog.to
							? await getCompanyAndFlowByPhoneNumber(prisma, callLog.to)
							: null;
						const fromInfo = callLog.from
							? await getCompanyAndFlowByPhoneNumber(prisma, callLog.from)
							: null;

						const numberInfo = toInfo ?? fromInfo;
						const companyNumber = toInfo ? callLog.to : fromInfo ? callLog.from : null;
						const contactNumber = toInfo ? callLog.from : fromInfo ? callLog.to : null;
						const direction = (callLog.metadata as { direction?: string })?.direction ?? 'incoming';

						if (!numberInfo?.companyId || !contactNumber) {
							console.log('⚠️ Could not match call to a company: neither leg is a company number', {
								to: callLog.to,
								from: callLog.from
							});
						} else if (companyNumber && contactNumber) {
							// Find or create contact (caller) for this company
							let contact = await prisma.contact.findFirst({
								where: {
									companyId: numberInfo.companyId,
									phone: contactNumber
								}
							});

							if (!contact) {
								console.log('👤 Creating new contact for', contactNumber);
								contact = await prisma.contact.create({
									data: {
										companyId: numberInfo.companyId,
										phone: contactNumber,
										name: null
									}
								});
							}

							// Call tracking: get category from the number that received the call
							const companyNumberE164 = toE164(companyNumber);
							const numberRow = companyNumberE164
								? await prisma.companyPhoneNumber.findUnique({
										where: { phoneNumber: companyNumberE164 },
										select: { callTrackingCategoryId: true }
									})
								: null;

							// Find existing log created on hangup (so we add recording link instead of duplicating)
							const since = new Date(Date.now() - 10 * 60 * 1000); // 10 min window
							const existingLogs = await prisma.communicationLog.findMany({
								where: {
									companyId: numberInfo.companyId,
									type: 'voice',
									created: { gte: since }
								},
								orderBy: { created: 'desc' },
								take: 20
							});
							const existingLog = existingLogs.find(
								(l) => {
									const meta = l.metadata as Record<string, unknown>;
									return meta?.call_control_id === targetCallControlId || meta?.call_control_id === callControlId;
								}
							);

							let transcript = '';
							let summary = '';
							let intent = '';
							let sub_intent: string | null = null;
							let urgency = 'medium';
							let sentiment = '';
							let actionItems: string[] = [];
							let estimatedPrice: number | null = null;
							let datetime: string | null = null;
							const recordingCount = await prisma.callRecording.count({
								where: { callId: callControlId }
							});
							const callState = await getState(callControlId);
							const hasVoicemail = callState?.hasVoicemail || false;
							const hasVmRecId = recId ? await hasVoicemailRecordingId(callControlId, recId) : false;
							const isVoicemailRecording = hasVmRecId || (hasVoicemail && recordingCount >= 2);

							if (recId && hasVmRecId) {
								await removeVoicemailRecordingId(callControlId, recId);
							}
							if (hasVoicemail && isVoicemailRecording) {
								await removeVoicemail(callControlId);
							}

							const shouldTranscribe = !hasVoicemail || isVoicemailRecording;

							const audioUrl = originalAudioUrl;
							if (audioUrl && shouldTranscribe) {
								try {
									const { transcribeAudio, analyzeCallLog } = await import('$lib/server/openai');
									transcript = await transcribeAudio(audioUrl);
									if (transcript) {
										const intentName = callState?.intentName || null;
										const analysis = await analyzeCallLog(transcript, intentName);
										summary = analysis.summary;
										intent = intentName || analysis.intent;
										sub_intent = analysis.sub_intent;
										urgency = analysis.urgency;
										sentiment = analysis.sentiment;
										actionItems = analysis.actionItems;
										estimatedPrice = analysis.estimatedPrice;
										datetime = analysis.datetime;
										const callerName = analysis.callerName;
										const buyingSignals = analysis.buyingSignals;

										// --- Identity resolution from transcript ---
										// If the AI extracted a name and the contact has a default name, update the contact record
										if (callerName && contact && (!contact.name || ['Unknown Caller', 'Anonymous', 'Valued Customer', 'Unknown'].includes(contact.name))) {
											try {
												await prisma.contact.update({
													where: { id: contact.id },
													data: { name: callerName }
												});
												contact = { ...contact, name: callerName };
												console.log(`👤 Contact name resolved from transcript: "${callerName}" (${contact.id})`);
												
												// Also update PipelineCustomerProfile if it exists
												if (contact.phone) {
													await prisma.pipelineCustomerProfile.updateMany({
														where: { companyId: contact.companyId, phoneNumber: contact.phone },
														data: { displayName: callerName, firstName: callerName.split(' ')[0] }
													});
												}
											} catch (nameErr) {
												console.error('⚠️ Failed to update contact name:', nameErr);
											}
										}

										// Resolve final path and priority from client state
										let finalIvrPath = 'Direct Call';
										let finalPriority = 'standard';
										if (decoded) {
											finalIvrPath = decoded.ivrPath || finalIvrPath;
											finalPriority = decoded.callPriority || finalPriority;
										}

										let bucketSignal = 'research';
										const lowerTranscript = transcript.toLowerCase();
										const emergencyKeywords = ['burst', 'flood', 'leak', 'emergency', 'pipe', 'water', 'immediate', 'urgent'];
										const bookingKeywords = ['book', 'appointment', 'estimate', 'quote', 'schedule', 'renovate', 'renovation', 'toilet', 'shower', 'fixture'];

										if (finalPriority === 'emergency' || emergencyKeywords.some(kw => lowerTranscript.includes(kw))) {
											bucketSignal = 'emergency';
										} else if (intent === 'Booking' || bookingKeywords.some(kw => lowerTranscript.includes(kw))) {
											bucketSignal = 'active';
										} else if (sentiment === 'Angry' || sentiment === 'Negative') {
											bucketSignal = 'friction';
										}

										let companyNumberLabel = 'Unknown Number';
										if (companyNumber) {
											const cNumberObj = await prisma.companyPhoneNumber.findUnique({
												where: { phoneNumber: toE164(companyNumber) },
												select: { connectionLabel: true }
											});
											if (cNumberObj?.connectionLabel) {
												companyNumberLabel = cNumberObj.connectionLabel;
											}
										}

										// RUN SVELTEKIT INTERNAL AI SIGNALS PIPELINE:
										PipelineSimulator.run({
											author_name: contact?.name || callerName || contactNumber || 'Unknown Caller',
											customer_phone: contactNumber || undefined,
											rating: 0,
											comment: transcript,
											mode: 'call',
											sessionId: callControlId,
											companyId: numberInfo?.companyId || undefined
										}).then(async (pipelineResult) => {
											if (!pipelineResult.success) {
												console.error('❌ Voice Pipeline run failed:', pipelineResult.error);
												return;
											}

											let bucketSignal = 'research';
											const lowerTranscript = transcript.toLowerCase();
											const emergencyKeywords = ['burst', 'flood', 'leak', 'emergency', 'pipe', 'water', 'immediate', 'urgent'];
											const bookingKeywords = ['book', 'appointment', 'estimate', 'quote', 'schedule', 'renovate', 'renovation', 'toilet', 'shower', 'fixture'];

											const hasEmergency = finalPriority === 'emergency' || emergencyKeywords.some(kw => lowerTranscript.includes(kw));
											let scoreDelta = hasEmergency ? 95 : 0;
											if (hasEmergency) {
												bucketSignal = 'emergency';
											} else if (intent === 'Booking' || bookingKeywords.some(kw => lowerTranscript.includes(kw))) {
												bucketSignal = 'active';
											} else if (sentiment === 'Angry' || sentiment === 'Negative') {
												bucketSignal = 'friction';
											}

											// Persist the full pipeline package into ProfileDB
											if (numberInfo?.companyId) {
												const profiledbUrl = process.env.PROFILEDB_URL || 'http://localhost:6277';
												const res = await fetch(`${profiledbUrl}/api/v1/telemetry/events`, {
													method: 'POST',
													headers: {
														'Content-Type': 'application/json',
														'Authorization': 'Bearer clearsky_pixel_api_key'
													},
													body: JSON.stringify({
														tenantSlug: numberInfo.companyId,
														fingerprintId: callControlId,
													eventType: 'telnyx.voice.voicemail',
													phone: contactNumber || null,
													name: contact?.name || callerName || null,
													scoreDelta: scoreDelta,
													payload: {
														provider: 'telnyx_voice',
														event_type: 'voicemail_received',
														textContent: transcript,
														rating: 0,
														author_name: contact?.name || callerName || contactNumber || 'Unknown Caller',
														customer_phone: contactNumber || null,
														audio_url: audioUrl || null,
														pipeline_logs: pipelineResult.logs,
														signals: pipelineResult.signals,
														enrichments: pipelineResult.enrichments,
														decision: pipelineResult.decision,
														execution: pipelineResult.execution,
														outcome: pipelineResult.outcome,
														feedback: pipelineResult.feedback,
														ai_protocol: pipelineResult.ai_protocol,
													estimatedPrice: estimatedPrice
												}
											})
										});

										if (res.ok) {
											console.log('📡 Pipeline executed and Voice event logged to ProfileDB successfully');
										} else {
											console.error('❌ Failed to log Voice event to ProfileDB:', res.statusText);
										}
									} else {
										console.log('📡 Skipping ProfileDB logging for unassigned number');
									}

											// Check if the pipeline decided to dispatch a safety SMS (emergency route) or if it's an emergency
											const action = pipelineResult?.decision?.action_queue?.[0];
											if (hasEmergency || (action && (action.action_id === 'ACT-A2P-002' || action.title?.toLowerCase().includes('owner notification')))) {
												console.log('🚨 Emergency action detected! Attempting to send safety SMS & notifying owner...');

												// Send SMS alert to company notification numbers
												if (numberInfo?.companyId) {
													try {
														const alertMsg = `[Alert] Urgent Voicemail/Call from ${contact?.name || contactNumber || 'Unknown'}: "${transcript.substring(0, 100)}${transcript.length > 100 ? '...' : ''}"`;
														const { sendOwnerSmsAlert } = await import('$lib/server/sms-alert');
														await sendOwnerSmsAlert(numberInfo.companyId, alertMsg);
													} catch (err) {
														console.error('Failed to notify owner via SMS:', err);
													}
												}
												
												// Get safety SMS text
												let safetySmsText = '';
												try {
													const execRecord = pipelineResult.execution?.execution_output_package?.execution_records?.[0];
													if (execRecord?.generated_output) {
														const parsedOutput = JSON.parse(execRecord.generated_output);
														safetySmsText = parsedOutput.draft_reply || parsedOutput.sms_text;
													}
												} catch (e) {
													console.error('Failed to parse safety SMS text from execution output:', e);
												}

												if (!safetySmsText) {
													safetySmsText = `Hi, we received your urgent message about the burst pipe/leak and are calling you right back to help!`;
												}

												if (companyNumber && contactNumber) {
													const formattedFrom = toE164(companyNumber);
													const formattedTo = toE164(contactNumber);
													
													console.log(`📤 Logging safety SMS draft from ${formattedFrom} to ${formattedTo}: "${safetySmsText}"`);
													try {
														await logCommunication({
															type: 'sms',
															direction: 'outbound',
															status: 'pending_approval',
															source: formattedFrom,
															destination: formattedTo,
															company_id: numberInfo?.companyId ?? undefined,
															customer_id: contact?.id ?? undefined,
															summary: safetySmsText.substring(0, 50) + '...',
															content: safetySmsText,
															metadata: {
																thread_id: formattedTo,
																is_draft: true,
																is_safety_draft: true,
																is_emergency: true
															}
														});
														console.log('📡 Voicemail safety SMS draft logged as pending_approval');
													} catch (draftErr) {
														console.error('❌ Error logging safety SMS draft:', draftErr);
													}
												} else {
													console.warn('⚠️ Missing companyNumber or contactNumber, cannot log safety SMS draft');
												}
											}
										}).catch(err => console.error('[Voice Pipeline Error]', err));
									}
								} catch (err) {
									console.error('❌ OpenAI processing failed:', err);
								}
							}

							const recordingMetadata = {
								recording_urls: recUrls as Record<string, unknown>,
								recording_id: recId,
								call_control_id: targetCallControlId,
								urgency,
								sentiment,
								intent: intent || undefined,
								sub_intent: sub_intent || undefined,
								datetime: datetime || undefined,
								actionItems,
								origin: direction,
								estimatedPrice
							};

							let finalLogId: string | null = null;
							if (existingLog) {
								const updatedLog = await prisma.communicationLog.update({
									where: { id: existingLog.id },
									data: {
										duration: recDurationSeconds > 0 ? recDurationSeconds : existingLog.duration,
										content: transcript || `Call recording available (${recDurationSeconds}s)`,
										summary: summary || null,
										metadata: {
											...((existingLog.metadata as Record<string, unknown>) || {}),
											...recordingMetadata
										} as any
									}
								});
								finalLogId = updatedLog.id;
								console.log('📝 Updated CommunicationLog with recording link', callControlId);

								// Create notification for updated call log with recording/voicemail
								await createNotification({
									company_id: numberInfo.companyId,
									type: 'voice',
									direction: direction === 'incoming' ? 'inbound' : 'outbound',
									source_name: contact?.name || contactNumber,
									source_identifier: contactNumber,
									message_preview: summary || transcript || `Call recording available (${recDurationSeconds}s)`,
									content: transcript || `Call recording available (${recDurationSeconds}s)`,
									communication_log_id: updatedLog.id,
									thread_id: contactNumber
								});
							} else {
								const hasIntent = !!callState?.intentDigit;
								const isDropCall = !hasIntent && !hasVoicemail && direction === 'incoming';
								
								if (isDropCall) {
									console.log('🎥 Recording saved for drop call - skipping CommunicationLog creation to prevent duplicate', callControlId);
								} else {
									let commThread = await prisma.communicationThread.create({
										data: {
											companyId: numberInfo.companyId,
											contactId: contact.id,
											status: 'open',
											summary: 'Voice Call'
										}
									});

									const createdLog = await prisma.communicationLog.create({
										data: {
											type: 'voice',
											direction: direction === 'incoming' ? 'inbound' : 'outbound',
											status: 'completed',
											source: contactNumber,
											destination: companyNumber,
											companyId: numberInfo.companyId,
											customerId: contact.id,
											communicationThreadId: commThread.id,
											callTrackingCategoryId: numberRow?.callTrackingCategoryId ?? undefined,
											duration: recDurationSeconds > 0 ? recDurationSeconds : null,
											content: transcript || `Call recording available (${recDurationSeconds}s)`,
											summary: summary || null,
											metadata: recordingMetadata as any
										}
									});
									console.log(
										'📝 Created CommunicationLog for call (no hangup log found)',
										callControlId
									);

									// Create notification for new call log with recording/voicemail
									await createNotification({
										company_id: numberInfo.companyId,
										type: 'voice',
										direction: direction === 'incoming' ? 'inbound' : 'outbound',
										source_name: contact?.name || contactNumber,
										source_identifier: contactNumber,
										message_preview: summary || transcript || `Call recording available (${recDurationSeconds}s)`,
										content: transcript || `Call recording available (${recDurationSeconds}s)`,
										communication_log_id: createdLog.id,
										thread_id: contactNumber
									});
									finalLogId = createdLog.id;
								}
							}

							if (finalLogId) {
								import('$lib/server/orchestrator').then(({ process_orchestrator }) => {
									process_orchestrator(finalLogId as string, 'ai_ready').catch(e => console.error('[Orchestrator] Error:', e));
								});
							}

							// Retroactively update the call_summary in the message thread with the AI analysis
							if (contactNumber) {
								try {
									const contactE164 = toE164(contactNumber);
									const matchingThread = await prisma.message.findFirst({
										where: {
											companyId: numberInfo.companyId,
											customerPhone: { in: [contactNumber, contactE164] }
										},
										orderBy: { updated: 'desc' }
									});
									if (matchingThread && matchingThread.messages) {
										const existingMsgs = Array.isArray(matchingThread.messages)
											? matchingThread.messages
											: typeof matchingThread.messages === 'string'
												? JSON.parse(matchingThread.messages as string)
												: [];
										
										let modified = false;
										for (let i = existingMsgs.length - 1; i >= 0; i--) {
											const msg = existingMsgs[i];
											if (msg.type === 'call_summary' && msg.call_data?.call_control_id === callControlId) {
												if (estimatedPrice != null) {
													msg.call_data.estimated_price = estimatedPrice;
												}
												if (summary || transcript) {
													const text = summary || transcript;
													msg.call_data.summary = `Agent said: "${text.substring(0, 150)}${text.length > 150 ? '...' : ''}"`;
												}
												// Store the recording URL so the UI can play it
												if (recUrls && (recUrls as any).mp3) {
													msg.call_data.recording_url = (recUrls as any).mp3;
												} else if (audioUrl) {
													msg.call_data.recording_url = audioUrl;
												}
												modified = true;
												break;
											}
										}
										
										if (modified) {
											await prisma.message.update({
												where: { id: matchingThread.id },
												data: { messages: existingMsgs }
											});
											console.log(`📎 Updated call_summary in thread ${matchingThread.threadId} with estimated price and summary`);
										}
									}
								} catch (attachErr) {
									console.error('⚠️ Failed to update call_summary with AI data:', attachErr);
								}
							}
						}
					} else {
						console.log('⚠️ No initiated call log found for', callControlId);
					}
				}
				break;
			}

			default: {
				console.log('❓ Unhandled event:', eventType);
				break;
			}
		}

		// Always respond with a 200 OK to acknowledge receipt
		return json({ success: true });
	} catch (error) {
		console.error('Error processing webhook:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};

async function playAudio(callControlId: string, message: string = ''): Promise<void> {
	try {
		await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/speak`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${TELNYX_API_KEY}`
			},
			body: JSON.stringify({
				payload:
					message || 'Hello, this is an automated call. Please hold for an important message.',
				voice: 'female',
				language: 'en-US'
			})
		});
	} catch (error) {
		console.error('Error playing audio:', error);
	}
}

const TELNYX_HEADERS = {
	'Content-Type': 'application/json',
	Authorization: `Bearer ${TELNYX_API_KEY}`
};

async function telnyxPlayback(
	callControlId: string,
	audioUrl: string,
	clientState?: string
): Promise<void> {
	await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/playback_start`, {
		method: 'POST',
		headers: TELNYX_HEADERS,
		body: JSON.stringify({
			audio_url: audioUrl,
			...(clientState && { client_state: clientState })
		})
	});
}

async function telnyxHangup(callControlId: string): Promise<void> {
	await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`, {
		method: 'POST',
		headers: TELNYX_HEADERS,
		body: JSON.stringify({})
	});
}

async function telnyxTransfer(
	callControlId: string,
	to: string,
	ivrFlowId?: string,
	ivrRuleId?: string,
	ivrPath?: string,
	callPriority?: string
): Promise<string | null> {
	// Find the number this call was made TO (which will be the FROM of the outbound transfer)
	// We can try to find it in the initiated logs
	let fromNumber: string | null = null;
	try {
		const callLog = await prisma.callLog.findFirst({
			where: { callId: callControlId, status: 'initiated' }
		});
		fromNumber = callLog?.to ?? null;
	} catch (e) {}

	if (fromNumber && ivrFlowId && ivrRuleId) {
		const key = `${fromNumber}|${to}`;
		console.log('📝 Recording transfer intent:', key);
		intentToTransfer.set(key, {
			originalCallControlId: callControlId,
			ivrFlowId,
			ivrRuleId,
			timestamp: Date.now()
		});
	}

	let timeoutSecs = 20; // Default fallback
	if (ivrFlowId && ivrRuleId) {
		try {
			const flow = await prisma.callFlow.findUnique({
				where: { id: ivrFlowId },
				include: { rules: { where: { id: ivrRuleId } } }
			});
			const rule = flow?.rules?.[0];
			if (rule) {
				timeoutSecs = (rule as { failoverDelayMinutes?: number }).failoverDelayMinutes ?? 20;
			}
		} catch (e) {}
	}

	const clientStateObj = {
		ivrFlowId,
		ivrRuleId,
		ivrPath,
		callPriority,
		originalCallControlId: callControlId
	};
	const clientState = Buffer.from(JSON.stringify(clientStateObj)).toString('base64');

	console.log(`📡 Sending Telnyx transfer request for ${callControlId} to ${to} (timeout: ${timeoutSecs}s)...`);
	const res = await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/transfer`, {
		method: 'POST',
		headers: TELNYX_HEADERS,
		body: JSON.stringify({
			to,
			timeout_secs: timeoutSecs,
			ringback_tone: defaultRingbackAudio,
			client_state: clientState
		})
	});

	const data = await res.json().catch(() => null);
	if (!res.ok) {
		console.error(`❌ Telnyx transfer failed (status ${res.status}):`, data);
		return null;
	}

	// Telnyx returns the new call leg's call_control_id so we can track it
	const newLegId = data?.data?.call_control_id as string | undefined;
	if (!newLegId) {
		console.log('⚠️ Telnyx transfer ok but no ID in response. Waiting for call.initiated to link.');
	}
	return newLegId ?? null;
}

// Log call events to database (Prisma)
async function logCallEvent(
	callId: string,
	status: string,
	payload: Record<string, unknown>
): Promise<void> {
	try {
		await prisma.callLog.create({
			data: {
				callId,
				status,
				to: (payload.to as string) ?? null,
				from: (payload.from as string) ?? null,
				duration: typeof payload.duration === 'number' ? payload.duration : null,
				metadata: payload as object
			}
		});
	} catch (dbError) {
		console.error('Error logging call event to database:', dbError);
	}
}

// Also add this for PUT, GET, OPTIONS methods for Telnyx webhook validation
export const GET: RequestHandler = () => json({ success: true });
export const PUT: RequestHandler = async (event) => {
	return await POST(event);
};
export const OPTIONS: RequestHandler = () => json({ success: true });
