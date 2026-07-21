import { prisma } from '$lib/db';
import { writeCohort2Trajectory, type LossReason } from './cohort2';

/**
 * Section 8 — the LOSS half.
 *
 * Wins are events (someone confirms the job is done and paid). Losses almost never are: a lead
 * goes quiet, and nobody calls to say they hired a competitor. §10.1 lists "went quiet" as a valid
 * terminal outcome, so losses have to be swept for on a timer the way SLA breaches are.
 *
 * Signals, in descending confidence:
 *   1. cancelled appointment            → `declined_quote`  (they told us)
 *   2. no-show on a past appointment    → `no_show`
 *   3. engaged once, then silence       → `went_quiet`      (mirrors the engine's own demotion verdict)
 *
 * OPEN WITH THE CLIENT: the idle window is a business judgement about their trades, not something
 * we can infer. 14 days matches the research-bucket grace period. This is the one number in
 * Section 8 that is an assumption rather than a specified value.
 */
export const GONE_QUIET_DAYS = 14;

/** An untouched record is not a lost relationship — never sweep someone who never engaged. */
const MIN_ENGAGEMENT_TO_COUNT_AS_LOST = 1;

export interface SweepResult {
	declined: number;
	noShow: number;
	wentQuiet: number;
}

export async function checkLostRelationships(): Promise<SweepResult> {
	const now = new Date();
	const quietBefore = new Date(now.getTime() - GONE_QUIET_DAYS * 24 * 60 * 60 * 1000);
	const result: SweepResult = { declined: 0, noShow: 0, wentQuiet: 0 };

	// ── 1 + 2. Terminal appointment states ───────────────────────────────────────────────────
	try {
		const appointments = await prisma.appointment.findMany({
			where: {
				contactId: { not: null },
				OR: [
					{ status: 'cancelled' },
					{ status: 'booked', endTime: { lt: quietBefore } } // never completed, long past
				]
			},
			select: { companyId: true, contactId: true, status: true, updated: true, endTime: true },
			take: 500
		});
		for (const appt of appointments) {
			const reason: LossReason = appt.status === 'cancelled' ? 'declined_quote' : 'no_show';
			await recordLoss(appt.companyId, appt.contactId!, reason, appt.updated);
			if (reason === 'declined_quote') result.declined++;
			else result.noShow++;
		}
	} catch (e: any) {
		console.error('[cohort2-sweep] appointment pass failed:', e?.message || e);
	}

	// ── 3. Went quiet ────────────────────────────────────────────────────────────────────────
	// `updated` is bumped by the orchestrator on every interaction, so it is last-activity.
	try {
		const quiet = await prisma.contact.findMany({
			where: {
				updated: { lt: quietBefore },
				engagementScore: { gte: MIN_ENGAGEMENT_TO_COUNT_AS_LOST }
			},
			select: { id: true, companyId: true, updated: true },
			take: 500
		});
		for (const contact of quiet) {
			await recordLoss(contact.companyId, contact.id, 'went_quiet', contact.updated);
			result.wentQuiet++;
		}
	} catch (e: any) {
		console.error('[cohort2-sweep] went-quiet pass failed:', e?.message || e);
	}

	if (result.declined || result.noShow || result.wentQuiet) {
		console.log(
			`[cohort2-sweep] losses recorded — declined=${result.declined} no_show=${result.noShow} went_quiet=${result.wentQuiet}`
		);
	}
	return result;
}

/**
 * Assemble the trajectory layers from what the main database actually holds, then write.
 * `lastActivity` doubles as the idempotency key (see writeCohort2Trajectory).
 */
async function recordLoss(
	companyId: string,
	contactId: string,
	lossReason: LossReason,
	lastActivity: Date
): Promise<void> {
	const contact = await prisma.contact.findUnique({
		where: { id: contactId },
		select: { name: true, engagementScore: true, created: true, updated: true }
	});
	if (!contact) return;

	// The communication log is this relationship's touch history.
	const touches = await prisma.communicationLog.findMany({
		where: { companyId, customerId: contactId },
		orderBy: { created: 'asc' },
		select: { type: true, direction: true, created: true, content: true, metadata: true },
		take: 200
	});

	const meta = (touches[touches.length - 1]?.metadata as Record<string, any>) || {};
	const ai = meta.ai_intent || {};
	const daysInSystem = Math.max(
		0,
		Math.round((contact.updated.getTime() - contact.created.getTime()) / 86400000)
	);
	const month = lastActivity.getMonth();
	const season =
		month <= 1 || month === 11 ? 'winter' : month <= 4 ? 'spring' : month <= 7 ? 'summer' : 'fall';

	await writeCohort2Trajectory({
		companyId,
		contactId,
		contactName: contact.name,
		outcomeResult: 'lost',
		lossReason,
		closeValue: 0, // always 0 on a loss (§10.4)
		touchesToOutcome: touches.length,
		behavioural: {
			bucket: meta.message_category || 'unclassified',
			scoreLive: contact.engagementScore ?? 0,
			sessionCount: touches.length,
			tier: 'Tier 1', // reached by phone/email — anonymized downstream
			actionTaken: touches.map((t) => `${t.type}.${t.direction}`).slice(-10)
		},
		languageSentiment: {
			sentiment: ai.sentiment || meta.sentiment || 'unknown',
			urgency: ai.urgency || meta.urgency || 'unknown',
			objections: Array.isArray(ai.complaints) ? ai.complaints : [],
			commitmentOrCancellation: lossReason === 'declined_quote' ? 'cancelled' : 'none'
		},
		timeTrend: {
			touchTimestamps: touches.map((t) => t.created.toISOString()),
			daysInSystem,
			scorePeak: contact.engagementScore ?? 0,
			bucketHistory: [meta.message_category || 'unclassified'],
			channelSequence: touches.map((t) => t.type),
			season: season as 'spring' | 'summer' | 'fall' | 'winter',
			demandState: ai.urgency === 'high' ? 'reactive' : 'planned'
		},
		interestAffinity: {
			serviceAffinity: meta.sub_intent || meta.subcat_gpt || 'unknown',
			decisionDriver: lossReason === 'price_objection' ? 'price' : 'unknown',
			researchDepth: touches.length >= 5 ? 'high' : touches.length >= 2 ? 'medium' : 'low',
			channelPreference: touches[0]?.type ?? 'unknown',
			referralSource: null
		},
		// Demographic is human-entered only, never AI-inferred (§10.3) — omitted until captured.
		// RankContext is a business-level Stream B join owned by ContentRadar — not ours to fill.
		transcript: touches.map((t) => t.content).filter(Boolean).join('\n'),
		notBefore: lastActivity
	});
}
