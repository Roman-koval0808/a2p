import { prisma } from '$lib/db';
import { getConnectionAccessToken } from '../google-calendar';
import { processInboundEmail, type InboundEmailPayload } from './bridge';
import { logCommunication } from '$lib/utils/communication-log';
import { createOrUpdateContact } from '$lib/utils/contacts';
import { extractCallbackNumber, normalizePhoneNumber } from '$lib/utils/phone';
import { sanitizeEmailBody, isMarketingBlast } from './sanitize';
import { UnifiedPipeline } from '$lib/server/pipeline/unified-pipeline';
import { enrichProfilePostTranscription } from '$lib/server/identity/identity-service';
import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

/** Per-company mutex so concurrent sweep calls don't create duplicate logs for the same message. */
const syncLocks = new Map<string, Promise<SyncResult>>();

/**
 * How long a claim is trusted before another instance may take the message over.
 * Covers the slowest observed message processing (AI analysis + pipeline + draft)
 * with room to spare, so a healthy run is never stolen from, while a message left
 * claimed by a crashed process is retried instead of being lost forever.
 */
const CLAIM_TAKEOVER_MS = 10 * 60 * 1000;

/**
 * Atomically claim a Gmail message for processing, across every instance sharing
 * this database. `syncLocks` only guards one process; two deployments polling the
 * same mailbox both passed the "already logged?" read before either wrote, and the
 * message was logged — and drafted a reply — twice. Returns false when another
 * instance holds a live claim.
 */
async function claimGmailMessage(companyId: string, messageId: string): Promise<boolean> {
	const staleBefore = new Date(Date.now() - CLAIM_TAKEOVER_MS);
	try {
		const rows = await prisma.$queryRaw<{ id: string }[]>`
			INSERT INTO email_sync_claims ("id", "companyId", "messageId", "claimedAt")
			VALUES (gen_random_uuid()::text, ${companyId}, ${messageId}, NOW())
			ON CONFLICT ("companyId", "messageId")
			DO UPDATE SET "claimedAt" = NOW()
			WHERE email_sync_claims."claimedAt" < ${staleBefore}
			RETURNING "id"
		`;
		return rows.length > 0;
	} catch (err) {
		console.error(`[gmail-sync] Claim failed for message ${messageId}:`, err);
		return false;
	}
}

interface SyncResult {
	success: boolean;
	reason?: string;
	count?: number;
	processed?: number;
	error?: unknown;
}

interface AttachmentInfo {
	filename: string;
	mimeType: string;
	attachmentId: string;
	size?: number;
}

export function extractAttachments(payload: any): AttachmentInfo[] {
	const results: AttachmentInfo[] = [];
	function walk(part: any) {
		if (part.body?.attachmentId && part.filename) {
			results.push({
				filename: part.filename,
				mimeType: part.mimeType || 'application/octet-stream',
				attachmentId: part.body.attachmentId,
				size: part.body.size
			});
		}
		if (part.parts) {
			for (const p of part.parts) walk(p);
		}
	}
	if (payload) walk(payload);
	return results;
}

/**
 * Bunny object keys are path segments in a URL — a filename carrying "/" or ".." would escape the
 * per-log folder, and spaces/quotes break the CDN link. Keep the basename, flatten everything else.
 */
export function sanitizeAttachmentName(filename: string): string {
	const base = filename.split(/[\\/]/).pop() || 'file';
	const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '');
	return cleaned.slice(0, 120) || 'file';
}

