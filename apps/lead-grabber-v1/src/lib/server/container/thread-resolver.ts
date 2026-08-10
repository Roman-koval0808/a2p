// Universal conversation resolver: decide whether ANY communication (inbound or outbound, any
// channel) continues an EXISTING open CommContainer so every leg of the conversation shares one
// COM id.
//
// How it works (kept deliberately simple):
//  1. Gather candidate containers: the customer's own open containers first; when the customer
//     has none of their own (e.g. a brand-new customer replying by text to an email we sent),
//     fall back to the company's recent open containers (they are almost always conversations
//     the company started and that are awaiting a reply).
//  2. ONE AI context check decides: does this message clearly continue one of them?
//  3. When in doubt, no link — a fresh thread is safer than a wrong merge.

import { prisma } from '$lib/db';
import { claudeJSON } from '$lib/server/anthropic';
import { ANTHROPIC_AI_KEY } from '$env/static/private';
import { normalizePhoneNumber } from '$lib/utils/phone';
import { createEntry } from './container-service';
import type { EntryChannel, EntryDirection, PartyType } from 'clearsky-db-client';

export interface ThreadResolverInput {
	companyId: string;
	contactId?: string | null;
	customerProfileId?: string | null;
	phone?: string | null;
	email?: string | null;
	channel: EntryChannel;
	direction: EntryDirection;
	subject?: string | null;
	content: string;
	summary?: string | null;
	occurredAt?: Date;
	/** Containers to never match (e.g. a container created for THIS same communication). */
	excludeCommIds?: string[];
	/** How far back to look for company-wide open containers (default 14 days). */
	windowDays?: number;
	/**
	 * The caller's contact id. When set, the resolver will reject matches to containers
	 * that belong to a DIFFERENT contact (cross-customer guard).
	 */
	callerContactId?: string | null;
	/**
	 * The caller's customer profile id. Checked as a fallback when the container has no
	 * contactId but does have a customerProfileId.
	 */
	callerCustomerProfileId?: string | null;
}

export interface ContainerCandidate {
	id: string;
	commRef: string;
	subject: string | null;
	threadType: string;
	state: string;
	openedAt: Date;
	lastActivityAt: Date;
	snippet: string;
}

export interface ContinuationMatch {
	matched: boolean;
	commId?: string;
	confidence?: number;
	reason?: string;
}

export interface ResolverResult {
	matched: boolean;
	commId?: string;
	candidate?: ContainerCandidate;
	reason?: string;
	/** The matcher's certainty (0-1). Callers taking irreversible action must gate on this. */
	confidence?: number;
	candidates: ContainerCandidate[];
}

const MAX_CANDIDATES = 15;
const MIN_CONFIDENCE = 0.6;

