// ClearSky Scheduled Intents — AI extraction (spec §4).
//
// The inbound message is already being read (message-intent.ts). This is one more
// question on top of what's already happening — not a new system: "does the
// customer name a future plan, and can it be turned into a date?"
//
// Two rules from the spec this module exists to enforce:
//   1. Keep the customer's exact words. "A couple of weeks" becoming 18 Aug is
//      our interpretation, not a fact — the raw phrase must survive so a human
//      can see what we assumed, and the follow-up can quote them.
//   2. If we're not confident, we don't schedule anything. A follow-up sent on a
//      date we invented is worse than no follow-up — it tells the customer we
//      weren't listening (the Marcus example).
//
// The date is computed in code, not by the model. The model answers *what* and
// *how long*; `resolveCalculatedTargetDate` turns that into an instant using the
// message's arrival timestamp and the client's timezone — so the interpretation
// is deterministic and auditable.

import { claudeJSON, CLAUDE_FAST } from '../anthropic';
import { zonedNaiveToUtc } from '../datetime';
import { TIMEFRAME_PATTERNS } from '../next-action';

export type IntentConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
/** Scenario A — the customer acts ("he'll call"); Scenario B — they asked us to. */
export type IntentActor = 'CUSTOMER' | 'BUSINESS';

/** The raw answer the LLM is asked for (Task 2.1). */
export interface ScheduledIntentRaw {
	/** Did the customer state a plan for the future at all? */
	hasFutureIntent: boolean;
	/** What they want — "air conditioning". */
	whatHeWants: string;
	/** Their exact words for when ("a couple of weeks") — never paraphrased. */
	rawTimeframe: string | null;
	/** That window in days, as resolved by the model ("a couple of weeks" → 14). */
	timeframeDays: number | null;
	/** An exact date they named, ISO 8601 if resolvable ("next Tuesday" → date), else null. */
	exactDateIso: string | null;
	confidence: IntentConfidence;
	/** Scenario A (customer acts) vs B (business acts). Null if the model can't tell. */
	actor: IntentActor | null;
	/** A channel they named ("call", "email"), else null. */
	preferredChannel: string | null;
}

/** Normalized extraction — the code-computed date is authoritative (Task 2.1 interface). */
export interface ScheduledIntentExtraction extends ScheduledIntentRaw {
	/** Deterministic resolution of when — ISO instant in the client's timezone, or null. */
	calculatedTargetDate: string | null;
	/** True only when we should actually write a schedule row (§4 confidence gate). */
	schedulable: boolean;
}

const SYSTEM_PROMPT = `You are a data-extraction engine for a trades business.
Analyze the customer's inbound message and answer one question: has the customer
stated a plan that happens in the future, and if so, what is it?

A "future intent" is a plan the customer announces, not a request for us to act
right now. Typical examples:
- "I'd like to talk about air conditioners. I'm heading out of town for a couple
  of weeks; when I get back I'll give you a call." → future intent: he'll call
  us about air conditioning in ~2 weeks.
- "Call me next Tuesday about the estimate." → future intent: we call him on Tuesday.
- "Maybe sometime in the spring we'll look at a new furnace." → future intent,
  but too vague to schedule.

Extraction rules:
- hasFutureIntent: true only if the customer names a plan with a future "when".
  A request for immediate action ("my furnace is leaking, can you come today")
  is NOT a future intent.
- whatHeWants: the subject of the plan, one short phrase ("air conditioning").
- rawTimeframe: the customer's EXACT words for when, quoted verbatim. Never
  paraphrase. null if they named no time at all.
- timeframeDays: "a couple of weeks"=14, "next week"=7, "a few days"=3, "a month"=30.
  null if they named no window.
- exactDateIso: only for a named date/weekday that you can resolve ("next Tuesday",
  "August 18th", "tomorrow"). Compute it from TODAY's date. null otherwise.
- confidence:
  - HIGH: a clear window or exact date in their words ("a couple of weeks", "next Tuesday").
  - MEDIUM: an implied window that needs interpretation ("after the long weekend").
  - LOW: vague ("sometime", "in the spring", "eventually", "I'll be in touch").
- actor:
  - CUSTOMER when THEY said they will make the next contact ("I'll call you",
    "I'll be in touch", "I'll give you a call when I'm back").
  - BUSINESS when they asked US to act ("call me", "email me", "get in touch with me").
- preferredChannel: only if they named one ("call", "email", "text"); else null.

The point of all this is a follow-up message that quotes the customer's own words
back at them. If rawTimeframe is not verbatim, the extraction is wrong.

Return ONLY valid JSON matching the schema. No markdown, no explanation.

EXAMPLES:
Input: "I'd like to talk to you about air conditioners. I'm heading out of town for a couple of weeks; when I get back I'll give you a call."
Output: {"hasFutureIntent":true,"whatHeWants":"air conditioning","rawTimeframe":"a couple of weeks","timeframeDays":14,"exactDateIso":null,"confidence":"HIGH","actor":"CUSTOMER","preferredChannel":"call"}
Input: "Call me next Tuesday about the quote for the furnace."
Output: {"hasFutureIntent":true,"whatHeWants":"a quote for the furnace","rawTimeframe":"next Tuesday","timeframeDays":null,"exactDateIso":"<next Tuesday's date>","confidence":"HIGH","actor":"BUSINESS","preferredChannel":"call"}
Input: "Maybe sometime in the spring we'll look at a new water heater."
Output: {"hasFutureIntent":true,"whatHeWants":"a new water heater","rawTimeframe":"sometime in the spring","timeframeDays":null,"exactDateIso":null,"confidence":"LOW","actor":null,"preferredChannel":null}
Input: "Hi, my basement is flooding right now, can you send someone?"
Output: {"hasFutureIntent":false,"whatHeWants":"","rawTimeframe":null,"timeframeDays":null,"exactDateIso":null,"confidence":"HIGH","actor":null,"preferredChannel":null}`;

