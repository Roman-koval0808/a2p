// Deterministic telemetry intake for the lead-grabber pipeline.
//
// Receives a batch of signals from the browser tracker, resolves/creates the
// PipelineCustomerProfile, and persists each signal as a PipelineEvent + PipelineSignal.
// No AI is invoked anywhere in this path — signals are strictly deterministic by design.

import { prisma } from '$lib/db';
import { randomUUID } from 'crypto';
import { toE164 } from '$lib/utils/phone';
import { SIGNAL_CATALOG, humanizeSignal, type TelemetrySignal } from '$lib/telemetry/signals';
import type { Attribution } from '$lib/telemetry/attribution';
import { recordMergeCandidate } from '$lib/server/identity/merge-service';
import { getNextBucket } from '$lib/server/profiledb/scoring.service';
import {
	resolveEngagementThread,
	resolveBatchSubtopic,
	subtopicForSignal,
	UNKNOWN_SUBTOPIC,
	deriveIntentStatus,
	isPaidAdChannel,
	accumulateSubtopicScores,
	rollupScore,
	capTotal,
	ENGAGEMENT_RULES_VERSION
} from './engagement';

// ── Comm-log visibility ─────────────────────────────────────────────────────
// Which signals surface as a communication-log row (the a2p comm log / sales inbox).
//   'all'         — every signal becomes a row (full audit trail)
//   'high_intent' — only scoreDelta >= COMM_LOG_MIN_DELTA or an explicit
//                   call/emergency/lead-form/review category
//   'off'         — no comm-log rows (signals still score the profile)
//
// Flip this when you no longer want the noise: set TELEMETRY_COMM_LOG_MODE in env,
// or change the fallback below. Low-intent rows are written with `notify: false`, so
// even in 'all' mode they never trigger an email/notification — only the high-intent
// ones do.
const COMM_LOG_MODE: 'all' | 'high_intent' | 'off' =
	(process.env.TELEMETRY_COMM_LOG_MODE as 'all' | 'high_intent' | 'off') || 'all';
const COMM_LOG_MIN_DELTA = 15;

// ── Visit boundary ──────────────────────────────────────────────────────────
// A visit is ONE BROWSER TAB. Every ClearSky emitter (site tracker, leadbox, leadform, viewroom)
// resolves its `sessionId` from the same sessionStorage key, so they agree within a page and the
// id survives navigation and reload — but sessionStorage dies with the tab, so closing and
// reopening starts a new session and therefore a new comm-log row.
//
// The inactivity gap below is only a FALLBACK, for batches that arrive with no session id at all
// (a cached pre-sessionStorage script, or storage blocked in private mode). Without it those
// batches would all collapse into one endless row again.
const VISIT_GAP_MINUTES = Number(process.env.TELEMETRY_VISIT_GAP_MINUTES) || 30;
const COMM_LOG_CATEGORIES = new Set(['call_emergency', 'lead_form', 'reviews', 'viewroom']);

function isHighIntent(ev: { category: string; delta: number }): boolean {
	return COMM_LOG_CATEGORIES.has(ev.category) || ev.delta >= COMM_LOG_MIN_DELTA;
}

function shouldLogBatch(eventIds: { category: string; delta: number }[]): boolean {
	if (COMM_LOG_MODE === 'off') return false;
	if (COMM_LOG_MODE === 'all') return true;
	return eventIds.some((ev) => isHighIntent(ev));
}

// Prisma's interactive transactions default to a 5s limit. That is not enough here: the database
// is ~150ms away, each transaction runs six or more statements, and a batch may also wait on the
// pool and on the per-visitor advisory lock. Exceeding it aborts the transaction, and because the
// comm-log write is deliberately non-fatal the signal then vanishes from the comm log while
// staying in pipeline_events — the exact "signal went missing" symptom, but intermittent.
const TX_OPTS = { timeout: 20_000, maxWait: 15_000 };

export interface SignalBatch {
	tenantSlug?: string | null;
	companyId?: string | null;
	sessionId?: string | null;
	fingerprintId?: string | null;
	name?: string | null;
	email?: string | null;
	phone?: string | null;
	attribution?: Attribution | null;
	signals: TelemetrySignal[];
}

function normalizeEmail(email: string | null | undefined): string | null {
	const v = email?.trim().toLowerCase();
	return v || null;
}

