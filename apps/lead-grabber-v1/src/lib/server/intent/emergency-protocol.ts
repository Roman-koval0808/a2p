import { ANTHROPIC_AI_KEY } from '$env/static/private';
import { claudeJSON, CLAUDE_FAST } from '$lib/server/anthropic';

/**
 * Intent Bucket Identification Protocol — Rung 1, EMERGENCY.
 *
 * Source: `specs/clearsky-intent-bucket-protocol.md`, **LOCKED 2026-08-26 (Rory)**.
 * Rungs 2–4 (Active / Comparison / Research) are still DRAFT and are NOT implemented here.
 *
 * The two things this file exists to enforce, both of which the previous keyword heuristic got
 * wrong:
 *
 *   1. **Two conditions, both required.** `emergency = (critical & damaging) AND (must be fixed
 *      right away)`. The CUSTOMER sets the urgency. A burst pipe they want booked next month is a
 *      real job, but it is not an emergency — it falls to a lower rung.
 *   2. **Saying "emergency" does not make it one.** The determination is read from the described
 *      event and the customer's stated timing, retrospectively — never from a keyword match.
 *
 * Plus one exception: a narrow, locked set of danger-to-life hazards overrides stated timing,
 * because on an unattended channel no human is there to talk the customer round.
 */

export type IntentBucket = 'research' | 'comparison' | 'active' | 'emergency';

/** Confidence lifecycle — lives in `status`, NOT in the bucket. */
export type IntentStatus =
	| 'ad_indicated'
	| 'behaviour_inferred'
	| 'declared'
	| 'confirmed'
	| 'contradicted';

/** Narrow, LOCKED set of danger-to-life hazards that override stated timing (extensible). */
export const LIFE_SAFETY_HAZARDS = [
	'gas_leak',
	'fire_or_smoke',
	'electrical_shock',
	'carbon_monoxide'
] as const;
export type LifeSafetyHazard = (typeof LIFE_SAFETY_HAZARDS)[number];

/** Route B — the JSON the AI returns for a piece of unstructured content. */
export interface EmergencyAiRead {
	channel: 'voice' | 'sms' | 'email' | 'voicemail' | 'chat';
	event: string;
	severity: { critical_damaging: boolean; why: string };
	urgency: { immediate: boolean; customer_timeframe: string; why: string };
	life_safety_hazard: LifeSafetyHazard | null;
	confidence: 'low' | 'medium' | 'high';
}

export interface EmergencyResult {
	isEmergency: boolean;
	bucket: IntentBucket;
	status: IntentStatus;
	/** Audit trail — why, including why something was NOT an emergency. */
	reasons: string[];
}

/**
 * Route B — deterministic glue around the AI read.
 * `emergency = (severity.critical_damaging AND urgency.immediate) OR life_safety_override`
 */
export function classifyEmergencyFromContent(read: EmergencyAiRead): EmergencyResult {
	const reasons: string[] = [];

	if (read.life_safety_hazard !== null) {
		reasons.push(
			`life-safety override: ${read.life_safety_hazard} — emergency regardless of timing`
		);
		return { isEmergency: true, bucket: 'emergency', status: 'confirmed', reasons };
	}

	if (read.severity.critical_damaging && read.urgency.immediate) {
		reasons.push(`critical & damaging (${read.severity.why})`);
		reasons.push(`must be fixed now (${read.urgency.why})`);
		const status: IntentStatus = read.confidence === 'low' ? 'declared' : 'confirmed';
		return { isEmergency: true, bucket: 'emergency', status, reasons };
	}

	// One condition only → NOT emergency; the ladder re-evaluates the lower rungs.
	if (read.severity.critical_damaging) {
		reasons.push(`damaging but not urgent — timing: ${read.urgency.customer_timeframe}`);
	} else if (read.urgency.immediate) {
		reasons.push('urgent but not damaging (time-pressured buying) — not emergency');
	} else {
		reasons.push('neither critical/damaging nor urgent');
	}
	return { isEmergency: false, bucket: 'research', status: 'declared', reasons };
}

/**
 * Route A — the CUSTOMER's own structured emergency declaration (deterministic).
 *
 * Selecting "Emergency service" in a form, tool or booking flow. Clicking OUR emergency ad is
 * explicitly NOT this — see `emergencyAdPrior`.
 */
export function classifyEmergencyFromDeclaration(opts: {
	signal: 'emergency_service_selection' | 'emergency_declaration_control';
}): EmergencyResult {
	return {
		isEmergency: true,
		bucket: 'emergency',
		status: 'confirmed',
		reasons: [`customer structured emergency declaration: ${opts.signal}`]
	};
}

