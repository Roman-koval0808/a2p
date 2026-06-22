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
		const comment = String(data.get('comment') || '').trim();

		if (!comment) {
			return { success: false, error: 'Call transcription content is required' };
		}

		try {
			const callId = `call_${Math.random().toString(36).substring(2, 9)}`;

			// 1. Resolve customer contact
			let contact = await prisma.contact.findFirst({
				where: { companyId, phone: caller }
			});
			if (!contact) {
				contact = await prisma.contact.create({
					data: { companyId, phone: caller, name: 'Unknown Caller' }
				});
			}

			// 2. Mock call_logs record (equivalent to Telnyx call.initiated state)
			await prisma.callLog.create({
				data: {
					callId,
					status: 'initiated',
					to: called,
					from: caller,
					metadata: { direction: 'incoming' }
				}
			});

			// 3. Mock call_recordings record (equivalent to Telnyx recording.saved)
			await prisma.callRecording.create({
				data: {
					callId,
					recordingId: `rec_${callId}`,
					urls: { mp3: 'https://cdn.freesound.org/previews/411/411132_5121236-lq.mp3' }
				}
			});

			// 4. Create Voice Communication Log
			const createdComm = await prisma.communicationLog.create({
				data: {
					type: 'voice',
					direction: 'inbound',
					status: 'completed',
					source: caller,
					destination: called,
					companyId,
					customerId: contact.id,
					summary: comment.substring(0, 50) + '...',
					content: `Transcription: ${comment}`,
					metadata: { call_control_id: callId }
				}
			});

			let analysis = null;
			try {
				const { analyzeCallLog } = await import('$lib/server/openai');
				analysis = await analyzeCallLog(comment);
			} catch (err) {
				console.error('Failed to run AI analysis for simulated call:', err);
			}

			if (analysis?.callerName && contact && contact.name === 'Unknown Caller') {
				try {
					await prisma.contact.update({
						where: { id: contact.id },
						data: { name: analysis.callerName }
					});
					contact.name = analysis.callerName;
				} catch (nameErr) {
					console.error('Failed to update contact name in simulation:', nameErr);
				}
			}

			if (analysis) {
				try {
					await prisma.communicationLog.update({
						where: { id: createdComm.id },
						data: {
							summary: analysis.summary || createdComm.summary,
							metadata: {
								call_control_id: callId,
								urgency: analysis.urgency,
								sentiment: analysis.sentiment,
								intent: analysis.intent,
								actionItems: analysis.actionItems,
								estimatedPrice: analysis.estimatedPrice
							}
						}
					});
				} catch (updateErr) {
					console.error('Failed to update communication log metadata in simulation:', updateErr);
				}
			}

			// 5. Run the actual AI signals pipeline simulator (which delegates to UnifiedPipeline)
			const pipelineResult = await PipelineSimulator.run({
				author_name: contact.name || 'Unknown Caller',
				customer_phone: caller,
				rating: 0,
				comment: comment,
				mode: 'call',
				sessionId: callId
			});

			// Query the created pipeline records from the database
			const dbEvent = await prisma.pipelineEvent.findFirst({
				where: { providerEventId: callId },
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
			} else if (pipelineResult.logs) {
				logs = pipelineResult.logs;
			}

			return {
				success: pipelineResult.success,
				mode: 'call',
				pipelineResult: JSON.parse(JSON.stringify(pipelineResult)),
				dbRecord: dbEvent ? JSON.parse(JSON.stringify(dbEvent)) : null,
				logs
			};
		} catch (err: any) {
			console.error('Test Call Trigger failed:', err);
			return { success: false, error: err.message || 'Internal processing error' };
		}
	}
};
