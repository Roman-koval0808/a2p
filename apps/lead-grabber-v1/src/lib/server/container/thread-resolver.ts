// Cross-channel thread resolution: decide whether a new communication (phone call, SMS, email)
// is a continuation of an EXISTING open CommContainer (e.g. an outbound email the company sent
// that is waiting for a reply) so the new entry is appended to that container's conversation
// instead of starting a brand-new one.
//
// Rules (mirror the anti-hallucination policy used everywhere else in the pipeline):
//  - Candidate containers are scoped to the company AND the resolved customer identity
//    (contact id + PipelineCustomerProfile/comm_identifiers for phone and email).
//  - Only the AI decides whether the content is a continuation. When in doubt it MUST NOT
//    link — a fresh thread is safer than a wrong merge.

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
	candidates: ContainerCandidate[];
}

const MAX_CANDIDATES = 15;
const MIN_CONFIDENCE = 0.6;

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

Open conversation containers for this customer:
${listText}`;

	const system = `You are the continuation matcher of a business communications platform. A new message just arrived from a customer, and the platform has an open conversation container per customer per topic (a container has a commRef, a thread type, a subject and a snippet of its recent content).

Decide whether this new message CONTINUES one of the listed open containers — i.e. the customer is clearly responding to that conversation's specific topic (answering a question the company asked, confirming/rescheduling an appointment that was proposed, following up on a pending request, continuing the same issue).

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
 * High-level resolver: gather open candidates for the identity, ask the AI for a continuation,
 * and return the target container when a match is found. Does NOT write anything.
 */
export async function resolveContinuationForComm(
	input: ThreadResolverInput,
	opts?: { ai?: (user: string, system: string) => Promise<any | null> }
): Promise<ResolverResult> {
	const candidates = await openContainerCandidatesFor(input);
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

	return {
		matched: true,
		commId: match.commId,
		candidate: candidates.find((c) => c.id === match.commId),
		reason: match.reason,
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