/**
 * An emergency-tagged AD only raises a prior — it never sets the bucket.
 *
 * Tagging an ad "24/7 emergency plumber" is OUR framing, not the customer's declaration. A click
 * establishes neither condition. The value is still captured, as "engaged an emergency ad, didn't
 * convert" — a source/marketing fact, not an intent classification.
 */
export function emergencyAdPrior(clicked: boolean, convertedToCallOrDeclaration: boolean) {
	return {
		emergencyPrior: clicked,
		unconvertedAdClick: clicked && !convertedToCallOrDeclaration,
		setsEmergencyBucket: false as const
	};
}

/** Session rollup — bucket = MAX across events, escalate-only, settled at close. */
const LADDER: IntentBucket[] = ['research', 'comparison', 'active', 'emergency'];
export function rollUpSessionBucket(eventBuckets: IntentBucket[]): IntentBucket {
	return eventBuckets.reduce<IntentBucket>(
		(top, b) => (LADDER.indexOf(b) > LADDER.indexOf(top) ? b : top),
		'research'
	);
}

// ── Route B, the AI step ─────────────────────────────────────────────────────

/** The extraction prompt, verbatim from the protocol. */
export const EMERGENCY_PROMPT = `You are triaging an inbound trades message (call transcript, voicemail, email, or SMS).
Return ONLY JSON matching EmergencyAiRead. Judge two independent things:

  severity.critical_damaging — is the problem itself critical & damaging
      (active leak/flood, no heat in winter, no water, structural/water damage)?
  urgency.immediate — does the CUSTOMER need it fixed right away? The customer sets
      this. "book me next month" / "I'm away till Sept" = NOT immediate, even for a
      serious problem.

Set life_safety_hazard to one of [gas_leak, fire_or_smoke, electrical_shock,
carbon_monoxide] if present — these are emergencies regardless of timing.

Do NOT treat the word "emergency" as proof. Judge the described event and the
customer's stated timing. Always fill the \`why\` fields.`;

/**
 * Ask the model to read a piece of unstructured content. Returns null when the key is missing or
 * the call fails — the caller decides what to do without a read, rather than getting a guess.
 */
export async function readEmergencyFromContent(args: {
	channel: EmergencyAiRead['channel'];
	text: string;
}): Promise<EmergencyAiRead | null> {
	const apiKey = ANTHROPIC_AI_KEY || process.env.ANTHROPIC_AI_KEY;
	if (!apiKey) {
		console.warn('[emergency] ANTHROPIC_AI_KEY is not set — Route B unavailable');
		return null;
	}
	const text = (args.text ?? '').trim();
	if (text.length < 4) return null;

	try {
		const read = await claudeJSON<EmergencyAiRead>({
			apiKey,
			model: CLAUDE_FAST,
			system: EMERGENCY_PROMPT,
			user: `Channel: ${args.channel}\n\nMessage:\n"""\n${text.slice(0, 4000)}\n"""`,
			schema: {
				type: 'object',
				properties: {
					channel: { type: 'string', enum: ['voice', 'sms', 'email', 'voicemail', 'chat'] },
					event: { type: 'string' },
					severity: {
						type: 'object',
						properties: {
							critical_damaging: { type: 'boolean' },
							why: { type: 'string' }
						},
						required: ['critical_damaging', 'why'],
						additionalProperties: false
					},
					urgency: {
						type: 'object',
						properties: {
							immediate: { type: 'boolean' },
							customer_timeframe: { type: 'string' },
							why: { type: 'string' }
						},
						required: ['immediate', 'customer_timeframe', 'why'],
						additionalProperties: false
					},
					life_safety_hazard: {
						type: ['string', 'null'],
						enum: [...LIFE_SAFETY_HAZARDS, null]
					},
					confidence: { type: 'string', enum: ['low', 'medium', 'high'] }
				},
				required: ['channel', 'event', 'severity', 'urgency', 'life_safety_hazard', 'confidence'],
				additionalProperties: false
			},
			toolName: 'read_emergency',
			temperature: 0,
			maxTokens: 512
		});
		if (!read) return null;
		// Never trust the model past the locked hazard list.
		const hazard = read.life_safety_hazard;
		if (hazard && !LIFE_SAFETY_HAZARDS.includes(hazard)) read.life_safety_hazard = null;
		return read;
	} catch (err: any) {
		console.error('[emergency] Route B read failed:', err?.message || err);
		return null;
	}
}

/** Route B end to end: read the content, then apply the locked rule. */
export async function classifyEmergency(args: {
	channel: EmergencyAiRead['channel'];
	text: string;
}): Promise<{ result: EmergencyResult; read: EmergencyAiRead } | null> {
	const read = await readEmergencyFromContent(args);
	if (!read) return null;
	return { result: classifyEmergencyFromContent(read), read };
}