export async function fetchAndSaveAttachment(
	token: string,
	messageId: string,
	attachment: AttachmentInfo,
	commLogId: string
): Promise<string | null> {
	try {
		const res = await fetch(
			`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachment.attachmentId}`,
			{ headers: { Authorization: `Bearer ${token}` } }
		);
		if (!res.ok) {
			console.warn(`[gmail-sync] Failed to fetch attachment ${attachment.filename}: ${res.status}`);
			return null;
		}
		const data = await res.json();
		if (!data.data) {
			console.warn(`[gmail-sync] No data for attachment ${attachment.filename}`);
			return null;
		}
		const decoded = Buffer.from(data.data, 'base64url');
		const safeName = sanitizeAttachmentName(attachment.filename);

		// Primary store: Bunny CDN. The app runs on ephemeral containers, so anything written to
		// local disk is lost on the next deploy — attachments have to live off-box.
		try {
			const { uploadToBunny } = await import('$lib/server/bunny');
			const cdnUrl = await uploadToBunny(decoded, safeName, `email/${commLogId}`);
			console.log(`[gmail-sync] Attachment ${safeName} → ${cdnUrl}`);
			return cdnUrl;
		} catch (bunnyErr) {
			console.error(
				`[gmail-sync] Bunny upload failed for ${safeName}, falling back to local disk:`,
				bunnyErr
			);
		}

		// Fallback only (dev without Bunny creds, or a Bunny outage). Served by
		// /api/email-attachment/[commId]/[filename], which also still serves pre-Bunny attachments.
		const dir = join(process.cwd(), 'static/uploads/email', commLogId);
		if (!existsSync(dir)) {
			await mkdir(dir, { recursive: true });
		}
		const filePath = join(dir, safeName);
		await writeFile(filePath, decoded);
		return `/api/email-attachment/${commLogId}/${encodeURIComponent(safeName)}`;
	} catch (err) {
		console.error(`[gmail-sync] Error saving attachment ${attachment.filename}:`, err);
		return null;
	}
}

export async function syncCompanyEmails(companyId: string) {
	const existing = syncLocks.get(companyId);
	if (existing) {
		try {
			return await existing;
		} catch {
			/* fall through to rerun */
		}
	}
	const promise = (async () => {
		try {
			return await syncCompanyEmailsInner(companyId);
		} finally {
			syncLocks.delete(companyId);
		}
	})().catch((e) => {
		syncLocks.delete(companyId);
		throw e;
	});
	syncLocks.set(companyId, promise);
	return promise;
}