async function resolveCompany(tenantSlug?: string | null, companyId?: string | null) {
	const candidate = companyId || tenantSlug;
	if (!candidate) return null;
	return prisma.company.findFirst({
		where: { OR: [{ id: candidate }, { emailSlug: candidate }] },
		select: { id: true, name: true }
	});
}

/**
 * Follow a merge tombstone to the record that survived. Merging is point-and-retire, never
 * delete, so a retired id stays resolvable — a lookup that lands on one must not return the
 * tombstone as if it were live.
 */
async function followMerges(db: any, profile: any) {
	let current = profile;
	for (let hops = 0; current?.mergedInto && hops < 10; hops++) {
		current = await db.pipelineCustomerProfile.findUnique({ where: { id: current.mergedInto } });
	}
	return current;
}

/**
 * Resolve the visitor to ONE profile, layering whatever identity this batch carries onto it.
 *
 * The rule this implements is identity-tiers §4.3: fingerprint + session are the identity thread
 * for the real-individual tiers, and they are never discarded on upgrade — a 2B/2 record
 * promoting to Tier 1 keeps its fingerprint and history, and the identifier is layered on top.
 * Previously this returned the fingerprint's profile but wrote only `displayName` onto it, so a
 * visitor who submitted a form stayed unreachable by phone, and the next phone-keyed touch forked
 * a second profile for the same person.
 *
 * Returns the profile plus, when two live records look like one person, an unresolved `conflict`
 * for the caller to raise as a merge candidate.
 */
async function resolveProfile(
	db: any,
	companyId: string,
	input: { fingerprintId?: string | null; name?: string | null; email?: string | null; phone?: string | null }
): Promise<{ profile: any; conflict?: { survivorId: string; duplicateId: string } }> {
	const email = normalizeEmail(input.email);
	const phone = input.phone ? toE164(input.phone) : null;
	const fingerprintId = input.fingerprintId?.trim() || null;
	const name = input.name?.trim() || null;

	// An exclusive identifier outranks the device: phone first, then email.
	let identified = null;
	if (phone) {
		identified = await followMerges(
			db,
			await db.pipelineCustomerProfile.findUnique({
				where: { companyId_phoneNumber: { companyId, phoneNumber: phone } }
			})
		);
	}
	if (!identified && email) {
		identified = await followMerges(
			db,
			await db.pipelineCustomerProfile.findUnique({
				where: { companyId_email: { companyId, email } }
			})
		);
	}

	// The device thread. `mergedInto: null` belongs in the WHERE, not an `if` above it, so a
	// retired tombstone can never surface as a live match.
	const byFingerprint = fingerprintId
		? await db.pipelineCustomerProfile.findFirst({
				where: { companyId, externalId: fingerprintId, mergedInto: null }
			})
		: null;

	if (identified) {
		const updates: Record<string, unknown> = {};
		// Fill blanks only. A profile has one canonical name/phone/email; overwriting a known
		// value with a newer form submission is how one person's record absorbs another's.
		if (name && !identified.displayName) updates.displayName = name;
		if (phone && !identified.phoneNumber) updates.phoneNumber = phone;
		if (email && !identified.email) updates.email = email;
		// Carry the device thread onto the identified record when it has none, so the visitor's
		// next anonymous batch lands here instead of starting a fresh anonymous profile.
		if (fingerprintId && !identified.externalId && (!byFingerprint || byFingerprint.id === identified.id)) {
			updates.externalId = fingerprintId;
		}
		const profile = Object.keys(updates).length
			? await db.pipelineCustomerProfile.update({ where: { id: identified.id }, data: updates })
			: identified;

		// Two live records that look like one person. Do NOT fuse them here: a device can be
		// shared, and merge-service is explicit that identity resolution raises candidates for a
		// human rather than auto-merging, because a bad merge silently fuses two customers'
		// histories. Return the record the exclusive identifier points at and flag the pair.
		const conflict =
			byFingerprint && byFingerprint.id !== profile.id
				? { survivorId: profile.id, duplicateId: byFingerprint.id }
				: undefined;
		return { profile, conflict };
	}

	if (byFingerprint) {
		// Promotion in place. The lookups above found no profile holding this phone/email — but
		// "found none" was true when we read, not necessarily when we write. See claimOrReread.
		const updates: Record<string, unknown> = {};
		if (name && !byFingerprint.displayName) updates.displayName = name;
		if (phone && !byFingerprint.phoneNumber) updates.phoneNumber = phone;
		if (email && !byFingerprint.email) updates.email = email;
		const profile = Object.keys(updates).length
			? await db.pipelineCustomerProfile.update({ where: { id: byFingerprint.id }, data: updates })
			: byFingerprint;
		return { profile };
	}

	const attrs: Record<string, unknown> = { engagementScore: 0 };
	if (fingerprintId) attrs.fingerprintId = fingerprintId;

	return {
		profile: await db.pipelineCustomerProfile.create({
			data: {
				companyId,
				externalId: fingerprintId,
				displayName: name,
				email,
				phoneNumber: phone,
				attributes: attrs as any,
				status: 'unknown'
			}
		})
	};
}


