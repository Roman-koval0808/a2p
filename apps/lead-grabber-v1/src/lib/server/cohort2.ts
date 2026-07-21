import crypto from 'crypto';
import { prisma } from '$lib/db';

/**
 * Section 8 — Network (Cohort 2 Growth Attribution).
 *
 * Ported to match the reference implementation in
 * `clearsky-full-project-reference-2026-07-20/prototype/src/engine/growth/cohort2.ts`
 * and Pipeline Reference §10. This is NOT a per-event step: it fires once a customer relationship
 * reaches a terminal outcome — won (booked and paid) or lost — and writes one anonymized
 * trajectory row for the cross-contractor network.
 *
 * Locked rules enforced here (§10.3 "What Section 8 NEVER Does"):
 *   - never a 'lost' record without a lossReason, never a 'won' record with one
 *   - never an individual identity on the record (writes are anonymized + PII-redacted, §1.5)
 *   - closeValue is realized revenue: 0 on a loss, never the quoted/at-stake value
 */

/** Canonical vocabulary — prototype `LossReason`. Do not extend without a spec change. */
export const LOSS_REASONS = [
	'went_quiet',
	'chose_competitor',
	'price_objection',
	'no_show',
	'declined_quote',
	'timing_not_right',
	'other'
] as const;
export type LossReason = (typeof LOSS_REASONS)[number];
export type OutcomeResult = 'won' | 'lost';

/** Layer 1 — Behavioural. */
export interface Behavioural {
	bucket: string;
	scoreLive: number;
	velocity: number;
	sessionCount: number;
	tier: string;
	toolsEngaged: string[];
	actionTaken: string[];
}
/** Layer 2 — Demographic (persona). Human-entered, never AI-inferred (§10.3). */
export interface Demographic {
	gender: string;
	ageBracket: string;
	propertyType: string;
	householdIncomeBracket: string;
	familyStatus: string;
}
/** Layer 3 — Language & Sentiment. */
export interface LanguageSentiment {
	sentiment: string;
	urgency: string;
	priceSensitivity: 'low' | 'medium' | 'high';
	objections: string[];
	commitmentOrCancellation: 'committed' | 'cancelled' | 'none';
	competitorMentions: string[];
}
/** Layer 4 — Time & Trend. */
export interface TimeTrend {
	touchTimestamps: string[];
	daysInSystem: number;
	gapTrend: 'widening' | 'narrowing' | 'flat';
	scorePeak: number;
	bucketHistory: string[];
	channelSequence: string[];
	season: 'spring' | 'summer' | 'fall' | 'winter';
	demandState: 'reactive' | 'planned' | 'seasonal';
}
/** Layer 5 — Interest & Affinity. */
export interface InterestAffinity {
	serviceAffinity: string;
	projectType: string;
	aesthetic: string;
	decisionDriver: string;
	researchDepth: 'low' | 'medium' | 'high';
	channelPreference: string;
	referralSource: string | null;
}
/** Cross-cutting. Business-level Stream B join — never individual-attached (§10.3). */
export interface RankContext {
	keyword: string | null;
	serpPosition: number | null;
	mapPackPosition: number | null;
	localSeoScore: number | null;
	snapshotAt: string | null;
}

const PHONE = /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
/** Street-ish lines, e.g. "42 Elm Street" — §10.2 step 11 strips address too. */
const ADDRESS = /\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Blvd|Lane|Ln|Way|Court|Ct)\b/g;

/**
 * Strip re-identifying tokens while keeping sentence structure usable (§10.2 step 11).
 *
 * The prototype matched a hardcoded list of story names (Denise|Barry|…), which only works for the
 * worked examples. Here the caller passes the real names to remove, since we know them.
 */
export function redact(transcript: string | null | undefined, names: (string | null | undefined)[] = []): string {
	let out = (transcript || '').trim();
	if (!out) return '';
	// ORDER MATTERS: structured identifiers first. Replacing names first turns "sam@example.com"
	// into "[NAME]@example.com", which no longer matches the email pattern — the address then
	// survives redaction. Strip email/phone/address, then names.
	out = out.replace(EMAIL, '[EMAIL]').replace(PHONE, '[PHONE]').replace(ADDRESS, '[ADDRESS]');
	for (const name of names) {
		const n = (name || '').trim();
		if (n.length < 2) continue;
		out = out.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[NAME]');
	}
	return out;
}