async function syncCompanyEmailsInner(companyId: string) {
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
		const connCreated = conn.created;
		if (lastHistoryId) {
			// Fetch history
			const res = await fetch(
				`https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${lastHistoryId}`,
				{
					headers: { Authorization: `Bearer ${auth.token}` }
				}
			);
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
				console.warn(
					`[gmail-sync] History sync failed for ${companyId}, falling back to recent messages. Error: ${errText}`
				);
				await fetchRecentMessages(auth.token, messagesToFetch, connCreated);
			}
		} else {
			// Initial sync: fetch only messages since the connection was created
			await fetchRecentMessages(auth.token, messagesToFetch, connCreated);
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
		for (const msgId of Array.from(messagesToFetch).slice(0, 50)) {
			// limit to 50 per run
			// Check if already processed
			const existingLog = await prisma.communicationLog.findFirst({
				where: { companyId, metadata: { path: ['email_message_id'], equals: msgId } }
			});
			if (existingLog) continue;

			// The read above races with every other instance sharing this database, so
			// take a durable claim before doing any work on the message.
			if (!(await claimGmailMessage(companyId, msgId))) {
				console.log(`[gmail-sync] Message ${msgId} claimed by another instance — skipping`);
				continue;
			}

			const msgRes = await fetch(
				`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
				{
					headers: { Authorization: `Bearer ${auth.token}` }
				}
			);
			if (!msgRes.ok) continue;
			const msgData = await msgRes.json();

			const headers = msgData.payload?.headers || [];
			const getHeader = (name: string) =>
				headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

			const from = getHeader('From');
			// Not every sent message carries a usable `To` — Gmail omits it on some sends, and a
			// message promoted from a draft can land here with the recipient only in the delivery
			// headers. An empty recipient used to flow straight through: the row logged with a blank
			// destination ("—" in the UI), the contact was created without an address, and the
			// outbound review resolved with email:null — stripping the identity the cross-channel
			// matcher keys on, so a later SMS/call could never be linked back to this email.
			const to =
				getHeader('To') ||
				getHeader('Delivered-To') ||
				getHeader('X-Original-To') ||
				getHeader('Cc') ||
				getHeader('Bcc');
			const subject = getHeader('Subject');
			const date = getHeader('Date');

			// Simple extraction of email address from "Name <email@domain.com>"
			const extractEmail = (str: string) =>
				str.match(/<(.+)>|(\S+@\S+)/)?.[0]?.replace(/[<>]/g, '') || str;
			const fromEmail = extractEmail(from).toLowerCase();
			// `To` may list several recipients ("a@x.com, b@y.com") — the first is the customer.
			const toEmail = extractEmail(to.split(',')[0] || '').toLowerCase();

			const isOutgoing = fromEmail === auth.email.toLowerCase();
			const customerEmail = isOutgoing ? toEmail : fromEmail;
			if (!customerEmail.includes('@')) {
				// Without a counterparty there is nothing to thread this message to. Skip it rather
				// than logging an orphan row that silently breaks cross-channel matching.
				console.warn(
					`[gmail-sync] Skipping message ${msgId}: no resolvable ${isOutgoing ? 'recipient' : 'sender'} (from="${from}" to="${to}").`
				);
				continue;
			}
			const customerNameMatch = (isOutgoing ? to : from).match(/^([^<]+)/);
			let customerName = customerNameMatch
				? customerNameMatch[1].trim().replace(/^"|"$/g, '')
				: customerEmail;
			if (!customerName) customerName = customerEmail;

			// Extract body. Capture BOTH text/plain and text/html — our own outbound confirmations are
			// HTML-only, so a text/plain-only reader left their comm-log content empty.
			let textBody = '';
			let htmlBody = '';
			const extractBody = (part: any) => {
				if (part.mimeType === 'text/plain' && part.body?.data) {
					textBody += Buffer.from(part.body.data, 'base64url').toString('utf8');
				} else if (part.mimeType === 'text/html' && part.body?.data) {
					htmlBody += Buffer.from(part.body.data, 'base64url').toString('utf8');
				} else if (part.parts) {
					for (const p of part.parts) extractBody(p);
				}
			};
			if (msgData.payload) extractBody(msgData.payload);
			if (!textBody && htmlBody) {
				// HTML-only email: strip tags/styles to readable plain text.
				textBody = htmlBody
					.replace(/<style[\s\S]*?<\/style>/gi, '')
					.replace(/<script[\s\S]*?<\/script>/gi, '')
					.replace(/<br\s*\/?>(?=)/gi, '\n')
					.replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
					.replace(/<[^>]+>/g, ' ')
					.replace(/&nbsp;/gi, ' ')
					.replace(/&amp;/gi, '&')
					.replace(/[ \t]+/g, ' ')
					.replace(/\n\s*\n\s*\n+/g, '\n\n')
					.trim();
			}
			if (!textBody && msgData.snippet) textBody = msgData.snippet;

			// Sanitize the body before it hits the comm log, identity matching,
			// and the AI: strip tracking/marketing boilerplate and quoted history.
			// The customer's real email address is always kept.
			const isMarketing = isMarketingBlast(textBody);
			const cleanBody = sanitizeEmailBody(textBody);

			// A phone number the customer wrote in the body ("you can remember me as +17864906293")
			// is a stronger identity key than the email address alone. Grab it BEFORE contact/profile
			// resolution so the message lands on the existing customer instead of minting a new one.
			// Outgoing sends skip this: our own signature numbers must never match a customer.
			const callbackPhone = isOutgoing ? null : extractCallbackNumber(cleanBody);
			const normalizedCallbackPhone = callbackPhone ? normalizePhoneNumber(callbackPhone) : null;

			// Identify thread id
			const threadId = msgData.threadId || `email-${msgId}`;

			// Store via similar logic to inbound bridge
			const contact = await createOrUpdateContact({
				company_id: companyId,
				name: customerName,
				email: customerEmail,
				phone: normalizedCallbackPhone ?? undefined
			});

			if (isOutgoing) {
				// Don't duplicate: link this Gmail message to an existing draft/log on the
				// same thread, so the UI shows tracking status on the correct row.
				//
				// `email_message_id` is the only per-message identity. The thread fallback exists
				// solely to ADOPT a draft we logged ourselves that hasn't been matched to its sent
				// message yet — it must never match an already-synced message. Matching the whole
				// thread meant the SECOND email in a thread was mistaken for the first: its body
				// overwrote the earlier row, `outbound_reviewed` was already true so no review ran,
				// and the `continue` below dropped it — leaving the conversation with no container
				// for a later SMS/call to thread onto.
				let existingOutbound = await prisma.communicationLog.findFirst({
					where: {
						companyId,
						direction: 'outbound',
						type: 'email',
						metadata: { path: ['email_message_id'], equals: msgId }
					}
				});
				if (!existingOutbound) {
					const threadDrafts = await prisma.communicationLog.findMany({
						where: {
							companyId,
							direction: 'outbound',
							type: 'email',
							metadata: { path: ['thread_id'], equals: threadId }
						},
						orderBy: { created: 'desc' }
					});
					// Only an un-adopted draft (no Gmail message id yet) may claim this message.
					existingOutbound =
						threadDrafts.find(
							(l) => !((l.metadata as Record<string, any>) || {}).email_message_id
						) || null;
				}
				if (existingOutbound) {
					// Update the existing log with the Gmail message ID and latest content
					const meta = (existingOutbound.metadata as Record<string, any>) || {};
					let needsUpdate = false;
					const updateData: any = {};
					const newMeta = { ...meta };

					if (!meta.email_message_id) {
						newMeta.email_message_id = msgId;
						updateData.metadata = newMeta;
						needsUpdate = true;
					}

					if (existingOutbound.content !== cleanBody || existingOutbound.summary !== subject) {
						updateData.content = cleanBody;
						updateData.summary = subject;
						needsUpdate = true;
					}

					if (needsUpdate) {
						await prisma.communicationLog.update({
							where: { id: existingOutbound.id },
							data: updateData
						});
					}

					// If it now has content but hasn't been reviewed yet (e.g., started as an empty draft), review it now.
					if (cleanBody && !meta.outbound_reviewed) {
						Promise.resolve().then(async () => {
							try {
								const { reviewOutboundEmail } = await import('./outbound-review');
								const review = await reviewOutboundEmail({
									companyId,
									logId: existingOutbound.id,
									content: cleanBody,
									subject,
									customerEmail,
									customerPhone: contact?.phone || undefined,
									customerContactId: contact?.id ?? undefined,
									fromEmail
								});
								console.log(
									`[gmail-sync] Outbound review (draft->sent): ${review.reviewed ? 'done' : `skipped (${review.reason})`} commRef=${review.commRef || '—'} reused=${review.reusedContainer} tasks=${review.tasksCreated} timer=${review.timerRegistered}`
								);
							} catch (reviewErr) {
								console.error('[gmail-sync] Outbound review error on draft->sent:', reviewErr);
							}
						});
					}

					processed++;
					continue;
				}

				// No exact Gmail match. Reuse the existing conversation instead of creating a
				// new thread, so a sent reply shows up as "Out" in the same comm id as the
				// original inbound email (not as a brand-new conversation).
				let linkThreadId: string | null = null;

				// 1) Same Gmail thread as an already-synced message (real Gmail replies land
				//    in the same thread as the inbound email we logged).
				const sameThreadLog = await prisma.communicationLog.findFirst({
					where: {
						companyId,
						metadata: { path: ['thread_id'], equals: threadId },
						communicationThreadId: { not: null }
					},
					select: { communicationThreadId: true },
					orderBy: { created: 'desc' }
				});
				if (sameThreadLog?.communicationThreadId) {
					linkThreadId = sameThreadLog.communicationThreadId;
				} else {
					// 2) Same customer emailed recently (e.g. confirmation sent via Brevo with
					//    a fresh Gmail thread) — join the most recent inbound thread instead.
					const recentInbound = await prisma.communicationLog.findFirst({
						where: {
							companyId,
							direction: 'inbound',
							type: 'email',
							source: customerEmail,
							communicationThreadId: { not: null },
							created: { gte: new Date(Date.now() - 48 * 3600 * 1000) }
						},
						select: { communicationThreadId: true },
						orderBy: { created: 'desc' }
					});
					if (recentInbound?.communicationThreadId) {
						linkThreadId = recentInbound.communicationThreadId;
					}
				}
				if (linkThreadId) {
					console.log(
						`[gmail-sync] Linking outgoing message ${msgId} to existing thread ${linkThreadId}`
					);
				}
			// Same unique-index guard as the inbound path: a duplicate here means the
			// sent message was already logged (e.g. adoption raced with a fresh insert).
			let outboundLog;
			try {
				outboundLog = await logCommunication({
					type: 'email',
					direction: 'outbound',
					status: 'success',
					source: fromEmail,
					destination: customerEmail,
					company_id: companyId,
					customer_id: contact?.id ?? undefined,
					summary: subject,
					content: cleanBody,
					thread_id: linkThreadId || undefined,
					metadata: { thread_id: threadId, subject, email_message_id: msgId }
				});
			} catch (err) {
				if ((err as any)?.code === 'P2002') {
					console.warn(`[gmail-sync] Outbound message ${msgId} already logged — skipping duplicate.`);
					processed++;
					continue;
				}
				console.error(`[gmail-sync] Failed to log outbound message ${msgId}:`, err);
				continue;
			}

				// Mailbox-sent email: run the outbound review so the orchestrator world gets an
				// AI summary, an open container and pending follow-up tasks for what was sent. A
				// later phone/SMS/email reply from the customer is then matched to this container.
				const outboundLogId = outboundLog?.id;
				Promise.resolve().then(async () => {
					try {
						if (!outboundLogId) return;
						const { reviewOutboundEmail } = await import('./outbound-review');
						const review = await reviewOutboundEmail({
							companyId,
							logId: outboundLogId,
							content: cleanBody,
							subject,
							customerEmail,
							customerPhone: contact?.phone || undefined,
							customerContactId: contact?.id ?? undefined,
							fromEmail
						});
						console.log(
							`[gmail-sync] Outbound review: ${review.reviewed ? 'done' : `skipped (${review.reason})`} commRef=${review.commRef || '—'} reused=${review.reusedContainer} tasks=${review.tasksCreated} timer=${review.timerRegistered}`
						);
					} catch (reviewErr) {
						console.error('[gmail-sync] Outbound review error:', reviewErr);
					}
				});
			} else {
			// Store as inbound
			const newItem = {
				content: cleanBody || '(No content)',
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

			// Belt-and-suspenders: the durable claim above stops a second instance from ever
			// reaching this insert, but if a row for this message was written by another path
			// (or the claim table was reset), the unique index on (companyId, email_message_id)
			// rejects the duplicate — skip rather than firing the pipeline twice.
			let inboundEmailLog;
			try {
				inboundEmailLog = await logCommunication({
					type: 'email',
					direction: 'inbound',
					status: 'success',
					source: customerEmail,
					destination: toEmail,
					company_id: companyId,
					customer_id: contact?.id ?? undefined,
					summary: subject,
					content: cleanBody,
					metadata: {
						thread_id: threadId,
						// The subject also lives in `summary`, but the orchestrator overwrites
						// that with the AI summary and every consumer (summary dialog, hub,
						// ACT-EMAIL-002's subject param) reads metadata.subject — leaving them
						// all showing "No subject" for a mail that plainly had one.
						subject,
						email_message_id: msgId,
						email_sanitized: true,
						...(isMarketing ? { marketing_email: true } : {})
					}
				});
			} catch (err) {
				if ((err as any)?.code === 'P2002') {
					console.warn(`[gmail-sync] Message ${msgId} already logged — skipping duplicate.`);
					continue;
				}
				console.error(`[gmail-sync] Failed to log inbound message ${msgId}:`, err);
				continue;
			}

				// Trigger the AI unified pipeline (ProfileDB signals) — same as SMS.
				Promise.resolve().then(async () => {
					try {
						await UnifiedPipeline.process({
							provider: 'email_inbound',
							eventType: 'email.received',
							externalId: msgId,
							companyId: companyId,
							customerPhone: normalizedCallbackPhone ?? undefined,
							customerEmail: customerEmail,
							customerName: customerName,
							sessionId: threadId,
							textContent: cleanBody,
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

						// Process attachments (images/files) from the Gmail message
						const attachments = extractAttachments(msgData.payload);
						const savedAttachments: { name: string; url: string; mime: string }[] = [];
						if (attachments.length > 0) {
							console.log(
								`[gmail-sync] Processing ${attachments.length} attachment(s) for message ${msgId}`
							);
							for (const att of attachments) {
								const url = await fetchAndSaveAttachment(
									auth.token,
									msgId,
									att,
									inboundEmailLog.id
								);
								if (url) {
									savedAttachments.push({ name: att.filename, url, mime: att.mimeType });
								}
							}
						}

						const { analyzeCallLog } = await import('$lib/server/openai');
						const analysis = await analyzeCallLog(cleanBody);

						// The AI often extracts the customer's real name ("Sam") from the message
						// body, which beats the From-header display name ("Studio Blopp"). Persist
						// it onto the Contact so the comm log / profiles show the real person.
						if (
							analysis.callerName &&
							analysis.callerName.trim() &&
							analysis.callerName !== contact?.name
						) {
							try {
								const updated = await createOrUpdateContact({
									company_id: companyId,
									name: analysis.callerName.trim(),
									email: customerEmail,
									phone: contact?.phone || undefined
								});
								if (updated) {
									console.log(
										`[gmail-sync] Updated contact name to "${analysis.callerName.trim()}" for ${customerEmail}`
									);
								}
							} catch (nameErr) {
								console.error('[gmail-sync] Failed to persist AI-extracted name:', nameErr);
							}
						}

						const senderEmail = (analysis.ai_extracted_email || customerEmail).toLowerCase();
						const extractedPhone = (analysis.ai_extracted_phone || callbackPhone || '').trim();
						const normalizedExtractedPhone = extractedPhone
							? normalizePhoneNumber(extractedPhone)
							: null;
						// This object REPLACES the metadata written when the log row was
						// created — anything not repeated here is lost. That is what kept
						// erasing the Subject: header (and the sanitisation flag) seconds
						// after it was stored, leaving every consumer showing "No subject".
						const metadata: Record<string, any> = {
							thread_id: threadId,
							subject,
							email_sanitized: true,
							email_message_id: msgId,
							channel: 'email',
							intent: analysis.intent,
							sub_intent: analysis.sub_intent,
							datetime: analysis.datetime,
							urgency: analysis.urgency,
							sentiment: analysis.sentiment,
							requested_contact_method: 'email',
							ai_extracted_email: analysis.ai_extracted_email || customerEmail,
							ai_extracted_phone: extractedPhone || undefined
						};
						if (savedAttachments.length > 0) {
							metadata.attachments = savedAttachments;
						}

						// Profile merge candidate detection + structured_fields persistence
						try {
							// Resolve by PHONE first when the customer stated one: a phone match (from a
							// prior call/SMS) is the strongest signal they're an existing customer. Email
							// is only a fallback key — otherwise "you can remember me as +1786..." mints
							// a brand-new Roman instead of attaching to the one that already exists.
							let profile: any = null;
							if (normalizedExtractedPhone) {
								const phoneCandidates = await prisma.pipelineCustomerProfile.findMany({
									where: {
										companyId,
										OR: [
											{ phoneNumber: { not: null } },
											{ identifiers: { some: { kind: 'phone' } } }
										]
									},
									select: { id: true, phoneNumber: true, identifiers: true }
								});
								profile =
									phoneCandidates.find(
										(p: any) =>
											(p.phoneNumber &&
												normalizePhoneNumber(p.phoneNumber) === normalizedExtractedPhone) ||
											p.identifiers.some(
												(i: any) =>
													i.kind === 'phone' &&
													normalizePhoneNumber(i.value) === normalizedExtractedPhone
											)
									) ?? null;
							}
							if (!profile) {
								profile = await prisma.pipelineCustomerProfile.findFirst({
									where: { companyId, email: senderEmail }
								});
							}
							if (!profile) {
								profile = await prisma.pipelineCustomerProfile.create({
									data: {
										companyId,
										email: senderEmail,
										displayName: customerName || senderEmail
									}
								});
							}
							if (normalizedExtractedPhone) {
								// Link the phone to the profile it resolved to so future calls, SMS, or
								// emails carrying this number land on the SAME customer.
								await prisma.commIdentifier
									.upsert({
										where: {
											customerProfileId_kind_value: {
												customerProfileId: profile.id,
												kind: 'phone',
												value: normalizedExtractedPhone
											}
										},
										create: {
											customerProfileId: profile.id,
											kind: 'phone',
											value: normalizedExtractedPhone
										},
										update: {}
									})
									.catch(() => {});
								if (!profile.phoneNumber) {
									await prisma.pipelineCustomerProfile
										.update({
											where: { id: profile.id },
											data: { phoneNumber: normalizedExtractedPhone }
										})
										.catch(() => {});
								}
							}
							const enrichResult = await enrichProfilePostTranscription(null, {
								companyId,
								customerProfileId: profile.id,
								extractedName: analysis.callerName || customerName,
								extractedEmail: senderEmail
							});
							if (enrichResult.mergeCandidate) {
								metadata.merge_candidate = {
									profile_id: enrichResult.mergeCandidate.profileId,
									reason: enrichResult.mergeCandidate.reason
								};
								// Persist it too — metadata on one log is invisible to the review screen.
								const { recordMergeCandidate } = await import('$lib/server/identity/merge-service');
								await recordMergeCandidate({
									companyId,
									primaryProfileId: enrichResult.mergeCandidate.profileId,
									duplicateProfileId: profile.id,
									reason: enrichResult.mergeCandidate.reason,
									detectedFromCommId: inboundEmailLog.id
								});
							}
							// Merge structured fields into profile attributes
							const sf = analysis.structured_fields;
							if (sf && Object.keys(sf).length > 0) {
								const existing = await prisma.pipelineCustomerProfile.findUnique({
									where: { id: profile.id },
									select: { attributes: true }
								});
								const existingAttrs = (existing?.attributes as Record<string, string>) || {};
								const merged = { ...existingAttrs, ...sf };
								await prisma.pipelineCustomerProfile.update({
									where: { id: profile.id },
									data: { attributes: merged }
								});
							}
						} catch (enrichErr) {
							console.error('[Gmail Sync] Profile enrichment error:', enrichErr);
						}
						await prisma.communicationLog.update({
							where: { id: inboundEmailLog.id },
							data: {
								summary: analysis.summary || subject || undefined,
								metadata
							}
						});
						const { process_orchestrator } = await import('$lib/server/orchestrator');
						await process_orchestrator(inboundEmailLog.id, 'email_ai_ready');
					} catch (orchErr) {
						console.error('[Gmail Sync] Orchestrator error:', orchErr);
					}
				});

				// ClearSky Scheduled Intents (spec §4/§10): one more question on top of what's
				// already happening — pull the customer's stated future plan out of the message
				// and write the dual record (Total Trades' CRM note + our schedule row).
				// No instant ack: the Orchestrator drafts the real reply (§ the app showed that
				// an ack + a draft for the same email is two messages for one question).
				// Non-blocking and isolated: a failure here must never break the orchestrator flow.
				Promise.resolve().then(async () => {
					try {
						if (!contact?.id) return; // nobody to file the row under
						const { extractScheduledIntent } = await import('$lib/server/ai/scheduled-intent-parser');
						const { writeScheduledIntent } = await import('$lib/server/scheduled-intent-writer');
						const { ANTHROPIC_AI_KEY } = await import('$env/static/private');

						const emailDate = new Date(date);
						const reference = isNaN(emailDate.getTime()) ? undefined : emailDate;

						const extraction = await extractScheduledIntent(cleanBody, ANTHROPIC_AI_KEY, {
							reference,
							timeZone: 'America/Toronto'
						});
						if (!extraction) {
							console.warn(`[Gmail Sync] Scheduled-intent: extraction returned null for ${msgId} (no schedule — check [anthropic.claudeJSON] errors above)`);
							return;
						}
						if (!extraction.schedulable) {
							console.warn(`[Gmail Sync] Scheduled-intent: not schedulable for ${msgId} — confidence=${extraction.confidence}, timeframe="${extraction.rawTimeframe}", target=${extraction.calculatedTargetDate ?? 'none'}`);
							return;
						}

						const written = await writeScheduledIntent({
							companyId,
							contactId: contact.id,
							profileId: contact.id,
							extraction,
							channel: 'email',
							originalTarget: customerEmail,
							conversationId: threadId,
							reference,
							idempotencyKey: `si-email-${msgId}`
						});
						if (!written.recorded) {
							console.warn(`[Gmail Sync] Scheduled-intent: not recorded for ${msgId} — ${written.reason}`);
						}
					} catch (siErr) {
						console.error('[Gmail Sync] Scheduled-intent flow error:', siErr);
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

function formatGmailDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}/${m}/${day}`;
}

async function fetchRecentMessages(token: string, set: Set<string>, since: Date) {
	const sinceStr = formatGmailDate(since);
	const res = await fetch(
		`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=-in:chats+after:${sinceStr}`,
		{
			headers: { Authorization: `Bearer ${token}` }
		}
	);
	if (res.ok) {
		const data = await res.json();
		if (data.messages) {
			for (const m of data.messages) {
				set.add(m.id);
			}
		}
	}
}