export async function ingestSignalBatch(batch: SignalBatch): Promise<{ status: number; body: any }> {
	const { signals, attribution } = batch;

	if (!Array.isArray(signals) || signals.length === 0) {
		return { status: 400, body: { error: 'signals must be a non-empty array.' } };
	}

	const company = await resolveCompany(batch.tenantSlug, batch.companyId);
	if (!company) {
		return { status: 400, body: { error: 'tenantSlug/companyId did not resolve to a company.' } };
	}

	const accepted: string[] = [];
	const rejected: string[] = [];
	let scoreDelta = 0;

	const eventIds: {
		id: string;
		name: string;
		category: string;
		delta: number;
		bucketSignal?: string;
		payload?: Record<string, unknown> | null;
		/** Resolved once here, then reused for the interaction row AND the score rollup. */
		subtopic?: string | null;
	}[] = [];

	for (const sig of signals) {
		const def = SIGNAL_CATALOG[sig.name];
		if (!def) {
			rejected.push(sig.name);
			continue;
		}
		const id = randomUUID();
		eventIds.push({
			id,
			name: def.name,
			category: def.category,
			delta: def.scoreDelta,
			bucketSignal: def.bucketSignal,
			payload: sig.payload ?? null,
			// Attributed from THIS signal's own page/payload, falling back to the session's landing
			// page. Null means no identifiable subject — recorded as UNKNOWN_SUBTOPIC downstream.
			subtopic: subtopicForSignal(
				{ name: def.name, payload: sig.payload ?? null },
				batch.attribution?.landingUrl
			)
		});
		scoreDelta += def.scoreDelta;
		accepted.push(def.name);
	}

	if (eventIds.length === 0) {
		return { status: 200, body: { success: true, accepted: [], rejected, eventCount: 0 } };
	}

	// Resolve the profile and persist events in ONE transaction so the profile the events
	// reference is always committed by the same connection that creates them.
	// Retry the whole transaction once if another batch claimed this phone/email first.
	//
	// `(companyId, phoneNumber)` and `(companyId, email)` are unique, and resolveProfile decides
	// "nobody holds this" by READING. Two batches for one person arriving together — a page view
	// under a web fingerprint and a leadbox submit under `leadbox-<phone>` — both read "nobody" and
	// both write; the loser's P2002 aborted its transaction and the intake returned a 500, losing
	// those signals outright.
	//
	// This must be a retry of the TRANSACTION, not a catch inside it: Postgres aborts a transaction
	// on the first failed statement, so recovering in place is impossible — the re-read fails too.
	// On the second attempt the winner is committed, so the lookups find it and take the
	// `identified` path instead.
	const runIngest = () => prisma.$transaction(async (tx: any) => {
		const { profile, conflict } = await resolveProfile(tx, company.id, {
			fingerprintId: batch.fingerprintId,
			name: batch.name,
			email: batch.email,
			phone: batch.phone
		});

		const attrs = (profile.attributes as Record<string, unknown>) || {};
		const currentScore = typeof attrs.engagementScore === 'number' ? attrs.engagementScore : 0;
		const newScore = Math.min(100, currentScore + scoreDelta);

		const now = new Date();
		for (const ev of eventIds) {
			await tx.pipelineEvent.create({
				data: {
					id: ev.id,
					eventId: `evt_${randomUUID()}`,
					provider: 'clearsky_pixel',
					providerEventName: ev.name,
					eventType: ev.name,
					// The subject this interaction was about, resolved from its own page/payload.
					// Null = nothing identified a subject; scored separately as `unknown`.
					subtopic: ev.subtopic ?? null,
					networkCategory: ev.category === 'viewroom' ? 'Viewroom' : 'Web',
					companyId: company.id,
					customerProfileId: profile.id,
					occurredAt: now,
					receivedAt: now,
					unstructuredText: JSON.stringify({
						signal: ev.name,
						category: ev.category,
						scoreDelta: ev.delta,
						sessionId: batch.sessionId,
						fingerprintId: batch.fingerprintId,
						attribution
					}),
					payload: (ev.payload ?? undefined) as any,
					requiresAiExtraction: false,
					aiExtractionCompleted: false,
					processingStatus: 'received',
					handoffEligible: false
				}
			});

			await tx.pipelineSignal.create({
				data: {
					eventId: ev.id,
					name: ev.name,
					bucket: ev.category,
					priority: 2,
					confidence: 1.0,
					status: 'candidate'
				}
			});
		}

		if (scoreDelta !== 0) {
			await tx.pipelineCustomerProfile.update({
				where: { id: profile.id },
				data: { attributes: { ...attrs, engagementScore: newScore } as any }
			});
		}

		return { profileId: profile.id, newEngagementScore: newScore, mergeConflict: conflict };
	}, TX_OPTS);

	const isIdentityClash = (err: any) =>
		err?.code === 'P2002' &&
		/phoneNumber|email/.test(String(err?.meta?.target ?? ''));

	let ingested;
	try {
		ingested = await runIngest();
	} catch (err: any) {
		if (!isIdentityClash(err)) throw err;
		console.warn('[telemetry] identity claimed concurrently — retrying the batch once');
		ingested = await runIngest();
	}
	const { profileId, newEngagementScore, mergeConflict } = ingested;

	// Raised after the transaction commits: candidate bookkeeping uses its own connection and
	// must never extend or fail the ingest transaction that noticed the pair.
	if (mergeConflict) {
		await recordMergeCandidate({
			companyId: company.id,
			primaryProfileId: mergeConflict.survivorId,
			duplicateProfileId: mergeConflict.duplicateId,
			reason: 'Telemetry: device fingerprint matches a different profile than the submitted phone/email'
		});
	}

	// The contact is resolved here, NOT inside upsertSessionCommLog, because the engagement score
	// must not depend on how chatty the comm log is configured to be — COMM_LOG_MODE 'off' means
	// "no comm-log rows", it has never meant "stop scoring".
	const contact = await resolveContact(company.id, batch);

	// The profiles page reads Contact.engagementScore; the pipeline profile's score lives in
	// PipelineCustomerProfile.attributes and nothing ever copied it across, so a visitor whose
	// score came entirely from telemetry showed 0/100 no matter how many signals they fired.
	if (contact && scoreDelta !== 0) {
		await applyContactScore(contact.id, scoreDelta);
	}

	// Intent bucket. Promotion is ESCALATE-ONLY and driven by the signal's own bucketSignal, never
	// recomputed from a score band (developer brief P1.3 / Four Intent Buckets §4.1 no-downgrade).
	// Folding from 'unclassified' gives the highest bucket THIS batch argues for; the stored value
	// is only overwritten when the new one ranks strictly higher, which is enforced in SQL below.
	if (contact) {
		const target = eventIds.reduce(
			(acc, ev) => getNextBucket(acc, ev.bucketSignal),
			'unclassified'
		);
		if (target !== 'unclassified') {
			await applyContactBucket(contact.id, target);
		}
	}

	const shouldLog = shouldLogBatch(eventIds);
	if (shouldLog) {
		await upsertSessionCommLog(company, profileId, batch, eventIds, newEngagementScore, contact).catch(
			(err: any) => console.error('[telemetry] comm log write failed:', err?.message || err)
		);
	}

	return {
		status: 200,
		body: {
			success: true,
			accepted,
			rejected,
			eventCount: eventIds.length,
			profileId,
			scoreDelta,
			engagementScore: newEngagementScore
		}
	};
}