/**
 * One-way relationship identity. Section 8 rows carry no contact FK — but §10.2 step 2 still has to
 * verify a trajectory hasn't already been written for THIS relationship, so we store a hash.
 */
export function relationshipKeyFor(companyId: string, contactId: string): string {
	return crypto.createHash('sha256').update(`${companyId}:${contactId}`).digest('hex');
}

export interface Cohort2Input {
	companyId: string;
	/** Used only to derive the anonymized key + redaction; never stored. */
	contactId?: string | null;
	contactName?: string | null;
	outcomeResult: OutcomeResult;
	lossReason?: LossReason | null;
	behavioural?: Partial<Behavioural> | null;
	demographic?: Partial<Demographic> | null;
	languageSentiment?: Partial<LanguageSentiment> | null;
	timeTrend?: Partial<TimeTrend> | null;
	interestAffinity?: Partial<InterestAffinity> | null;
	rankContext?: Partial<RankContext> | null;
	transcript?: string | null;
	/** Realized revenue. Forced to 0 on a loss. */
	closeValue?: number | null;
	touchesToOutcome?: number | null;
	/** Skip when a terminal record already exists newer than this (the contact's last activity). */
	notBefore?: Date | null;
}

/** Mirrors the prototype's buildCohort2Record validation, which throws on either mismatch. */
export function assertOutcomeShape(outcomeResult: OutcomeResult, lossReason: LossReason | null): void {
	if (outcomeResult === 'won' && lossReason !== null) {
		throw new Error('cohort2: lossReason must be null for a won outcome');
	}
	if (outcomeResult === 'lost' && lossReason === null) {
		throw new Error('cohort2: lossReason is required for a lost outcome');
	}
	if (lossReason !== null && !LOSS_REASONS.includes(lossReason)) {
		throw new Error(`cohort2: unknown lossReason "${lossReason}"`);
	}
}

export async function writeCohort2Trajectory(input: Cohort2Input): Promise<void> {
	try {
		const lossReason = input.lossReason ?? null;
		assertOutcomeShape(input.outcomeResult, lossReason);

		const relationshipKey = input.contactId
			? relationshipKeyFor(input.companyId, input.contactId)
			: null;

		// §10.2 step 2 — entry eligibility. A return visit (activity newer than the last record)
		// legitimately opens a NEW trajectory; that is the re-entry rule, not a duplicate.
		if (relationshipKey) {
			const existing = await prisma.cohort2Trajectory.findFirst({
				where: {
					relationshipKey,
					...(input.notBefore ? { closedAt: { gte: input.notBefore } } : {})
				},
				select: { id: true }
			});
			if (existing) return;
		}

		// closeValue is realized revenue — 0 on a loss, never the quoted/at-stake value (§10.4).
		const closeValue = input.outcomeResult === 'lost' ? 0 : Math.max(0, Math.round(input.closeValue ?? 0));

		await prisma.cohort2Trajectory.create({
			data: {
				companyId: input.companyId,
				contactId: null, // anonymized — identity lives only in relationshipKey
				relationshipKey,
				outcomeResult: input.outcomeResult,
				lossReason,
				behavioural: (input.behavioural as any) ?? undefined,
				demographic: (input.demographic as any) ?? undefined,
				languageSentiment: (input.languageSentiment as any) ?? undefined,
				timeTrend: (input.timeTrend as any) ?? undefined,
				interestAffinity: (input.interestAffinity as any) ?? undefined,
				rankContext: (input.rankContext as any) ?? undefined,
				redactedTranscript: redact(input.transcript, [input.contactName]),
				closeValue,
				touchesToOutcome: Math.max(0, Math.round(input.touchesToOutcome ?? 0)),
				// Legacy flattened columns, kept populated for existing readers.
				bucketHistory: (input.timeTrend?.bucketHistory as any) ?? undefined,
				channelSequence: (input.timeTrend?.channelSequence as any) ?? undefined,
				bookedJobOutcome: input.outcomeResult === 'won' ? 'completed' : null
			}
		});
		console.log(
			`[cohort2] trajectory recorded: ${input.outcomeResult}${lossReason ? ` (${lossReason})` : ''} closeValue=${closeValue} touches=${input.touchesToOutcome ?? 0}`
		);
	} catch (err: any) {
		console.error('[cohort2] trajectory write failed:', err?.message || err);
	}
}
