import { POST as handleSmsPost } from '../../api/telnyx/webhook/+server';
import { PipelineSimulator } from '$lib/server/pipeline-simulator';
import { prisma } from '$lib/db';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user || !user.companyId) {
		throw redirect(302, '/login');
	}

	const companyId = user.companyId;

	// Fetch registered company numbers to select in dropdown
	const phoneNumbers = await prisma.companyPhoneNumber.findMany({
		where: { companyId },
		select: { phoneNumber: true, connectionLabel: true }
	});

	// If no company numbers exist, create a default seed number so the test works
	if (phoneNumbers.length === 0) {
		const seedNum = await prisma.companyPhoneNumber.create({
			data: {
				companyId,
				phoneNumber: '+17059986143',
				connectionLabel: 'Default Test Line'
			}
		});
		phoneNumbers.push({
			phoneNumber: seedNum.phoneNumber,
			connectionLabel: seedNum.connectionLabel
		});
	}

	return {
		phoneNumbers,
		companyId
	};
};

export const actions: Actions = {
	triggerSms: async ({ request, locals }) => {
		const user = locals.user;
		if (!user || !user.companyId) {
			return { success: false, error: 'Unauthorized' };
		}

		const data = await request.formData();
		const sender = String(data.get('sender') || '+15550001111').trim();
		const recipient = String(data.get('recipient') || '+17059986143').trim();
		const comment = String(data.get('comment') || '').trim();

		if (!comment) {
			return { success: false, error: 'Message content is required' };
		}

		try {
			// Mock the Telnyx payload structure
			const mockPayload = {
				data: {
					event_type: 'message.received',
					payload: {
						id: `sms_${Date.now()}`,
						direction: 'inbound',
						from: {
							phone_number: sender
						},
						to: [
							{
								phone_number: recipient
							}
						],
						text: comment
					}
				}
			};

			// Delegate to the real SMS webhook endpoint POST handler
			const response = await handleSmsPost({
				request: new Request('http://localhost/api/telnyx/webhook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(mockPayload)
				})
			} as any);

			const resJson = await response.json();

			// Query the newly created database items to return full logs
			const dbEvent = await prisma.pipelineEvent.findFirst({
				where: { providerEventId: mockPayload.data.payload.id },
				include: {
					enrichments: true,
					signals: true,
					decisions: {
						include: {
							actionQueue: {
								include: {
									executions: true
								}
							}
						}
					}
				}
			});

			let logs: string[] = [];
			if (dbEvent?.unstructuredText) {
				const parts = dbEvent.unstructuredText.split('--- PIPELINE LOGS ---\n');
				if (parts.length > 1) {
					logs = parts[1].split('\n').filter(Boolean);
				} else {
					logs = [dbEvent.unstructuredText];
				}
			}

			return {
				success: response.status === 200,
				mode: 'sms',
				webhookResult: resJson,
				dbRecord: dbEvent ? JSON.parse(JSON.stringify(dbEvent)) : null,
				logs
			};
		} catch (err: any) {
			console.error('Test SMS Trigger failed:', err);
			return { success: false, error: err.message || 'Internal processing error' };
		}
	},

	triggerCall: async ({ request, locals }) => {
		const user = locals.user;
		if (!user || !user.companyId) {
			return { success: false, error: 'Unauthorized' };
		}

		const companyId = user.companyId;

		const data = await request.formData();
		const caller = String(data.get('caller') || '+15550001111').trim();
		const called = String(data.get('called') || '+17059986143').trim();
		const digit = String(data.get('digit') || '1').trim();
		const comment = String(data.get('comment') || '').trim();

		const callId = `v3:sim_${Date.now()}`;
		const sessionId = `sim_session_${Date.now()}`;
		const legId = `sim_leg_${Date.now()}`;
		const logs: string[] = [];

		const sendWebhook = async (eventType: string, payloadOverrides: any) => {
			logs.push(`\n▶️ Sending simulated webhook: ${eventType}`);
			const payload = {
				data: {
					event_type: eventType,
					payload: {
						call_control_id: callId,
						call_session_id: sessionId,
						call_leg_id: legId,
						direction: 'incoming',
						state: 'parked',
						from: caller,
						to: called,
						...payloadOverrides
					}
				}
			};

			const { POST: handleCallPost } = await import('../../api/telnyx/call-webhook/+server');

			try {
				const response = await handleCallPost({
					request: new Request('http://localhost/api/telnyx/call-webhook', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(payload)
					})
				} as any);
				
				// Webhook returns empty 200 JSON usually
				logs.push(`✅ Webhook processed ${eventType} successfully (Status: ${response.status})`);
			} catch (e: any) {
				logs.push(`❌ Webhook error on ${eventType}: ${e.message}`);
			}
		};

		try {
			// Find active IVR
			const companyNum = await prisma.companyPhoneNumber.findUnique({ where: { phoneNumber: called } });
			const callFlowId = companyNum?.callFlowId;
			let ivrFlowId = callFlowId;
			let ivrRuleId = null;

			if (callFlowId) {
				const { getActiveCallFlow } = await import('$lib/ivr');
				const active = await getActiveCallFlow(prisma, companyId, new Date(), { timezone: 'America/New_York', flowId: callFlowId });
				if (active) {
					ivrFlowId = active.flow.id;
					ivrRuleId = active.rule.id;
				}
			}

			// 1. Initiated
			await sendWebhook('call.initiated', { state: 'parked' });
			await new Promise(r => setTimeout(r, 200));

			// 2. Answered
			const answeredState = Buffer.from(JSON.stringify({ ivrFlowId, ivrRuleId, ivrPath: 'Simulated Path' })).toString('base64');
			await sendWebhook('call.answered', { state: 'answered', start_time: new Date().toISOString(), client_state: answeredState });
			await new Promise(r => setTimeout(r, 200));

			// 3. Playback Started
			const playbackState = Buffer.from(JSON.stringify({ ivrFlowId, ivrRuleId, afterGreetingGather: true })).toString('base64');
			await sendWebhook('call.playback.started', { client_state: playbackState });
			await new Promise(r => setTimeout(r, 200));

			// 4. Gather Ended (Injecting the test digit)
			if (digit) {
				await sendWebhook('call.gather.ended', { digits: digit, status: 'valid', client_state: playbackState });
				await new Promise(r => setTimeout(r, 200));
			}

			// 5. Playback Ended (Assuming it hit the voicemail prompt, this simulates the prompt finishing)
			const voicemailState = Buffer.from(JSON.stringify({ isVoicemailPrompt: true, ivrFlowId, ivrRuleId })).toString('base64');
			await sendWebhook('call.playback.ended', { client_state: voicemailState });
			await new Promise(r => setTimeout(r, 200));

			// Force voicemail state so hangup doesn't count it as a drop call
			if (comment) {
				const { setVoicemail } = await import('$lib/server/call-state');
				await setVoicemail(callId);
			}

			// 6. Hangup FIRST
			await sendWebhook('call.hangup', { hangup_cause: 'normal_clearing', start_time: new Date(Date.now() - 60000).toISOString(), end_time: new Date().toISOString() });
			await new Promise(r => setTimeout(r, 500)); // wait for hangup to process and create the log

			// 7. Simulating the Voicemail being saved (without hitting the real webhook which would transcribe a fake MP3)
			if (comment) {
				const cLog = await prisma.communicationLog.findFirst({
					where: { companyId, source: caller, type: 'voice' },
					orderBy: { created: 'desc' }
				});

				if (cLog) {
					// Force the AI analysis on the transcript just like the old triggerCall did
					try {
						const { analyzeCallLog } = await import('$lib/server/openai');
						const analysis = await analyzeCallLog(comment);
						
						await prisma.communicationLog.update({
							where: { id: cLog.id },
							data: { 
								content: `Transcription: ${comment}`,
								summary: analysis?.summary || cLog.summary,
								metadata: {
									...((cLog.metadata as object) || {}),
									urgency: analysis?.urgency,
									sentiment: analysis?.sentiment,
									intent: analysis?.intent,
									sub_intent: analysis?.sub_intent,
									actionItems: analysis?.actionItems,
									estimatedPrice: analysis?.estimatedPrice,
									datetime: analysis?.datetime
								}
							}
						});

						// Update contact name if resolved from AI analysis
						const resolvedName = analysis?.callerName || null;
						if (resolvedName) {
							// Update Svelte Contact
							await prisma.contact.updateMany({
								where: { companyId, phone: caller },
								data: { name: resolvedName }
							});

							// Update Pipeline Customer Profile
							await prisma.pipelineCustomerProfile.updateMany({
								where: { companyId, phoneNumber: caller },
								data: { displayName: resolvedName, firstName: resolvedName.split(' ')[0] }
							});
						}

						// Also run the pipeline
						await PipelineSimulator.run({
							author_name: resolvedName || 'Unknown Caller',
							customer_phone: caller,
							rating: 0,
							comment: comment,
							mode: 'call',
							sessionId: callId,
							companyId: companyId
						});

						// CRITICAL: Manually trigger the Orchestrator since we bypassed the recording.saved webhook!
						import('$lib/server/orchestrator').then(({ process_orchestrator }) => {
							process_orchestrator(cLog.id, 'ai_ready').catch(e => console.error('[Orchestrator] Error:', e));
						});

					} catch (e) {
						logs.push(`Warning: Mock analysis failed ${e}`);
					}
				}

				logs.push('⏱️ Waiting 3 seconds for Orchestrator to draft SMS...');
				await new Promise(r => setTimeout(r, 3000));
			}

			// 8. Fetch the final resulting log to show the UI
			const finalCommLog = await prisma.communicationLog.findFirst({
				where: { companyId, source: caller, type: 'voice' },
				orderBy: { created: 'desc' },
				include: { communicationThread: { include: { logs: true } } }
			});
			
			if (finalCommLog) {
				logs.push(`✅ Located DB Log: ${finalCommLog.id}`);
				// Show any drafted SMS that got created by the orchestrator
				const latestSms = finalCommLog.communicationThread?.logs.find(l => l.type === 'sms' && l.created > finalCommLog.created);
				if (latestSms) {
					logs.push(`🎉 Orchestrator drafted SMS: "${latestSms.content}" (Status: ${latestSms.status})`);
				}
			}

			return { 
				success: true, 
				mode: 'call', 
				pipelineResult: { success: true },
				dbRecord: finalCommLog ? JSON.parse(JSON.stringify(finalCommLog)) : null,
				logs 
			};
		} catch (err: any) {
			console.error('Test Call Trigger failed:', err);
			return { success: false, error: err.message || 'Internal processing error' };
		}
	}
};
