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
const COMM_LOG_CATEGORIES = new Set(['call_emergency', 'lead_form', 'reviews', 'viewroom']);

function isHighIntent(ev: { category: string; delta: number }): boolean {
	return COMM_LOG_CATEGORIES.has(ev.category) || ev.delta >= COMM_LOG_MIN_DELTA;
}

function shouldLogBatch(eventIds: { category: string; delta: number }[]): boolean {
	if (COMM_LOG_MODE === 'off') return false;
	if (COMM_LOG_MODE === 'all') return true;
	return eventIds.some((ev) => isHighIntent(ev));
}

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
		// Promotion in place. No profile holds this phone/email — the lookups above found none —
		// so claiming them here cannot violate the (companyId, phoneNumber)/(companyId, email)
		// uniques.
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

	const eventIds: { id: string; name: string; category: string; delta: number }[] = [];

	for (const sig of signals) {
		const def = SIGNAL_CATALOG[sig.name];
		if (!def) {
			rejected.push(sig.name);
			continue;
		}
		const id = randomUUID();
		eventIds.push({ id, name: def.name, category: def.category, delta: def.scoreDelta });
		scoreDelta += def.scoreDelta;
		accepted.push(def.name);
	}

	if (eventIds.length === 0) {
		return { status: 200, body: { success: true, accepted: [], rejected, eventCount: 0 } };
	}

	// Resolve the profile and persist events in ONE transaction so the profile the events
	// reference is always committed by the same connection that creates them.
	const { profileId, newEngagementScore, mergeConflict } = await prisma.$transaction(async (tx: any) => {
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
	});

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

// One comm-log row per visitor session. All of a visitor's signals fold into a single
// communication thread (so they share one COM id), the row's summary is the latest signal,
// and the source is the fingerprint (or the profile name once they're recognised).
async function upsertSessionCommLog(
	company: { id: string; name: string | null },
	profileId: string,
	batch: SignalBatch,
	eventIds: { name: string; category: string; delta: number }[],
	engagementScore: number,
	contact: { id: string } | null
) {
	const { createNotification } = await import('$lib/utils/notifications');

	const name = batch.name?.trim() || null;
	const email = batch.email?.trim() || null;
	const phone = batch.phone?.trim() || null;
	const fingerprint = batch.fingerprintId?.trim() || null;
	const sessionId = batch.sessionId?.trim() || null;

	// Stable grouping key: the fingerprint identifies the user across page loads; fall back to the
	// session id when a visitor has no fingerprint.
	const sessionKey = fingerprint || sessionId;
	if (!sessionKey) return;

	const threadId = `vt_${sessionKey}`;
	const latest = eventIds[eventIds.length - 1];
	const type = latest.category === 'viewroom' ? 'viewroom' : 'web';
	const summary = humanizeSignal(latest.name);
	// The fingerprint is a last-resort source for a brand-new row (so an anonymous visitor is
	// still visible as "a24c60d6c9c2"), but it must NEVER overwrite a name on an existing row —
	// anonymous website batches would otherwise clobber the name the visitor gave in the viewroom.
	const source = name || email || phone || fingerprint || undefined;

	// The row's `metadata.signals` is a read-modify-write, so two batches for the SAME visitor
	// arriving together (a form tab-through, or a site batch overlapping an embed request) would
	// both read the pre-existing array and the second write would clobber the first. The signal
	// stayed in pipeline_events but vanished from the comm log — which is what the sales inbox and
	// the AI summary actually read, so it looked like the signal was never received at all.
	// The advisory lock serialises per visitor thread only; it is released when the tx commits.
	const { logId, content, shouldNotify } = await prisma.$transaction(async (tx: any) => {
		await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${threadId}))`;

		// Keep one thread per visitor so every signal shares the same COM id.
		await tx.communicationThread.upsert({
			where: { id: threadId },
			create: {
				id: threadId,
				companyId: company.id,
				contactId: contact?.id ?? null,
				status: 'open',
				summary
			},
			update: { summary, contactId: contact?.id ?? undefined }
		});

		const existing = await tx.communicationLog.findFirst({
			where: { companyId: company.id, communicationThreadId: threadId },
			orderBy: { created: 'desc' }
		});

		const meta = (existing?.metadata as Record<string, any>) || {};
		const incomingSignals = eventIds.map((e) => e.name);

		// Append every signal — repeats from later visits must be visible, not deduped away (a
		// returning visitor's vr_entry/dwell would otherwise look like nothing was recorded).
		const signals = Array.isArray(meta.signals)
			? [...meta.signals, ...incomingSignals].slice(-80)
			: incomingSignals;
		const nextContent = `Signals: ${signals.map(humanizeSignal).join(' → ')} · Engagement score ${engagementScore}`;

		// Notify once per session, the first time a high-intent signal arrives.
		const notify = eventIds.some((ev) => isHighIntent(ev)) && !meta.notified;
		const nextMeta = {
			...meta,
			name: name ?? meta.name ?? null,
			latestSignal: latest.name,
			signals,
			scoreLive: engagementScore,
			source_signal: type,
			attribution: batch.attribution ?? meta.attribution,
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
					metadata: { ...nextMeta, profileId } as any
				}
			});
			id = created.id;
		}

		return { logId: id, content: nextContent, shouldNotify: notify };
	});

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