/**
 * Resolve the visitor's Contact. The contact util matches by phone → email → fingerprint
 * (metadata.fingerprints) and records the fingerprint on the contact itself, so a returning device
 * lands on the SAME contact even when no name/email/phone is known yet.
 */
async function resolveContact(companyId: string, batch: SignalBatch) {
	const name = batch.name?.trim() || null;
	const email = batch.email?.trim() || null;
	const phone = batch.phone?.trim() || null;
	const fingerprint = batch.fingerprintId?.trim() || null;
	if (!name && !email && !phone && !fingerprint) return null;

	const { createOrUpdateContact } = await import('$lib/utils/contacts');
	return createOrUpdateContact({
		company_id: companyId,
		name: name || undefined,
		email: email || undefined,
		phone: phone || undefined,
		fingerprint: fingerprint || undefined
	}).catch((err: any) => {
		console.error('[telemetry] contact resolution failed:', err?.message || err);
		return null;
	});
}

/**
 * Add this batch's delta to the contact's engagement score, capped at the 100 the UI renders it
 * against. Done in SQL rather than read-modify-write so two batches landing together both count —
 * the same lost-update trap that silently dropped signals from the comm log.
 */
async function applyContactScore(contactId: string, delta: number) {
	try {
		await prisma.$executeRaw`
			UPDATE contacts
			SET "engagementScore" = LEAST(100, GREATEST(0, COALESCE("engagementScore", 0) + ${delta}))
			WHERE id = ${contactId}`;
	} catch (err: any) {
		console.error('[telemetry] contact score update failed:', err?.message || err);
	}
}