const INTENT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	properties: {
		hasFutureIntent: { type: 'boolean' },
		whatHeWants: { type: 'string' },
		rawTimeframe: { type: ['string', 'null'] },
		timeframeDays: { type: ['number', 'null'] },
		exactDateIso: { type: ['string', 'null'] },
		confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
		actor: { type: ['string', 'null'], enum: ['CUSTOMER', 'BUSINESS'] },
		preferredChannel: { type: ['string', 'null'] }
	},
	required: [
		'hasFutureIntent',
		'whatHeWants',
		'rawTimeframe',
		'timeframeDays',
		'exactDateIso',
		'confidence',
		'actor',
		'preferredChannel'
	]
};

/**
 * Ask the model to pull the customer's stated future plan out of the message.
 * Returns null on any failure — the caller treats that as "no schedule".
 */
export async function extractScheduledIntent(
	message: string,
	apiKey: string,
	opts?: { reference?: Date; timeZone?: string; model?: string }
): Promise<ScheduledIntentExtraction | null> {
	const text = (message || '').trim();
	if (!text) return null;

	const raw = await claudeJSON<ScheduledIntentRaw>({
		apiKey,
		system: SYSTEM_PROMPT,
		user: `Analyze this customer message:\n\n${text}`,
		schema: INTENT_SCHEMA,
		toolName: 'extract_scheduled_intent',
		model: opts?.model || CLAUDE_FAST,
		temperature: 0,
		maxTokens: 900
	});
	if (!raw) return null;
	return normalizeExtraction(raw, { reference: opts?.reference, timeZone: opts?.timeZone, messageText: text });
}

/**
 * Make the raw model answer concrete: compute the target date in code, fill the
 * actor from a deterministic backstop when the model couldn't tell, and apply
 * the §4 confidence gate. Pure — unit-testable without an API key.
 */
export function normalizeExtraction(
	raw: ScheduledIntentRaw,
	opts?: { reference?: Date; timeZone?: string; messageText?: string }
): ScheduledIntentExtraction {
	const reference = opts?.reference ?? new Date();
	const calculatedTargetDate = resolveCalculatedTargetDate({
		reference,
		rawTimeframe: raw.rawTimeframe,
		timeframeDays: raw.timeframeDays,
		exactDateIso: raw.exactDateIso,
		timeZone: opts?.timeZone
	});
	const actor = raw.actor ?? (opts?.messageText ? resolveActorFromText(opts.messageText) : null);

	const extraction: ScheduledIntentExtraction = {
		...raw,
		actor,
		calculatedTargetDate,
		schedulable: false
	};
	extraction.schedulable = isSchedulable(extraction);
	return extraction;
}

/**
 * The "when" as a deterministic instant. Priority:
 *   1. An exact date the customer named (or the model resolved) — taken as-is.
 *   2. A weekday they named ("next Tuesday") — resolved from the reference date.
 *   3. Their window in days — added to the message's arrival timestamp.
 * Returns null when none of these can be computed — that's the not-confident path.
 */