/** Loose comparison key for "is this container just my own message echoed back?". */
function normalizeForEcho(text: string): string {
	return (text || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/**
 * Collect open (non-closed, non-merged) CommContainers for the company that belong to the
 * resolved customer identity — matched by contact id and/or PipelineCustomerProfile ids found
 * through comm_identifiers (phone + email). Returns empty when no identity is resolvable.
 */
export async function openContainerCandidatesFor(
	input: {
		companyId: string;
		contactId?: string | null;
		customerProfileId?: string | null;
		phone?: string | null;
		email?: string | null;
		excludeCommIds?: string[];
		tx?: any;
	},
	limit = MAX_CANDIDATES
): Promise<ContainerCandidate[]> {
	const db = input.tx || prisma;

	const profileIds = new Set<string>();
	if (input.customerProfileId) profileIds.add(input.customerProfileId);

	const phone = input.phone?.trim();
	const email = input.email?.trim().toLowerCase();

	if (phone || email) {
		// Resolve profiles through the comm_identifiers collection (and the profile's own phone
		// column), matching raw + normalized phone values since callers and email signatures
		// don't always use the same formatting.
		const profiles = await db.pipelineCustomerProfile.findMany({
			where: {
				companyId: input.companyId,
				OR: [
					...(phone
						? [
								{ phoneNumber: phone },
								{ phoneNumber: normalizePhoneNumber(phone) },
								{
									identifiers: {
										some: {
											kind: 'phone',
											value: { in: [phone, normalizePhoneNumber(phone)] }
										}
									}
								}
							]
						: []),
					...(email
						? [
								{ email },
								{
									identifiers: {
										some: { kind: 'email', value: email }
									}
								}
							]
						: [])
				]
			},
			select: { id: true }
		});
		for (const p of profiles) profileIds.add(p.id);
	}

	const orParts: Record<string, unknown>[] = [];
	if (input.contactId) orParts.push({ contactId: input.contactId });
	if (profileIds.size > 0) orParts.push({ customerProfileId: { in: [...profileIds] } });
	if (orParts.length === 0) return [];

	const where: Record<string, unknown> = {
		companyId: input.companyId,
		state: { not: 'closed' },
		lifecycle: { not: 'merged' },
		OR: orParts
	};
	if (input.excludeCommIds && input.excludeCommIds.length > 0) {
		where.id = { notIn: input.excludeCommIds };
	}
	const containers = await db.commContainer.findMany({
		where,
		include: {
			entries: { orderBy: { occurredAt: 'desc' }, take: 2 }
		},
		orderBy: { lastActivityAt: 'desc' },
		take: limit
	});

	return containers.map((c: any) => {
		const entryText = [...c.entries]
			.reverse()
			.map((e: any) => e.transcript || e.analysisJson?.summary || '')
			.filter(Boolean)
			.join(' | ');
		const snippet = [c.subject, entryText].filter(Boolean).join(' — ').slice(0, 600);
		return {
			id: c.id,
			commRef: c.commRef,
			subject: c.subject || null,
			threadType: c.threadType,
			state: c.state,
			openedAt: c.openedAt,
			lastActivityAt: c.lastActivityAt,
			snippet
		};
	});
}

/**
 * Company-wide fallback candidates: open containers with recent activity. Used when the incoming
 * identity has no containers of its own (brand-new customer) — the company's pending conversations
 * are the only place a cross-channel continuation can live.
 */
export async function companyOpenCandidatesFor(
	companyId: string,
	opts?: { excludeCommIds?: string[]; windowDays?: number; limit?: number }
): Promise<ContainerCandidate[]> {
	const windowDays = opts?.windowDays ?? 14;
	const where: Record<string, unknown> = {
		companyId,
		state: { not: 'closed' },
		lifecycle: { not: 'merged' },
		lastActivityAt: { gte: new Date(Date.now() - windowDays * 24 * 3600 * 1000) }
	};
	if (opts?.excludeCommIds && opts.excludeCommIds.length > 0) {
		where.id = { notIn: opts.excludeCommIds };
	}
	const containers = await prisma.commContainer.findMany({
		where,
		include: {
			entries: { orderBy: { occurredAt: 'desc' }, take: 3 }
		},
		orderBy: { lastActivityAt: 'desc' },
		take: opts?.limit ?? 15
	});
	return containers.map((c: any) => toCandidate(c));
}

function toCandidate(c: any): ContainerCandidate {
	const entryText = [...(c.entries || [])]
		.reverse()
		.map((e: any) => e.transcript || e.analysisJson?.summary || '')
		.filter(Boolean)
		.join(' | ');
	const snippet = [c.subject, entryText].filter(Boolean).join(' — ').slice(0, 600);
	return {
		id: c.id,
		commRef: c.commRef,
		subject: c.subject || null,
		threadType: c.threadType,
		state: c.state,
		openedAt: c.openedAt,
		lastActivityAt: c.lastActivityAt,
		snippet
	};
}

/**
 * Ask the AI whether the new message continues one of the candidate containers. The AI receives
 * the candidates' commRef, subject, type and recent content and must return exactly one commRef
 * or none. Ambiguity must resolve to "no match". The `ai` option exists for tests only.
 */
export async function matchContinuationToCandidates(
	input: {
		channel: EntryChannel;
		direction: EntryDirection;
		subject?: string | null;
		content: string;
	},
	candidates: ContainerCandidate[],
	opts?: { ai?: (user: string, system: string) => Promise<any | null> }
): Promise<ContinuationMatch> {
	if (!candidates || candidates.length === 0) {
		return { matched: false, reason: 'no_open_candidates' };
	}

	const listText = candidates
		.map(
			(c) =>
				`- commRef ${c.commRef} | type=${c.threadType} | state=${c.state} | subject="${c.subject || '(none)'}" | snippet="${c.snippet}"`
		)
		.join('\n');

	const user = `New ${input.direction} ${input.channel} message${input.subject ? ` (subject: "${input.subject}")` : ''}:
"${input.content.slice(0, 4000)}"

Open conversation containers for this customer/company:
${listText}`;

	const system = `You are the continuation matcher of a business communications platform. A message just arrived — it may be FROM a customer (inbound: they are replying to something the company sent or following up on a pending request) or FROM the company (outbound: the company is replying to the customer or continuing a conversation). Each open conversation container below is one customer+topic conversation (it has a commRef, a thread type, a subject and a snippet of its recent content).

Decide whether this new message CONTINUES one of the listed open containers — i.e. the message clearly refers to that same specific topic (answering/confirming a question or appointment the company proposed, following up on a pending request, continuing the same issue). The reply may arrive on a DIFFERENT channel than the original conversation (company emailed, customer texts back) — the channel does not matter, the topic and the people do.

Rules:
- Return "linked" = true for AT MOST ONE container, and only when the message clearly refers to that same specific topic (same appointment, same pending request, same issue).
- If the message is generic, unrelated, starts a new topic, or is ambiguous in ANY way, return "linked" = false. When in doubt, do NOT link: a fresh conversation is always safer than a wrong merge.
- Never invent topics, dates, or subjects that are not present.
- Set "commRef" to the exact commRef of the matched container, or an empty string when not linked.
- "confidence" is your certainty that this is a continuation (0.0 to 1.0).
- "reason" is a short human-readable explanation.`;

	const result = opts?.ai
		? await opts.ai(user, system)
		: await claudeJSON<any>({
				apiKey: ANTHROPIC_AI_KEY,
				user,
				system,
				schema: {
					type: 'object',
					properties: {
						linked: { type: 'boolean' },
						commRef: { type: 'string' },
						confidence: { type: 'number' },
						reason: { type: 'string' }
					},
					required: ['linked', 'commRef', 'confidence', 'reason'],
					additionalProperties: false
				},
				toolName: 'match_thread',
				temperature: 0,
				maxTokens: 512
			});

	if (!result) return { matched: false, reason: 'ai_unavailable' };
	if (result.linked !== true) return { matched: false, reason: result.reason || 'ai_no_match' };

	const cand = candidates.find((c) => c.commRef === result.commRef || c.id === result.commRef);
	if (!cand) return { matched: false, reason: 'ai_returned_unknown_ref' };

	const confidence = typeof result.confidence === 'number' ? result.confidence : 0.5;
	if (confidence < MIN_CONFIDENCE) return { matched: false, reason: 'low_confidence' };

	return {
		matched: true,
		commId: cand.id,
		confidence,
		reason: result.reason || 'ai_continuation'
	};
}

/**
 * Universal resolver: gather candidate containers (customer's own first, then the company's
 * recent open containers) and ask the AI for a continuation. Works for inbound AND outbound
 * messages on every channel. Does NOT write anything.
 */
export async function resolveContextContainer(
	input: ThreadResolverInput,
	opts?: { ai?: (user: string, system: string) => Promise<any | null> }
): Promise<ResolverResult> {
	const excludeCommIds = input.excludeCommIds || [];
	const ownCandidates = await openContainerCandidatesFor({
		companyId: input.companyId,
		contactId: input.contactId,
		customerProfileId: input.customerProfileId,
		phone: input.phone,
		email: input.email,
		excludeCommIds
	});

	// ALWAYS also include the company's recent open conversations (not only as a fallback): the
	// customer's reply may continue a conversation started on ANOTHER channel/identity (we emailed
	// studioblopp@…, they text back from a phone we've never linked). Merge + dedupe by id so those
	// cross-channel containers are offered to the matcher too, capped at MAX_CANDIDATES.
	const companyCandidates = await companyOpenCandidatesFor(input.companyId, {
		excludeCommIds,
		windowDays: input.windowDays
	});
	const seen = new Set<string>();
	let candidates: ContainerCandidate[] = [];
	for (const c of [...ownCandidates, ...companyCandidates]) {
		if (seen.has(c.id)) continue;
		seen.add(c.id);
		candidates.push(c);
	}

	// Drop the container the pipeline pre-created for THIS message. Left in, the matcher sees its
	// own text quoted back and links the message to itself ("exact match to the snippet"),
	// stranding the real earlier conversation on another id. excludeCommIds only helps when the
	// caller already knows that container's id, which the SMS/voice paths do not.
	//
	// Both conditions are required. Time alone is not enough: a comm log's `created` is when the
	// ROW was written — for a voicemail that is the start of the call, which can predate a
	// container opened while the caller was still talking. Filtering on time alone therefore threw
	// away legitimate earlier conversations. A self-container is specifically one opened after the
	// message AND whose content is this same message echoed back.
	const selfEchoed = normalizeForEcho(input.content || '');
	if (input.occurredAt && selfEchoed.length >= 12) {
		const cutoff = input.occurredAt.getTime();
		candidates = candidates.filter((c) => {
			const openedAfter = new Date(c.openedAt).getTime() >= cutoff;
			if (!openedAfter) return true;
			return !normalizeForEcho(c.snippet).includes(selfEchoed);
		});
	}

	candidates = candidates.slice(0, MAX_CANDIDATES);

	if (candidates.length === 0) {
		return { matched: false, candidates, reason: 'no_open_candidates' };
	}

	const match = await matchContinuationToCandidates(
		{
			channel: input.channel,
			direction: input.direction,
			subject: input.subject,
			content: input.content
		},
		candidates,
		opts
	);

	if (!match.matched || !match.commId) {
		return { matched: false, candidates, reason: match.reason };
	}

	// --- Cross-customer guard ---------------------------------------------------
	// The company-wide fallback offers EVERY open container to the AI, regardless of
	// owner. The AI judges topic similarity, not identity — two customers asking
	// about HVAC in the same fortnight will look like continuations. Sharing a COM id
	// asserts "same person", so reject matches where the container demonstrably
	// belongs to a different customer.
	const callerContact = input.callerContactId || input.contactId;
	const callerProfile = input.callerCustomerProfileId || input.customerProfileId;
	if (callerContact || callerProfile) {
		const matchedContainer = await prisma.commContainer.findUnique({
			where: { id: match.commId },
			select: { contactId: true, customerProfileId: true }
		});
		if (matchedContainer) {
			const contactMismatch =
				!!matchedContainer.contactId &&
				!!callerContact &&
				matchedContainer.contactId !== callerContact;
			const profileMismatch =
				!matchedContainer.contactId &&
				!!matchedContainer.customerProfileId &&
				!!callerProfile &&
				matchedContainer.customerProfileId !== callerProfile;

			if (contactMismatch || profileMismatch) {
				return {
					matched: false,
					candidates,
					reason: 'cross_customer_blocked'
				};
			}
		}
	}

	return {
		matched: true,
		commId: match.commId,
		candidate: candidates.find((c) => c.id === match.commId),
		reason: match.reason,
		confidence: match.confidence,
		candidates
	};
}

/**
 * Append an entry to an existing container and refresh its activity. A closed container is
 * reopened (the customer is responding again). Returns the created entry.
 */
export async function appendEntryToContainer(
	tx: any,
	input: {
		commId: string;
		direction: EntryDirection;
		channel: EntryChannel;
		fromParty: string;
		toParty: string;
		fromPartyType?: PartyType;
		toPartyType?: PartyType;
		transcript?: string | null;
		analysisJson?: any;
		occurredAt?: Date;
	}
) {
	const db = tx || prisma;
	const now = input.occurredAt || new Date();

	const entry = await createEntry(db, {
		commId: input.commId,
		direction: input.direction,
		channel: input.channel,
		fromParty: input.fromParty,
		toParty: input.toParty,
		fromPartyType: input.fromPartyType || 'customer',
		toPartyType: input.toPartyType || 'system',
		transcript: input.transcript || null,
		analysisJson: input.analysisJson || undefined,
		occurredAt: now
	});

	const container = await db.commContainer.findUnique({ where: { id: input.commId } });
	if (container) {
		await db.commContainer.update({
			where: { id: input.commId },
			data: {
				lastActivityAt: now,
				...(container.state === 'closed' ? { state: 'open' } : {})
			}
		});
	}

	return entry;
}

/**
 * Point a legacy CommunicationLog at a CommContainer so every row of the conversation shares the
 * container's commRef as its displayed COM id. Also bridges the legacy thread table so other
 * consumers keyed on communicationThreadId keep working (same pattern the booking flows use).
 */
export async function linkCommunicationLogToContainer(
	logId: string,
	container: { id: string; commRef: string },
	reason: string,
	opts?: { tx?: any; contactId?: string | null; companyId?: string }
) {
	const db = opts?.tx || prisma;
	const existing = await db.communicationLog.findUnique({ where: { id: logId } });
	if (!existing) return null;

	const meta = (existing.metadata as Record<string, any>) || {};
	const previousThreadId = existing.communicationThreadId || meta.commId || null;
	const companyId = opts?.companyId || existing.companyId;

	// Bridge the legacy thread so the comm-log UI (hashed thread id) and any thread-keyed
	// consumers see the container's id as the conversation anchor.
	if (companyId) {
		await db.communicationThread.upsert({
			where: { id: container.id },
			create: {
				id: container.id,
				companyId,
				contactId: opts?.contactId ?? existing.customerId ?? null,
				status: 'open',
				summary: meta.summary || existing.summary || 'Linked via container'
			},
			update: {}
		});
	}

	return db.communicationLog.update({
		where: { id: logId },
		data: {
			communicationThreadId: container.id,
			metadata: {
				...meta,
				commContainerId: container.id,
				commRef: container.commRef,
				thread_merge: {
					previousThreadId,
					mergedInto: container.id,
					mergedIntoRef: container.commRef,
					reason,
					mergedAt: new Date().toISOString()
				}
			}
		}
	});
}

/**
 * Universal "every message goes through it" entry point for every low-level handler that wrote a
 * CommunicationLog but does NOT run the orchestrator (legacy SMS endpoint, notification replies,
 * ad-hoc Brevo email sends, dial records). It loads the log, runs the same context checker used
 * by the orchestrator (identity candidates first, company-wide recent-open fallback, both
 * directions, every channel), and when a continuation is found it appends the entry to the
 * container, re-links the log to the container, and stamps the shared COM id (+ thread_merge
 * metadata) so voice/SMS/email rows for the same conversation show ONE comm id. Best effort:
 * never throws, and a no-match leaves the message on its own thread.
 */
export async function resolveAndLinkContext(
	logId: string,
	opts?: {
		ai?: (user: string, system: string) => Promise<any | null>;
		excludeCommIds?: string[];
		windowDays?: number;
	}
): Promise<{ resolved: boolean; containerId?: string; commRef?: string; reason?: string }> {
	try {
		const log = await prisma.communicationLog.findUnique({ where: { id: logId } });
		if (!log) return { resolved: false, reason: 'log_not_found' };

		const meta = (log.metadata as Record<string, any>) || {};
		// Already anchored to a container (booking/support flows create one during the run) — nothing
		// to merge here. A legacy hashed thread id is NOT a container, so we still try to match it.
		if (meta.commContainerId === log.communicationThreadId && log.communicationThreadId) {
			return { resolved: false, reason: 'already_linked' };
		}

		const outbound = log.direction === 'outbound';
		const party = (outbound ? log.destination : log.source) || ''; // the customer side
		const isEmail = /@/.test(party);
		const channel: EntryChannel =
			log.type === 'sms'
				? 'sms'
				: log.type === 'email'
					? 'email'
					: log.type === 'leadform' || log.type === 'leadbox'
						? 'form'
						: 'voice';

		const resolution = await resolveContextContainer(
			{
				companyId: log.companyId,
				contactId: log.customerId || null,
				customerProfileId: null,
				phone: isEmail ? null : party || null,
				email: isEmail ? party || null : null,
				channel,
				direction: log.direction,
				subject: meta.subject || log.summary || null,
				content: (log.content || log.summary || '').slice(0, 4000),
				excludeCommIds: [
					...(opts?.excludeCommIds || []),
					...(log.communicationThreadId ? [log.communicationThreadId] : []),
					...(meta.commId ? [meta.commId] : []),
					...(meta.commContainerId ? [meta.commContainerId] : [])
				],
				windowDays: opts?.windowDays,
				// Cross-customer guard: pass the caller's identity so the resolver can
				// reject matches to containers owned by a different customer.
				callerContactId: log.customerId || null,
				callerCustomerProfileId: meta.customerProfileId || null
			},
			opts?.ai ? { ai: opts.ai } : {}
		);

		if (!resolution.matched || !resolution.commId || !resolution.candidate) {
			return { resolved: false, reason: resolution.reason || 'no_match' };
		}

		await appendEntryToContainer(prisma, {
			commId: resolution.commId,
			direction: log.direction,
			channel,
			fromParty: outbound ? log.source || 'unknown' : party || 'unknown',
			toParty: outbound ? party || 'unknown' : log.destination || 'unknown',
			fromPartyType: outbound ? 'rep' : 'customer',
			toPartyType: outbound ? 'customer' : 'system',
			transcript: log.content || log.summary || '',
			occurredAt: log.created
		});

		await linkCommunicationLogToContainer(
			logId,
			{ id: resolution.commId, commRef: resolution.candidate.commRef },
			resolution.reason || 'context_continuation',
			{ companyId: log.companyId, contactId: log.customerId || null }
		);

		return {
			resolved: true,
			containerId: resolution.commId,
			commRef: resolution.candidate.commRef
		};
	} catch (e) {
		console.error(`[thread-resolver] resolveAndContinueContext failed for ${logId}:`, e);
		return { resolved: false, reason: 'error' };
	}
}
