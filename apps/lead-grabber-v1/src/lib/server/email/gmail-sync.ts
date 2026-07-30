import { prisma } from '$lib/db';
import { getConnectionAccessToken } from '../google-calendar';
import { processInboundEmail, type InboundEmailPayload } from './bridge';
import { logCommunication } from '$lib/utils/communication-log';
import { createOrUpdateContact } from '$lib/utils/contacts';
import { UnifiedPipeline } from '$lib/server/pipeline/unified-pipeline';

export async function syncCompanyEmails(companyId: string) {
	try {
		const auth = await getConnectionAccessToken(companyId);
		if (!auth || !auth.email) {
			return { success: false, reason: 'not_connected_or_missing_email' };
		}
		
		const conn = await prisma.googleCalendarConnection.findUnique({
			where: { companyId }
		});
		if (!conn) return { success: false, reason: 'no_connection_record' };

		const lastHistoryId = conn.lastEmailHistoryId;
		const messagesToFetch = new Set<string>();
		let newHistoryId = lastHistoryId;

		// 1. Fetch History or Recent Messages
		if (lastHistoryId) {
			// Fetch history
			const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${lastHistoryId}`, {
				headers: { Authorization: `Bearer ${auth.token}` }
			});
			if (res.ok) {
				const data = await res.json();
				if (data.history) {
					for (const h of data.history) {
						if (h.messagesAdded) {
							for (const ma of h.messagesAdded) {
								messagesToFetch.add(ma.message.id);
							}
						}
					}
				}
				if (data.historyId) {
					newHistoryId = data.historyId;
				}
			} else {
				// History ID might be expired (404), fallback to fetching recent
				const errText = await res.text();
				console.warn(`[gmail-sync] History sync failed for ${companyId}, falling back to recent messages. Error: ${errText}`);
				await fetchRecentMessages(auth.token, messagesToFetch);
			}
		} else {
			// Initial sync: fetch recent messages
			await fetchRecentMessages(auth.token, messagesToFetch);
		}

		if (messagesToFetch.size === 0) {
			if (newHistoryId && newHistoryId !== lastHistoryId) {
				await prisma.googleCalendarConnection.update({
					where: { companyId },
					data: { lastEmailHistoryId: newHistoryId }
				});
			}
			return { success: true, count: 0 };
		}

		console.log(`[gmail-sync] Fetching ${messagesToFetch.size} messages for company ${companyId}`);

		// 2. Fetch and Process each message
		let processed = 0;
		for (const msgId of Array.from(messagesToFetch).slice(0, 50)) { // limit to 50 per run
			// Check if already processed
			const existingLog = await prisma.communicationLog.findFirst({
				where: { companyId, metadata: { path: ['email_message_id'], equals: msgId } }
			});
			if (existingLog) continue;

			const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`, {
				headers: { Authorization: `Bearer ${auth.token}` }
			});
			if (!msgRes.ok) continue;
			const msgData = await msgRes.json();

			const headers = msgData.payload?.headers || [];
			const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

			const from = getHeader('From');
			const to = getHeader('To');
			const subject = getHeader('Subject');
			const date = getHeader('Date');
			
			// Simple extraction of email address from "Name <email@domain.com>"
			const extractEmail = (str: string) => str.match(/<(.+)>|(\S+@\S+)/)?.[0]?.replace(/[<>]/g, '') || str;
			const fromEmail = extractEmail(from).toLowerCase();
			const toEmail = extractEmail(to).toLowerCase();
			
			const isOutgoing = fromEmail === auth.email.toLowerCase();
			const customerEmail = isOutgoing ? toEmail : fromEmail;
			const customerNameMatch = (isOutgoing ? to : from).match(/^([^<]+)/);
			let customerName = customerNameMatch ? customerNameMatch[1].trim().replace(/^"|"$/g, '') : customerEmail;
			if (!customerName) customerName = customerEmail;

			// Extract body
			let textBody = '';
			const extractBody = (part: any) => {
				if (part.mimeType === 'text/plain' && part.body?.data) {
					textBody += Buffer.from(part.body.data, 'base64url').toString('utf8');
				} else if (part.parts) {
					for (const p of part.parts) extractBody(p);
				}
			};
			if (msgData.payload) extractBody(msgData.payload);
			if (!textBody && msgData.snippet) textBody = msgData.snippet;

			// Identify thread id
			const threadId = msgData.threadId || `email-${msgId}`;

			// Store via similar logic to inbound bridge
			const contact = await createOrUpdateContact({
				company_id: companyId,
				name: customerName,
				email: customerEmail
			});

			if (isOutgoing) {
				// Record as outbound communication
				await logCommunication({
					type: 'email',
					direction: 'outbound',
					status: 'success',
					source: fromEmail,
					destination: customerEmail,
					company_id: companyId,
					customer_id: contact?.id ?? undefined,
					summary: subject,
					content: textBody,
					metadata: { thread_id: threadId, email_message_id: msgId }
				});
			} else {
				// Store as inbound
				const newItem = {
					content: textBody || '(No content)',
					timestamp: date || new Date().toISOString(),
					is_agent_reply: false,
					subject: subject,
					type: 'email'
				};

				let messageRecord = await prisma.message.findUnique({ where: { threadId } });
				if (messageRecord && messageRecord.companyId === companyId) {
					const prev = Array.isArray(messageRecord.messages) ? messageRecord.messages : [];
					await prisma.message.update({
						where: { id: messageRecord.id },
						data: {
							messages: [...prev, newItem],
							status: 'new',
							updated: new Date()
						}
					});
				} else {
					await prisma.message.create({
						data: {
							threadId,
							companyId,
							customerName,
							customerEmail,
							status: 'new',
							messages: [newItem]
						}
					});
				}

				const inboundEmailLog = await logCommunication({
					type: 'email',
					direction: 'inbound',
					status: 'success',
					source: customerEmail,
					destination: toEmail,
					company_id: companyId,
					customer_id: contact?.id ?? undefined,
					summary: subject,
					content: textBody,
					metadata: { thread_id: threadId, email_message_id: msgId }
				});

				// Trigger the AI unified pipeline (ProfileDB signals) — same as SMS.
				Promise.resolve().then(async () => {
					try {
						await UnifiedPipeline.process({
							provider: 'email_inbound',
							eventType: 'email.received',
							externalId: msgId,
							companyId: companyId,
							customerEmail: customerEmail,
							customerName: customerName,
							sessionId: threadId,
							textContent: textBody,
							metadata: { subject }
						});
					} catch (pipeErr) {
						console.error('[Gmail Sync] Pipeline Error:', pipeErr);
					}
				});

				// Run the SAME orchestrator the inbound SMS/voice path uses, so an inbound email gets AI
				// analysis, a drafted EMAIL reply, and tasks on its comm-log — not just a ProfileDB event.
				Promise.resolve().then(async () => {
					try {
						if (!inboundEmailLog?.id) return;
						const { analyzeCallLog } = await import('$lib/server/openai');
						const analysis = await analyzeCallLog(textBody);
						await prisma.communicationLog.update({
							where: { id: inboundEmailLog.id },
							data: {
								summary: analysis.summary || subject || undefined,
								metadata: {
									thread_id: threadId,
									email_message_id: msgId,
									channel: 'email',
									intent: analysis.intent,
									sub_intent: analysis.sub_intent,
									datetime: analysis.datetime,
									urgency: analysis.urgency,
									sentiment: analysis.sentiment,
									// Reply channel is email; force the orchestrator to draft an email (not SMS).
									requested_contact_method: 'email',
									ai_extracted_email: analysis.ai_extracted_email || customerEmail
								}
							}
						});
						const { process_orchestrator } = await import('$lib/server/orchestrator');
						await process_orchestrator(inboundEmailLog.id, 'email_ai_ready');
					} catch (orchErr) {
						console.error('[Gmail Sync] Orchestrator error:', orchErr);
					}
				});
			}
			processed++;
		}
		
		// Update history id if we fetched profile
		if (!newHistoryId) {
			const profRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/profile`, {
				headers: { Authorization: `Bearer ${auth.token}` }
			});
			if (profRes.ok) {
				const prof = await profRes.json();
				newHistoryId = prof.historyId;
			}
		}

		if (newHistoryId && newHistoryId !== lastHistoryId) {
			await prisma.googleCalendarConnection.update({
				where: { companyId },
				data: { lastEmailHistoryId: newHistoryId }
			});
		}

		return { success: true, processed };
	} catch (e) {
		console.error(`[gmail-sync] Error syncing emails for ${companyId}:`, e);
		return { success: false, error: e };
	}
}

async function fetchRecentMessages(token: string, set: Set<string>) {
	const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=-in:chats`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (res.ok) {
		const data = await res.json();
		if (data.messages) {
			for (const m of data.messages) {
				set.add(m.id);
			}
		}
	}
}