export function resolveCalculatedTargetDate(opts: {
	reference: Date;
	rawTimeframe: string | null;
	timeframeDays: number | null;
	exactDateIso: string | null;
	timeZone?: string;
}): string | null {
	const { reference, rawTimeframe, timeframeDays, exactDateIso, timeZone = 'America/Toronto' } = opts;

	if (exactDateIso) {
		const d = new Date(exactDateIso);
		// The model resolves named dates against ITS clock, which can drift from the
		// message's actual arrival. A date in the past must not survive the gate —
		// it would go due immediately and a follow-up drafts on the next sweep for a
		// plan the customer never meant to be that. Drop it and fall through to the
		// code-computed resolutions (§4: the date is computed in code, not by the model).
		if (!isNaN(d.getTime()) && d.getTime() > reference.getTime()) return d.toISOString();
	}

	const weekday = weekdayFrom(rawTimeframe);
	if (weekday) {
		const next = nextWeekday(reference, weekday, timeZone);
		if (next) return next.toISOString();
	}

	const days = timeframeDays ?? daysFromRawTimeframe(rawTimeframe);
	if (typeof days === 'number' && Number.isFinite(days) && days > 0) {
		return new Date(reference.getTime() + days * 86_400_000).toISOString();
	}
	return null;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

function weekdayFrom(raw: string | null): (typeof WEEKDAYS)[number] | null {
	if (!raw) return null;
	const match = raw.toLowerCase().match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
	if (!match) return null;
	return match[1] as (typeof WEEKDAYS)[number];
}

/** "next Tuesday" is never today — strictly the next occurrence of that weekday. */
function nextWeekday(reference: Date, weekday: (typeof WEEKDAYS)[number], timeZone: string): Date | null {
	const idx = WEEKDAYS.indexOf(weekday);
	if (idx === -1) return null;
	const ref = new Date(reference);
	let delta = (idx - ref.getUTCDay() + 7) % 7;
	if (delta === 0) delta = 7;
	const target = new Date(ref);
	target.setUTCDate(ref.getUTCDate() + delta);
	const naive = `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}T10:00:00`;
	return zonedNaiveToUtc(naive, timeZone);
}

/**
 * Read the customer's own words for "when" into days. Longest match wins:
 * "a couple of weeks" must not be read as "a week". null when there's no window.
 */
export function daysFromRawTimeframe(raw: string | null | undefined): number | null {
	const phrase = (raw || '').trim();
	if (!phrase) return null;
	let best: number | null = null;
	let bestLength = 0;
	for (const [pattern, days] of TIMEFRAME_PATTERNS) {
		const match = phrase.match(pattern);
		if (match && match[0].length > bestLength) {
			best = days;
			bestLength = match[0].length;
		}
	}
	if (best !== null) return best;

	const explicit = phrase.match(/\b(\d+)\s*(day|week|month)s?\b/i);
	if (explicit) {
		const n = Number(explicit[1]);
		const unit = explicit[2].toLowerCase();
		return unit === 'day' ? n : unit === 'week' ? n * 7 : n * 30;
	}
	return null;
}

/** Windows the spec refuses to invent a date for (§4 — the Marcus path). */
const VAGUE_TIMEFRAME = /\b(sometime|eventually|one of these days|whenever|in the (spring|summer|fall|autumn|winter))\b/i;

export function isVagueTimeframe(raw: string | null | undefined): boolean {
	return !!raw && VAGUE_TIMEFRAME.test(raw);
}

/**
 * §4 confidence gate: if we're not confident, we don't schedule anything — it
 * goes to the agent as a judgement call instead. That means LOW confidence,
 * a phrase with no date in it at all, or a vague season-style window.
 */
export function isSchedulable(
	ext: Pick<ScheduledIntentExtraction, 'hasFutureIntent' | 'confidence' | 'rawTimeframe' | 'calculatedTargetDate'>
): boolean {
	if (!ext.hasFutureIntent) return false;
	if (ext.confidence === 'LOW') return false;
	if (isVagueTimeframe(ext.rawTimeframe)) return false;
	if (!ext.rawTimeframe) return false;
	if (!ext.calculatedTargetDate) return false;
	return true;
}

/**
 * Deterministic backstop for who acts (§6 Scenario A vs B) when the model didn't
 * answer. "I'll call you" → CUSTOMER; "call me" → BUSINESS. Never guesses.
 */
export function resolveActorFromText(text: string | null | undefined): IntentActor | null {
	const t = (text || '').trim().toLowerCase();
	if (!t) return null;
	if (/\b(i'?ll|i will|we'?ll|we will)\b[^.]{0,60}\b(call|ring|phone|email|text|contact|be in touch|get (back|in touch))\b/i.test(t)) {
		return 'CUSTOMER';
	}
	if (/\b(call|ring|phone|email|text|contact|reach)\b[^.]{0,60}\b(me|us)\b/i.test(t)) {
		return 'BUSINESS';
	}
	return null;
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}
