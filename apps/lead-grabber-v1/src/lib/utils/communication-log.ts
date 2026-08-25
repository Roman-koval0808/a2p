import { prisma } from '$lib/db';
import {
	resolveEngagementThread,
	ENGAGEMENT_RULES_VERSION
} from '$lib/server/telemetry/engagement';
import { createNotification } from '$lib/utils/notifications';
import { isA2pDbEnabled, mirrorToA2p } from '$lib/server/a2p-db';

export type CommunicationType =
	| 'email'
	| 'sms'
	| 'voice'
	| 'web'
	| 'facebook'
	| 'chatbot'
	| 'leadform'
	| 'leadbox'
	| 'viewroom';
export type CommunicationDirection = 'inbound' | 'outbound';
export type CommunicationStatus = 'success' | 'failed' | 'pending' | 'missed' | 'completed' | 'pending_approval';

export interface CommunicationLogEntry {
	type: CommunicationType;
	direction: CommunicationDirection;
	status: CommunicationStatus;
	source?: string;
	destination?: string;
	customer_id?: string;
	company_id?: string;
	user_id?: string;
	summary?: string;
	content?: string;
	duration?: number;
	metadata?: Record<string, any>;
	assigned_members?: string[];
	thread_id?: string;
	/** Optional: for A2P mirror (contact name/company) */
	contact_name?: string;
	contact_company?: string;
	/** When false, skip the notification/email — still writes the log row (audit trails). */
	notify?: boolean;
}

/**
 * Logs a communication event to the database.
 * @param entry The communication log entry details
 * @returns The created record or null if logging failed
 */
