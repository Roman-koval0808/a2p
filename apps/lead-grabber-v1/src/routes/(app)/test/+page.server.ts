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

	// Reproduces a real inbound voice call's OUTCOME exactly: same Contact lookup, same
	// analyzeCallLog on the transcript, the same CommunicationLog shape the recording.saved
	// webhook creates, and the same process_orchestrator run — so what you see here is what a
	// real call produces. (We run the pipeline directly instead of firing synthetic Telnyx
	// webhooks, which is faithful in outcome and free of media/timing flakiness.)
	triggerCall: async ({ request, locals }) => {
		const user = locals.user;
		if (!user || !user.companyId) {
			return { success: false, error: 'Unauthorized' };
		}
		const companyId = user.companyId;

		const data = await request.formData();
		const caller = String(data.get('caller') || '+15550001111').trim();
		const called = String(data.get('called') || '').trim();
		const digit = String(data.get('digit') || '').trim();
		const transcript = String(data.get('comment') || '').trim();

		const logs: string[] = [];
		const callId = `v3:sim_${Date.now()}`;

		try {
			if (!transcript) {
				return { success: false, error: 'Voicemail transcript is required' };
			}

			// 1. Resolve the IVR intent name for the pressed digit from the REAL flow's key prompts
			//    (falls back to the standard menu mapping).
			let intentName: string | null = null;
			try {
				const companyNum = await prisma.companyPhoneNumber.findUnique({
					where: { phoneNumber: called }
				});
				if (companyNum?.callFlowId && digit) {
					const { getActiveCallFlow } = await import('$lib/ivr');
					const active = await getActiveCallFlow(prisma, companyId, new Date(), {
						timezone: 'America/New_York',
						flowId: companyNum.callFlowId
					});
					const prompts = ((active?.rule as any)?.keyPrompts as any[]) || [];
					const match = prompts.find((p) => String(p.key).trim() === digit);
					intentName = match?.name || null;
				}
			} catch {
				/* fall through to default map */
			}
			if (!intentName && digit) {
				intentName =
					(({ '1': 'Billing', '2': 'Sales', '3': 'Support', '0': 'Operator' }) as Record<string, string>)[
						digit
					] || null;
			}
			logs.push(
				`📞 Inbound call from ${caller} → ${called}${digit ? `, pressed ${digit} (${intentName || '?'})` : ' (no digit)'}`
			);

			// 2. Find/create the caller Contact (exactly as the webhook does).
			let contact = await prisma.contact.findFirst({ where: { companyId, phone: caller } });
			if (!contact) {
				contact = await prisma.contact.create({ data: { companyId, phone: caller, name: null } });
				logs.push(`👤 Created new contact profile ${contact.id}`);
			} else {
				logs.push(`👤 Matched existing contact ${contact.id}`);
			}

			// 3. AI analysis on the transcript — the same call the recording.saved path makes.
			const { analyzeCallLog } = await import('$lib/server/openai');
			const analysis = await analyzeCallLog(transcript, intentName || undefined);
			logs.push(
				`🧠 analyzeCallLog → intent=${analysis?.intent}, urgency=${analysis?.urgency}, sentiment=${analysis?.sentiment}`
			);

			// Resolve the caller name from the transcript, as the real path does.
			if (
				analysis?.callerName &&
				(!contact.name ||
					['Unknown Caller', 'Anonymous', 'Valued Customer', 'Unknown'].includes(contact.name))
			) {
				await prisma.contact.update({
					where: { id: contact.id },
					data: { name: analysis.callerName }
				});
				contact = { ...contact, name: analysis.callerName };
				logs.push(`👤 Resolved caller name from voicemail: ${analysis.callerName}`);
			}

			// 4. Create the thread + CommunicationLog with the EXACT recording.saved shape.
			const thread = await prisma.communicationThread.create({
				data: { companyId, contactId: contact.id, status: 'open', summary: 'Voice Call' }
			});
			const finalDestination =
				intentName && digit ? `${called} (Ext ${digit} - ${intentName})` : called;
			const commLog = await prisma.communicationLog.create({
				data: {
					type: 'voice',
					direction: 'inbound',
					status: 'completed',
					source: caller,
					destination: finalDestination,
					companyId,
					customerId: contact.id,
					communicationThreadId: thread.id,
					duration: 45,
					content: transcript,
					summary: analysis?.summary || null,
					metadata: {
						call_control_id: callId,
						origin: 'incoming',
						ivr_intent: intentName || undefined,
						ivr_digit: digit || undefined,
						ivr_confidence: digit ? 'high' : undefined,
						urgency: analysis?.urgency,
						sentiment: analysis?.sentiment,
						intent: analysis?.intent,
						sub_intent: analysis?.sub_intent,
						datetime: analysis?.datetime,
						actionItems: analysis?.actionItems,
						estimatedPrice: analysis?.estimatedPrice,
						simulated: true
					}
				}
			});
			logs.push(`📝 Created CommunicationLog ${commLog.id} (dest: ${finalDestination})`);

			// 5. Run the orchestrator — the same call the real recording.saved path fires (there it
			//    is fire-and-forget; here we await it so the drafted reply is ready to show).
			const { process_orchestrator } = await import('$lib/server/orchestrator');
			await process_orchestrator(commLog.id, 'ai_ready');
			logs.push('🤖 Orchestrator ran: AI-classified the message and drafted a reply if applicable.');

			// 6. Also run the ProfileDB signals pipeline like a real call (non-fatal if it is down).
			try {
				await PipelineSimulator.run({
					author_name: contact.name || 'Unknown Caller',
					customer_phone: caller,
					rating: 0,
					comment: transcript,
					mode: 'call',
					sessionId: callId,
					companyId
				});
			} catch (e: any) {
				logs.push(`⚠️ ProfileDB pipeline skipped (service unavailable): ${e?.message}`);
			}

			// 7. Read back the outcome: the log (with ai_intent), the drafted reply, the contact.
			const finalLog = await prisma.communicationLog.findUnique({ where: { id: commLog.id } });
			const draft = await prisma.communicationLog.findFirst({
				where: {
					companyId,
					type: 'sms',
					direction: 'outbound',
					status: 'pending_approval',
					destination: caller
				},
				orderBy: { created: 'desc' }
			});
			const updatedContact = await prisma.contact.findUnique({
				where: { id: contact.id },
				select: { name: true, engagementScore: true, accountBalance: true }
			});
			const meta = ((finalLog?.metadata as any) || {}) as Record<string, any>;

			if (draft) logs.push(`🎉 Drafted reply (pending approval): "${draft.content}"`);
			else logs.push('ℹ️ No automated reply drafted (routed to a human / support).');

			return {
				success: true,
				mode: 'call',
				call: {
					caller,
					called: finalDestination,
					digitPressed: digit || null,
					ivrIntent: intentName || null,
					transcript,
					summary: finalLog?.summary || null,
					aiIntent: meta.ai_intent || null,
					messageCategory: meta.message_category || null,
					reclassified: !!meta.reclassified,
					pressedCategory: meta.ivr_pressed_category || null,
					draftedReply: draft?.content || null,
					draftStatus: draft?.status || null,
					commLogId: commLog.id,
					contactId: contact.id,
					contactName: updatedContact?.name || null,
					engagementScore: updatedContact?.engagementScore ?? 0,
					accountBalance: updatedContact?.accountBalance ?? null
				},
				dbRecord: finalLog ? JSON.parse(JSON.stringify(finalLog)) : null,
				logs
			};
		} catch (err: any) {
			console.error('Test Call Trigger failed:', err);
			return { success: false, error: err.message || 'Internal processing error', logs };
		}
	}
};