/**
 * Persist the visitor's intent bucket, escalate-only.
 *
 * The ladder comparison is done in SQL so two batches landing together cannot demote each other:
 * the row is written only when the incoming bucket ranks strictly higher than the stored one. The
 * array mirrors BUCKET_ORDER in scoring.service — keep them in step.
 */
async function applyContactBucket(contactId: string, bucket: string) {
	try {
		await prisma.$executeRaw`
			UPDATE contacts
			SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{intentBucket}', to_jsonb(${bucket}::text), true)
			WHERE id = ${contactId}
			  AND COALESCE(
			        array_position(
			          ARRAY['unclassified','research','comparison','active','emergency'],
			          NULLIF(metadata->>'intentBucket', '')
			        ), 0)
			      < array_position(
			          ARRAY['unclassified','research','comparison','active','emergency'],
			          ${bucket}::text
			        )`;
	} catch (err: any) {
		console.error('[telemetry] contact bucket update failed:', err?.message || err);
	}
}

// One CommunicationThread per ENGAGEMENT (a business episode — spans visits and months), and one
// CommunicationLog row per SESSION (a visit/call) inside it. Thread selection is evidence-before-time
// (see resolveEngagementThread); the 30-minute visit gap only decides the SESSION boundary below.
async function upsertSessionCommLog(
	company: { id: string; name: string | null },
	profileId: string,
	batch: SignalBatch,
	eventIds: {
		name: string;
		category: string;
		delta: number;
		payload?: Record<string, unknown> | null;
		subtopic?: string | null;
	}[],
	engagementScore: number,
	contact: { id: string } | null
) {
	const { createNotification } = await import('$lib/utils/notifications');

	const name = batch.name?.trim() || null;
	const email = batch.email?.trim() || null;
	const phone = batch.phone?.trim() || null;
	const fingerprint = batch.fingerprintId?.trim() || null;
	const sessionId = batch.sessionId?.trim() || null;

	// Identifies the person across page loads and visits. For an anonymous visitor the fingerprint
	// is the identity thread; once a contact exists, thread resolution goes by contact.
	const visitorKey = fingerprint || sessionId;
	if (!visitorKey) return;

	const latest = eventIds[eventIds.length - 1];
	const type = latest.category === 'viewroom' ? 'viewroom' : 'web';
	const summary = humanizeSignal(latest.name);
	// The fingerprint is a last-resort source for a brand-new row (so an anonymous visitor is
	// still visible as "a24c60d6c9c2"), but it must NEVER overwrite a name on an existing row —
	// anonymous website batches would otherwise clobber the name the visitor gave in the viewroom.
	const source = name || email || phone || fingerprint || undefined;

	// The type of business for THIS session, from the landing URL and any service/problem payloads.
	const subtopic = resolveBatchSubtopic({
		landingUrl: batch.attribution?.landingUrl,
		signals: eventIds.map((e) => ({ name: e.name, payload: e.payload }))
	});

	// Source-aware intent status (Bug A): `ad_indicated` only for a real paid-ad click.
	const intentStatus = deriveIntentStatus({
		direction: 'inbound',
		declaredIdentifier: Boolean(name || email || phone),
		isPaidAd: isPaidAdChannel(batch.attribution?.channel),
		hasBehaviour: eventIds.some((e) => e.name !== 'page_load')
	});

	// The row's `metadata.signals` and the thread's `subtopicScores` are read-modify-writes, so two
	// batches for the SAME visitor arriving together would both read the pre-existing value and the
	// second write would clobber the first (the 2026-08-20 comm-log lost-update). The advisory lock
	// serialises per visitor, and thread choice happens inside it, so the read-modify-write is safe.
	const { logId, content, shouldNotify, threadId, sessionRef } = await prisma.$transaction(
		async (tx: any) => {
			// The lock must cover the same rows the lookup below reads, or it protects nothing.
			//
			// It used to be keyed on `visitorKey` (the fingerprint) while the lookup keys on the
			// CONTACT. One person arrives under several visitor keys — a web fingerprint for
			// browsing, `leadbox-+1555…` for a widget submit — so those batches took DIFFERENT
			// locks, ran concurrently, both saw no open thread for that contact, and both opened
			// one. That is how a single visitor ended up with two engagement ids in the same
			// minute, one of them sharing a session id with the other.
			//
			// Keyed on the contact, every batch that resolves to the same person serialises no
			// matter which key it arrived under. Anonymous visitors still fall back to the visitor
			// key, which is the only identity they have.
			const lockKey = contact
				? `eng_${company.id}_contact_${contact.id}`
				: `eng_${company.id}_${visitorKey}`;
			await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

			// Resolve the engagement thread: contact's open thread first, else most-recent within
			// window, else a fresh episode. Anonymous visitors resolve by their vt_ id prefix.
			const threadWhere = contact
				? { companyId: company.id, contactId: contact.id }
				: { companyId: company.id, id: { startsWith: `vt_${visitorKey}` } };

			const openThread = await tx.communicationThread.findFirst({
				where: { ...threadWhere, status: { not: 'closed' } },
				orderBy: { updated: 'desc' }
			});
			const recentThread = await tx.communicationThread.findFirst({
				where: threadWhere,
				orderBy: { updated: 'desc' }
			});

			const toOpen = (t: any) =>
				t
					? {
							id: t.id,
							status: t.status,
							subtopics: Array.isArray(t.subtopics) ? t.subtopics : [],
							updated: new Date(t.updated)
						}
					: null;

			// Rule #1 (explicit engagement/project/quote/case/work-order ref) is not wired here: the
			// web SignalBatch carries no such field. When explicit refs arrive (project/quote/case
			// records), pass them into resolveEngagementThread and they'll take priority.
			const decision = resolveEngagementThread({
				openThread: toOpen(openThread),
				recentThread: toOpen(recentThread)
			});

			let threadId: string;
			let threadIsNew = false;
			if (decision.decision === 'new' || !decision.threadId) {
				// New engagement (or an explicit ref that resolved to no thread yet — safe to fall
				// through to a fresh episode rather than feed `undefined` into the next writes).
				threadId = `vt_${visitorKey}_${Date.now().toString(36)}${Math.random()
					.toString(36)
					.slice(2, 6)}`;
				threadIsNew = true;
			} else {
				threadId = decision.threadId;
			}

			// The session boundary: a browser tab (sessionId) is a session; without one, a gap in
			// activity starts a new session. The 30-minute logic moved down from thread to log row.
			let sessionRef: string;
			let existing: any = null;
			if (sessionId) {
				sessionRef = `SES-WEB-${sessionId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase()}`;
				existing = await tx.communicationLog.findFirst({
					where: { companyId: company.id, communicationThreadId: threadId, sessionRef },
					orderBy: { updated: 'desc' }
				});
			} else {
				const previous = await tx.communicationLog.findFirst({
					where: { companyId: company.id, communicationThreadId: threadId },
					orderBy: { updated: 'desc' }
				});
				const lastSeen = previous?.updated?.getTime() ?? 0;
				const sameVisit = !!previous && Date.now() - lastSeen <= VISIT_GAP_MINUTES * 60_000;
				sessionRef = sameVisit
					? previous.sessionRef
					: `SES-WEB-${Date.now().toString(36).toUpperCase()}`;
				existing = sameVisit ? previous : null;
			}

			// Per-signal subtopic deltas, using the subtopic each event already resolved. A signal
			// with no identifiable subject is recorded separately under UNKNOWN_SUBTOPIC.
			const deltasBySubtopic: Record<string, number> = {};
			for (const ev of eventIds) {
				const st = ev.subtopic ?? UNKNOWN_SUBTOPIC;
				deltasBySubtopic[st] = (deltasBySubtopic[st] ?? 0) + ev.delta;
			}

			// Read the thread's current rollup state, then fold this batch in.
			const currentThread = threadIsNew
				? null
				: await tx.communicationThread.findUnique({ where: { id: threadId } });
			const currentSubtopics: string[] = Array.isArray(currentThread?.subtopics)
				? currentThread.subtopics
				: [];
			const currentScores: Record<string, number> =
				currentThread?.subtopicScores && typeof currentThread.subtopicScores === 'object'
					? (currentThread.subtopicScores as Record<string, number>)
					: {};

			// Roll up EVERY subtopic this batch touched, not just the session-level one — a single
			// session can span subjects (kitchen pages then a bathroom quote), and the array has to
			// agree with the keys in subtopicScores. UNKNOWN is scored but never listed as a subject.
			const newSubtopics = [...currentSubtopics];
			for (const key of Object.keys(deltasBySubtopic)) {
				if (key !== UNKNOWN_SUBTOPIC && !newSubtopics.includes(key)) newSubtopics.push(key);
			}
			const newScores = accumulateSubtopicScores(currentScores, deltasBySubtopic);
			const newEngagementScore = capTotal(rollupScore(newScores));

			if (threadIsNew) {
				await tx.communicationThread.create({
					data: {
						id: threadId,
						companyId: company.id,
						contactId: contact?.id ?? null,
						status: 'open',
						summary,
						subtopics: newSubtopics,
						subtopicScores: newScores,
						engagementScore: newEngagementScore,
						assignReason: decision.reason,
						rulesVersion: decision.rulesVersion
					}
				});
			} else {
				await tx.communicationThread.update({
					where: { id: threadId },
					data: {
						summary,
						contactId: contact?.id ?? undefined,
						subtopics: newSubtopics,
						subtopicScores: newScores,
						engagementScore: newEngagementScore,
						assignReason: decision.reason,
						rulesVersion: decision.rulesVersion
					}
				});
			}

			const meta = (existing?.metadata as Record<string, any>) || {};
			const incomingSignals = eventIds.map((e) => e.name);

			// Append every signal — repeats from later visits must be visible, not deduped away (a
			// returning visitor's vr_entry/dwell would otherwise look like nothing was recorded).
			const signals = Array.isArray(meta.signals)
				? [...meta.signals, ...incomingSignals].slice(-80)
				: incomingSignals;
			const nextContent = `Signals: ${signals.map(humanizeSignal).join(' → ')} · Engagement score ${newEngagementScore}`;

			// Notify once per session, the first time a high-intent signal arrives.
			const notify = eventIds.some((ev) => isHighIntent(ev)) && !meta.notified;
			const nextMeta = {
				...meta,
				name: name ?? meta.name ?? null,
				latestSignal: latest.name,
				signals,
				scoreLive: newEngagementScore,
				source_signal: type,
				attribution: batch.attribution ?? meta.attribution,
				intentStatus,
				subtopic,
				notified: !!meta.notified || notify
			};

			let id: string;
			if (existing) {
				await tx.communicationLog.update({
					where: { id: existing.id },
					data: {
						summary,
						content: nextContent,
						source: source ?? existing.source,
						customerId: contact?.id ?? existing.customerId,
						subtopic: subtopic ?? existing.subtopic,
						metadata: nextMeta as any
					}
				});
				id = existing.id;
			} else {
				const created = await tx.communicationLog.create({
					data: {
						type,
						direction: 'inbound',
						status: 'success',
						source: source ?? null,
						destination: null,
						companyId: company.id,
						customerId: contact?.id ?? null,
						summary,
						content: nextContent,
						communicationThreadId: threadId,
						subtopic,
						sessionRef,
						metadata: { ...nextMeta, profileId } as any
					}
				});
				id = created.id;
			}

			return { logId: id, content: nextContent, shouldNotify: notify, threadId, sessionRef };
		},
		TX_OPTS
	);

	if (shouldNotify) {
		await createNotification({
			company_id: company.id,
			type: type as any,
			direction: 'inbound',
			source_name: name ?? fingerprint ?? undefined,
			source_identifier: fingerprint ?? undefined,
			message_preview: summary.slice(0, 120),
			content,
			communication_log_id: logId,
			thread_id: threadId
		} as any);
	}
}