export async function logCommunication(entry: CommunicationLogEntry) {
	try {
		if (!entry.company_id) {
			console.error('logCommunication failed: company_id is required');
			return null;
		}

		// Use a transaction to ensure log and thread are created together
		const record = await prisma.$transaction(async (tx) => {
			let threadId = entry.thread_id || (entry.metadata as { commId?: string })?.commId || (entry.metadata as { communicationThreadId?: string })?.communicationThreadId;

			// A thread is one customer's conversation, and the COM id shown in the UI is derived
			// from it. Callers hand us a thread id from all sorts of places — a semantic match, a
			// Gmail thread, a prior message — and until now we attached the log to whatever was
			// passed. That let one customer's message land on another's thread and inherit their
			// COM id, which is what put Sam's call and Bert's email under one code.
			//
			// If the thread already exists and belongs to somebody else, we don't join it. A fresh
			// thread is created below instead. Threads owned by nobody yet (contactId null) are
			// fine to join and get claimed.
			if (threadId && entry.company_id && entry.customer_id) {
				const existingThread = await tx.communicationThread.findUnique({
					where: { id: threadId },
					select: { contactId: true }
				});
				if (existingThread?.contactId && existingThread.contactId !== entry.customer_id) {
					console.warn(
						`[communication-log] Thread ${threadId} belongs to contact ${existingThread.contactId}, ` +
							`not ${entry.customer_id} — starting a separate thread rather than sharing a COM id.`
					);
					threadId = undefined;
				}
			}

			// A caller-supplied id is only an ENGAGEMENT reference if it actually names one of this
			// contact's threads. The SMS webhook passes the customer's phone number as `thread_id`,
			// and Gmail passes its own thread key — those are CHANNEL identifiers, not engagements.
			// Honouring them verbatim opened a new engagement per channel key, which is why one
			// customer's SMS exchange split across two ENG ids minutes apart.
			//
			// Roadmap rule #1 is "explicit engagement/project/quote/case reference -> use it". A
			// phone number is not that. So: keep the id when it names an existing thread of theirs,
			// otherwise drop it and let the engagement rule below decide.
			if (threadId && entry.company_id && entry.customer_id) {
				const named = await tx.communicationThread.findUnique({
					where: { id: threadId },
					select: { id: true, contactId: true }
				});
				if (!named || (named.contactId && named.contactId !== entry.customer_id)) {
					threadId = undefined;
				}
			}

			if (threadId && entry.company_id) {
				// Ensure thread exists if an ID was passed in
				await tx.communicationThread.upsert({
					where: { id: threadId },
					create: {
						id: threadId,
						companyId: entry.company_id,
						contactId: entry.customer_id || null,
						status: 'open',
						summary: entry.summary || null
					},
					update: {}
				});
			}

			// No thread handed in — apply the ENGAGEMENT rule before opening a new one.
			//
			// An engagement is one stretch of doing business with a customer, not one job. A furnace
			// call and a roof call from the same person belong to the same episode. This used to
			// create a brand-new thread for every log that arrived without an explicit id, so the
			// same contact's second email three minutes later opened a second engagement — the rule
			// was only ever wired into the telemetry intake, and email/SMS/voice/leadbox all come
			// through here instead.
			//
			// Same rule, same order as `resolveEngagementThread`: the contact's open thread wins
			// whatever the subject, then a recent one inside its inactivity window, then a new one.
			if (!threadId && entry.company_id && entry.customer_id) {
				// The same lock key the telemetry path uses, so both serialise against each other —
				// otherwise a page view and an email arriving together each open an engagement.
				const lockKey = `eng_${entry.company_id}_contact_${entry.customer_id}`;
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

				const where = { companyId: entry.company_id, contactId: entry.customer_id };
				const [openThread, recentThread] = await Promise.all([
					tx.communicationThread.findFirst({
						where: { ...where, status: { not: 'closed' } },
						orderBy: { updated: 'desc' }
					}),
					tx.communicationThread.findFirst({ where, orderBy: { updated: 'desc' } })
				]);

				const toOpen = (t: any) =>
					t
						? {
								id: t.id,
								status: t.status,
								subtopics: Array.isArray(t.subtopics) ? t.subtopics : [],
								updated: new Date(t.updated)
							}
						: null;

				const decision = resolveEngagementThread({
					openThread: toOpen(openThread),
					recentThread: toOpen(recentThread)
				});

				if (decision.decision !== 'new' && decision.threadId) {
					threadId = decision.threadId;
					await tx.communicationThread.update({
						where: { id: threadId },
						data: {
							assignReason: decision.reason,
							rulesVersion: ENGAGEMENT_RULES_VERSION,
							...(entry.summary ? { summary: entry.summary } : {})
						}
					});
				}
			}

			if (!threadId && entry.company_id) {
				const newThread = await tx.communicationThread.create({
					data: {
						companyId: entry.company_id,
						contactId: entry.customer_id || null,
						status: 'open',
						summary: entry.summary || null,
						assignReason: 'new_engagement',
						rulesVersion: ENGAGEMENT_RULES_VERSION
					}
				});
				threadId = newThread.id;
			}

			const data: any = {
				type: entry.type,
				direction: entry.direction,
				status: entry.status,
				source: entry.source || null,
				destination: entry.destination || null,
				customerId: entry.customer_id || null,
				companyId: entry.company_id,
				userId: entry.user_id || null,
				summary: entry.summary || null,
				content: entry.content || null,
				duration: entry.duration ?? null,
				metadata: entry.metadata || null
			};

			if (threadId) {
				data.communicationThreadId = threadId;
				let metaObj = entry.metadata || {};
				if (typeof metaObj === 'object' && !Array.isArray(metaObj)) {
					metaObj = {
						...metaObj,
						commId: threadId
					};
				}
				data.metadata = metaObj;
			}

			const newRecord = await tx.communicationLog.create({
				data
			});

			// Handle assigned members if provided
			if (entry.assigned_members && entry.assigned_members.length > 0) {
				await tx.communicationLogAssignedMember.createMany({
					data: entry.assigned_members.map((userId) => ({
						communicationLogId: newRecord.id,
						userId
					})),
					skipDuplicates: true
				});
			}
			return newRecord;
		}, {
			// Prisma's interactive transactions default to a 5s ceiling. This one runs several
			// statements against a database ~150ms away, and it is called from the dial-ladder path
			// while a bridge is being placed — under that load it overran, Prisma closed the
			// transaction, and the next statement failed with P2028 ("Transaction not found"), losing
			// the log row for a call that had actually been made. Same ceiling raised in intake.ts.
			timeout: 20_000,
			maxWait: 15_000
		});

		// Show notification for every communication log (unless explicitly silenced for audit rows)
		if (entry.company_id && entry.notify !== false) {
			await createNotification({
				company_id: entry.company_id,
				type: entry.type,
				direction: entry.direction,
				source_name: entry.source ?? undefined,
				source_identifier: entry.destination ?? undefined,
				message_preview:
					(entry.summary ?? entry.content ?? '').slice(0, 120) +
					((entry.summary ?? entry.content ?? '').length > 120 ? '...' : ''),
				content: entry.content ?? undefined,
				communication_log_id: record.id,
				communication_thread_id: record.communicationThreadId,
				thread_id: (entry.metadata as { thread_id?: string })?.thread_id || entry.thread_id
			} as any); // using as any since we added communication_thread_id in DB but types might not be updated yet
		}

		// Mirror into A2P DB when configured (leadbox/leadform/email/etc. then appear on A2P comm log page)
		if (isA2pDbEnabled()) {
			mirrorToA2p({
				type: entry.type,
				direction: entry.direction,
				source: entry.source,
				destination: entry.destination,
				summary: entry.summary,
				content: entry.content,
				metadata: entry.metadata,
				contact_name: entry.contact_name,
				contact_company: entry.contact_company
			}).catch((err) => console.error('A2P mirror failed:', err));
		}

		return record;
	} catch (err) {
		console.error('Failed to log communication:', err);
		// We don't want to throw here to prevent disrupting the main flow
		return null;
	}
}
