import { prisma } from '$lib/db';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLogsForMessage } from '$lib/utils/inbox-log-link';
import { logCommunication } from '$lib/utils/communication-log';
import { createNotification } from '$lib/utils/notifications';
import { createOrUpdateContact } from '$lib/utils/contacts';
import { analyzeIncomingMessage } from '$lib/ai/openai';

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
	'Access-Control-Max-Age': '86400'
};

export const OPTIONS: RequestHandler = async () => {
	return new Response(null, { status: 204, headers: CORS_HEADERS });
};

/** Leadbox/leadform embed submit — no auth, validated by company_id. */
export const POST: RequestHandler = async ({ request }) => {
	if (request.headers.get('content-type')?.includes('application/json') === false) {
		return new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
		});
	}
	try {
		const body = await request.json();
		const companyId = body.company_id ?? body.company?.id;
		const threadId = String(body.thread_id ?? '').trim() || `leadbox-${crypto.randomUUID()}`;
		const customerName = body.customer_name ?? 'Anonymous';
		const customerPhone = body.customer_phone ?? null;
		const customerEmail = body.customer_email ?? null;
		const messageContent = typeof body.message === 'string' ? body.message : '';
		const source = body.source ?? 'leadbox';

		if (!companyId) {
			return new Response(JSON.stringify({ error: 'company_id is required' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
			});
		}

		const company = await prisma.company.findUnique({ where: { id: companyId } });
		if (!company) {
			return new Response(JSON.stringify({ error: 'Invalid company or user ID' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
			});
		}

		const newItem = {
			content: messageContent,
			timestamp: new Date().toISOString(),
			is_agent_reply: false
		};
		const existing = await prisma.message.findUnique({ where: { threadId } });
		const threadMessages =
			existing && existing.companyId === companyId
				? Array.isArray(existing.messages)
					? existing.messages
					: []
				: [];

		// AI first so we can store OpenAI summary + purpose in CommunicationLog
		const analysis = await analyzeIncomingMessage(messageContent, threadMessages as any);

		const aiData = {
			...(analysis && {
				urgency: analysis.urgency,
				urgencyScore: analysis.urgencyScore,
				sentiment: analysis.sentiment,
				aiSummary: analysis.aiSummary
			}),
			intent: source === 'leadform' ? 'leadform' : 'leadbox'
		};

		let message;
		if (existing && existing.companyId === companyId) {
			const prev = Array.isArray(existing.messages) ? existing.messages : [];
			message = await prisma.message.update({
				where: { id: existing.id },
				data: {
					messages: [...prev, newItem],
					status: 'new',
					customerName: customerName || existing.customerName,
					customerPhone: customerPhone ?? existing.customerPhone,
					customerEmail: customerEmail ?? existing.customerEmail,
					updated: new Date(),
					...aiData
				}
			});
		} else {
			message = await prisma.message.create({
				data: {
					threadId,
					companyId,
					customerName: customerName || null,
					customerPhone,
					customerEmail,
					status: 'new',
					messages: [newItem],
					...aiData
				}
			});
		}

		const contact =
			customerPhone || customerEmail || customerName !== 'Anonymous'
				? await createOrUpdateContact({
						company_id: companyId,
						name: customerName !== 'Anonymous' ? customerName : undefined,
						phone: customerPhone ?? undefined,
						email: customerEmail ?? undefined
					})
				: null;

		const logSummary =
			analysis?.aiSummary ??
			messageContent.slice(0, 80) + (messageContent.length > 80 ? '...' : '');
		const logMetadata: Record<string, string> = { thread_id: threadId };
		if (analysis?.urgency != null) logMetadata.urgency = analysis.urgency;
		if (analysis?.sentiment != null) logMetadata.sentiment = analysis.sentiment;
		if (analysis?.intent != null) logMetadata.intent = analysis.intent;

		await logCommunication({
			type: source === 'leadform' ? 'leadform' : 'leadbox',
			direction: 'inbound',
			status: 'success',
			source: customerPhone || customerEmail || threadId,
			destination: null,
			company_id: companyId,
			customer_id: contact?.id ?? undefined,
			summary: logSummary,
			content: messageContent,
			metadata: logMetadata,
			contact_name: customerName !== 'Anonymous' ? customerName : undefined,
			contact_company: company?.name
		});

		return new Response(JSON.stringify(message), {
			status: 201,
			headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
		});
	} catch (e) {
		console.error('POST /api/messages error:', e);
		return new Response(
			JSON.stringify({ error: e instanceof Error ? e.message : 'Failed to create message' }),
			{ status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
		);
	}
};

let lastSyncTime = 0;
const SYNC_COOLDOWN = 10000; // 10 seconds

async function syncEmergencyMessages(companyId: string) {
	const now = Date.now();
	if (now - lastSyncTime < SYNC_COOLDOWN) {
		return;
	}
	lastSyncTime = now;

	const PROFILEDB_URL = process.env.PROFILEDB_URL || 'http://localhost:6277';
	try {
		const resEvents = await fetch(`${PROFILEDB_URL}/api/v1/tenants/${companyId}/events?limit=30`);
		if (!resEvents.ok) return;
		const jsonEvents = await resEvents.json();
		const events = (jsonEvents && Array.isArray(jsonEvents.data)) ? jsonEvents.data : [];
		
		const activeProfileIds = new Set(events.map((ev: any) => ev.customerProfileId).filter(Boolean));

		// Find all local emergency threads to delete the ones that are no longer present in CDP/ProfileDB
		const localEmergencyMessages = await prisma.message.findMany({
			where: {
				companyId,
				threadId: {
					startsWith: 'emergency-'
				}
			},
			select: {
				id: true,
				threadId: true,
				messages: true
			}
		});

		for (const msg of localEmergencyMessages) {
			const profileId = msg.threadId.replace('emergency-', '');
			if (!activeProfileIds.has(profileId)) {
				// Prevent deleting if the thread has messages sent by an agent
				const messagesArray = Array.isArray(msg.messages)
					? msg.messages
					: typeof msg.messages === 'string'
						? JSON.parse(msg.messages)
						: [];
			const hasAgentReply = messagesArray.some((m: any) => m.is_agent_reply && m.agent_id);
				if (hasAgentReply) {
					console.log(`ℹ️ Keeping local emergency thread ${msg.threadId} because it has agent replies.`);
					continue;
				}

				console.log(`🗑️ Deleting local emergency thread ${msg.threadId} as it is not present in CDP`);
				await prisma.message.deleteMany({
					where: { id: msg.id }
				});
			}
		}

		const profileIds = [...activeProfileIds];

		for (const profileId of profileIds) {
			const resHistory = await fetch(`${PROFILEDB_URL}/api/v1/tenants/${companyId}/profiles/${profileId}/history`);
			if (!resHistory.ok) continue;
			const history = await resHistory.json();
			if (!Array.isArray(history) || history.length === 0) continue;

			const resProfile = await fetch(`${PROFILEDB_URL}/api/v1/tenants/${companyId}/profiles/${profileId}`);
			if (!resProfile.ok) continue;
			const profile = await resProfile.json();

			const customerPhone = (profile.clearPhone && profile.clearPhone !== '—') 
				? profile.clearPhone 
				: (profile.phone && profile.phone.length < 20 ? profile.phone : `profile-${profileId}`);
			const customerName = profile.name || 'Emergency Customer';

			const communicationEventTypes = [
				'sms_sent', 'message.sent',
				'call_initiated', 'job_completed',
				'sms_received', 'message.received'
			];

			const isCommunicationEvent = (type: string) => {
				if (!type) return false;
				if (communicationEventTypes.includes(type)) return true;
				if (type.includes('voicemail') || type.includes('call_received') || type.includes('voice')) return true;
				return false;
			};

			const mappedMessages = history
				.filter((ev: any) => isCommunicationEvent(ev.eventType))
				.map((ev: any) => {
				const isSmsSent = ev.eventType === 'sms_sent' || ev.eventType === 'message.sent';
				const isOutbound = isSmsSent || ev.eventType === 'call_initiated' || ev.eventType === 'job_completed';
				
				let senderName = 'Customer';
				if (isSmsSent) senderName = 'System / Auto-Reply';
				else if (ev.eventType === 'call_initiated') senderName = 'System / Dispatch';
				else if (ev.eventType === 'job_completed') senderName = 'System / Billing';

				let content = 'Emergency situation detected.';
				if (ev.eventType.includes('voicemail') || ev.eventType.includes('call_received') || ev.eventType.includes('voice')) {
					content = ev.payload?.voicemail_text || ev.payload?.textContent || ev.payload?.detail || 'Emergency voicemail received';
				} else if (ev.eventType === 'sms_received' || ev.eventType === 'message.received') {
					content = ev.payload?.body || ev.payload?.textContent || ev.payload?.detail || 'Inbound SMS received';
				} else {
					content = ev.payload?.detail || ev.payload?.body || ev.eventType;
				}

				return {
					content,
					timestamp: ev.occurredAt || new Date().toISOString(),
					is_agent_reply: isOutbound,
					agent_name: isOutbound ? senderName : undefined
				};
			}).sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

			// De-duplicate mappedMessages to prevent showing duplicate messages (e.g. both sms_received and message.received)
			const uniqueMappedMessages: typeof mappedMessages = [];
			for (const msg of mappedMessages) {
				const isDup = uniqueMappedMessages.some((existing: any) => 
					existing.is_agent_reply === msg.is_agent_reply &&
					existing.content === msg.content &&
					Math.abs(new Date(existing.timestamp).getTime() - new Date(msg.timestamp).getTime()) < 5000
				);
				if (!isDup) {
					uniqueMappedMessages.push(msg);
				}
			}

			let draftResponse = null;
			for (const ev of history) {
				const payload = ev.payload;
				if (!payload) continue;

				// Try to extract execution records array from all possible locations:
				let execRecords: any[] = [];
				if (Array.isArray(payload.execution)) {
					execRecords = payload.execution;
				} else if (payload.execution && typeof payload.execution === 'object') {
					if (Array.isArray(payload.execution.execution_records)) {
						execRecords = payload.execution.execution_records;
					} else if (payload.execution.execution_output_package && Array.isArray(payload.execution.execution_output_package.execution_records)) {
						execRecords = payload.execution.execution_output_package.execution_records;
					}
				}

				for (const exec of execRecords) {
					const output = exec.generated_output || exec.generatedOutput;
					if (output) {
						try {
							const parsed = typeof output === 'string' ? JSON.parse(output) : output;
							if (parsed?.draft_reply) {
								draftResponse = parsed.draft_reply;
								break;
							}
						} catch (e) {}
					}
				}

				if (draftResponse) break;

				// Fallback to old path
				const executionOutputRaw = ev.payload?.decision?.action_queue?.[0]?.executions?.[0]?.generated_output;
				if (executionOutputRaw) {
					try {
						const parsed = typeof executionOutputRaw === 'string' ? JSON.parse(executionOutputRaw) : executionOutputRaw;
						if (parsed?.draft_reply) {
							draftResponse = parsed.draft_reply;
							break;
						}
					} catch (e) {}
				}
			}

			if (draftResponse === 'Mock reply') {
				draftResponse = null;
			}

			// Generate specific emergency advice locally if none exists
			if (!draftResponse && profile.intentBucket === 'emergency') {
				const lastMessage = uniqueMappedMessages[uniqueMappedMessages.length - 1]?.content?.toLowerCase() || '';
				let advice = `Hi ${customerName}, we received your urgent message. A technician has been dispatched and will contact you in 2-3 minutes. Please keep your phone available. — RightFlush Plumbing`;
				
				if (lastMessage.includes('leak') || lastMessage.includes('pipe') || lastMessage.includes('water') || lastMessage.includes('flood')) {
					advice = `Hi ${customerName}, we received your urgent message about the leak. Please TURN OFF your main water supply immediately to prevent further damage! A plumber has been dispatched and will contact you in 2-3 minutes. — RightFlush Plumbing`;
				} else if (lastMessage.includes('power') || lastMessage.includes('electr') || lastMessage.includes('spark') || lastMessage.includes('wire') || lastMessage.includes('smoke')) {
					advice = `Hi ${customerName}, we received your urgent message about the electrical issue. Please TURN OFF the main power breaker to the affected area immediately! An electrician has been dispatched and will contact you in 2-3 minutes. — RightFlush Plumbing`;
				} else if (lastMessage.includes('heat') || lastMessage.includes('furnace') || lastMessage.includes('hvac') || lastMessage.includes('ac') || lastMessage.includes('cold')) {
					advice = `Hi ${customerName}, we received your urgent message about the heating/cooling failure. A technician has been dispatched and will contact you in 2-3 minutes. Please keep your phone available. — RightFlush Plumbing`;
				} else if (lastMessage.includes('gas') || lastMessage.includes('smell') || lastMessage.includes('odor') || lastMessage.includes('leakage')) {
					advice = `Hi ${customerName}, we received your urgent message about a potential gas issue. Please IMMEDIATELY evacuate the building, leave the doors open, and do not touch any electrical switches! A technician has been dispatched and will contact you in 2-3 minutes. — RightFlush Plumbing`;
				} else if (lastMessage.includes('sewage') || lastMessage.includes('sewer') || lastMessage.includes('drain') || lastMessage.includes('backup') || lastMessage.includes('toilet')) {
					advice = `Hi ${customerName}, we received your urgent message about a sewage backup. Please avoid flushing toilets or running any water, and keep away from the affected area to prevent contamination! A plumber has been dispatched and will contact you in 2-3 minutes. — RightFlush Plumbing`;
				} else if (lastMessage.includes('roof') || lastMessage.includes('ceiling') || lastMessage.includes('drip') || lastMessage.includes('attic')) {
					advice = `Hi ${customerName}, we received your urgent message about a roof or ceiling leak. If safe, please place buckets under the drip and move valuables out of the area! A technician has been dispatched and will contact you in 2-3 minutes. — RightFlush Plumbing`;
				}
				draftResponse = advice;
			}

			// Robust phone number match: strip all non-digit characters
			const cleanPhone = customerPhone ? customerPhone.replace(/\D/g, '') : '';
			const isPhone = cleanPhone.length >= 10;
			
			let existingPhoneMessage = null;
			if (isPhone) {
				const allMessages = await prisma.message.findMany({
					where: { companyId }
				});
				existingPhoneMessage = allMessages.find((m: any) => {
					const mPhone = m.customerPhone ? m.customerPhone.replace(/\D/g, '') : '';
					const mThreadPhone = m.threadId ? m.threadId.replace(/\D/g, '') : '';
					return (mPhone && mPhone.slice(-10) === cleanPhone.slice(-10)) || 
					       (mThreadPhone && mThreadPhone.slice(-10) === cleanPhone.slice(-10));
				}) || null;
			}

			const targetThreadId = existingPhoneMessage ? existingPhoneMessage.threadId : `emergency-${profileId}`;

			// If we matched a native phone thread, clean up any duplicate emergency- thread that might exist
			if (existingPhoneMessage) {
				const duplicateEmergencyThreadId = `emergency-${profileId}`;
				// Only delete if it's actually a different thread
				if (existingPhoneMessage.threadId !== duplicateEmergencyThreadId) {
					try {
						await prisma.message.deleteMany({
							where: {
								companyId,
								threadId: duplicateEmergencyThreadId
							}
						});
					} catch (delErr) {
						// Race condition — another sync already cleaned it up
					}
				}
			}

			const existing = existingPhoneMessage || await prisma.message.findUnique({
				where: { threadId: targetThreadId }
			});

			const hasEmergency = history.some((ev: any) => ev.intentBucket === 'emergency');
			const urgency = hasEmergency ? 'red' : 'blue';

			// Merge mapped messages from CDP with existing local messages to preserve manual agent replies
			const localMsgs = Array.isArray(existing?.messages)
				? existing.messages
				: typeof existing?.messages === 'string'
					? JSON.parse(existing.messages)
					: [];

			// Keep local agent replies and call summaries that are not already present in the mapped messages
			const localAgentReplies = localMsgs.filter((m: any) => 
				(m.is_agent_reply && !m.agent_name?.startsWith('System')) || 
				m.type === 'call_summary'
			);
			// Combine uniqueMappedMessages and localAgentReplies, and sort by timestamp
			const mergedMessages = [...uniqueMappedMessages];
			for (const localRep of localAgentReplies) {
				const isAlreadyMapped = uniqueMappedMessages.some((m: any) => 
					m.is_agent_reply && 
					m.content === localRep.content && 
					Math.abs(new Date(m.timestamp).getTime() - new Date(localRep.timestamp).getTime()) < 10000
				);
				if (!isAlreadyMapped) {
					mergedMessages.push(localRep);
				}
			}
			mergedMessages.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

			// Don't overwrite existing draftResponse/urgency/intent if sync data is weaker
			const effectiveDraft = draftResponse ?? existing?.draftResponse ?? null;
			const effectiveUrgency = urgency === 'red' ? 'red' : (existing?.urgency || urgency);
			const effectiveIntent = profile.intentBucket || existing?.intent || null;

			try {
				await prisma.message.upsert({
					where: { threadId: targetThreadId },
					update: {
						messages: mergedMessages,
						updated: new Date(),
						customerName,
						customerPhone,
						urgency: effectiveUrgency,
						intent: effectiveIntent,
						...(effectiveDraft && { draftResponse: effectiveDraft })
					},
					create: {
						threadId: targetThreadId,
						companyId,
						customerPhone,
						customerName,
						status: 'new',
						urgency: effectiveUrgency,
						intent: effectiveIntent,
						draftResponse: effectiveDraft,
						messages: mergedMessages
					}
				});
			} catch (upsertErr: any) {
				// Handle race conditions gracefully
				if (upsertErr.code !== 'P2002') {
					console.warn(`[syncEmergencyMessages] upsert failed for ${targetThreadId}:`, upsertErr.message);
				}
			}
		}
	} catch (err) {
		console.warn('[syncEmergencyMessages] failed:', err);
	}
}

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user || !locals.user.company) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const page = parseInt(url.searchParams.get('page') || '1');
	const perPage = parseInt(url.searchParams.get('perPage') || '20');
	const threadId = url.searchParams.get('threadId');

	try {
		if (threadId) {
			// Get specific thread
			const thread = await prisma.message.findFirst({
				where: {
					companyId: locals.user.company.id,
					OR: [{ threadId }, { customerPhone: threadId }]
				}
			});

			if (!thread || thread.companyId !== locals.user.company.id) {
				return json({ success: false, error: 'Thread not found' }, { status: 404 });
			}

			return json({ success: true, data: thread });
		} else {
			// Get list of messages
			const skip = (page - 1) * perPage;
			const messages = await prisma.message.findMany({
				where: {
					companyId: locals.user.company.id,
					intent: {
						in: ['leadform', 'leadbox']
					}
				},
				skip,
				take: perPage,
				orderBy: {
					updated: 'desc'
				}
			});

			const total = await prisma.message.count({
				where: {
					companyId: locals.user.company.id,
					intent: {
						in: ['leadform', 'leadbox']
					}
				}
			});

			return json({
				success: true,
				data: messages,
				pagination: {
					page,
					limit: perPage,
					total,
					totalPages: Math.ceil(total / perPage)
				}
			});
		}
	} catch (error: any) {
		console.error('Error fetching messages:', error);
		return json(
			{ success: false, error: error.message || 'Failed to fetch messages' },
			{ status: 500 }
		);
	}
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || !locals.user.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = await request.json();
		const { id, ...updateData } = body;

		if (!id) {
			return json({ error: 'Message ID is required' }, { status: 400 });
		}

		// Verify message belongs to user's company
		const existing = await prisma.message.findUnique({
			where: { id }
		});

		if (!existing || existing.companyId !== locals.user.company.id) {
			return json({ error: 'Message not found' }, { status: 404 });
		}

		const newAssignedToId =
			updateData.assigned_to !== undefined ? updateData.assigned_to : existing.assignedToId;
		const companyId = locals.user.company!.id;

		async function syncLogAssignment(msg: typeof existing, assignedToId: string | undefined) {
			const logs = await getLogsForMessage(prisma, msg, companyId);
			const memberIds = assignedToId ? [assignedToId] : [];
			for (const log of logs) {
				await prisma.communicationLogAssignedMember.deleteMany({
					where: { communicationLogId: log.id }
				});
				if (memberIds.length > 0) {
					await prisma.communicationLogAssignedMember.createMany({
						data: memberIds.map((userId) => ({ communicationLogId: log.id, userId })),
						skipDuplicates: true
					});
				}
			}
		}

		// Handle messages array update
		if (updateData.messages) {
			const updated = await prisma.message.update({
				where: { id },
				data: {
					messages: updateData.messages,
					status: updateData.status || existing.status,
					assignedToId: newAssignedToId,
					urgency: updateData.urgency || existing.urgency
				}
			});
			await syncLogAssignment(updated, newAssignedToId ?? undefined);
			// Notify when a new message (e.g. agent reply) was added to the thread
			const prevLen = Array.isArray(existing.messages) ? existing.messages.length : 0;
			const newLen = Array.isArray(updateData.messages) ? updateData.messages.length : 0;
			if (newLen > prevLen) {
				const lastMsg = Array.isArray(updateData.messages) ? updateData.messages[newLen - 1] : null;
				const content =
					typeof lastMsg === 'object' && lastMsg && 'content' in lastMsg
						? String(lastMsg.content)
						: '';
				const isAgent =
					typeof lastMsg === 'object' &&
					lastMsg &&
					(lastMsg as { is_agent_reply?: boolean }).is_agent_reply;
				await createNotification({
					company_id: existing.companyId,
					type: 'sms',
					direction: isAgent ? 'outbound' : 'inbound',
					source_name: existing.customerName ?? undefined,
					source_identifier: existing.customerPhone ?? existing.customerEmail ?? existing.threadId,
					message_preview: content.slice(0, 120) + (content.length > 120 ? '...' : ''),
					content: content || undefined,
					message_id: id,
					thread_id: updated.threadId
				});
			}
			return json(updated);
		} else {
			const updated = await prisma.message.update({
				where: { id },
				data: {
					status: updateData.status,
					assignedToId: updateData.assigned_to,
					urgency: updateData.urgency,
					...(updateData.draft_response !== undefined && {
						draftResponse: updateData.draft_response
					})
				}
			});
			await syncLogAssignment(updated, updated.assignedToId ?? undefined);
			return json(updated);
		}
	} catch (error: any) {
		console.error('Error updating message:', error);
		return json({ error: error.message || 'Failed to update message' }, { status: 500 });
	}
};
