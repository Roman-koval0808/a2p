// AI message-intent classifier for A2P unstructured data (voicemail transcripts / SMS).
//
// Design goals (per the extraction-accuracy playbook):
//  - Strict JSON schema output (structured outputs) so the model can't freeform.
//  - Every enum value defined explicitly in the prompt.
//  - System prompt separated from the user data.
//  - temperature: 0 / top_p: 1 → deterministic, repeatable extraction.
//  - A few-shot block for the tricky edge cases (e.g. "book an appointment to pay my bill").
//  - A confidence score + needs_human_review flag.
//
// The key is passed in (not read from $env) so this module stays a plain, testable unit.

import { claudeJSON, CLAUDE_FAST } from './anthropic';

export type IntentBucket =
	| 'emergency'
	| 'booking'
	| 'billing'
	| 'complaint'
	| 'cancellation'
	| 'follow_up'
	| 'inquiry'
	| 'sales'
	| 'other';

/** Why the customer made contact — decides which workflow the orchestrator runs. */
export type CommunicationPurpose =
	| 'emergency'
	| 'enquiry'
	| 'opportunity'
	| 'support'
	| 'complaint'
	| 'positive_feedback';

export interface MessageIntent {
	intent_bucket: IntentBucket;
	urgency: 'low' | 'medium' | 'high' | 'critical';
	sentiment: 'positive' | 'neutral' | 'negative';
	complaints: string[];
	opportunity: 'none' | 'low' | 'medium' | 'high';
	wants_appointment: boolean;
	wants_balance: boolean;
	wants_callback: boolean;
	confidence: number;
	needs_human_review: boolean;
	reason: string;
	action_items: string[];

	// ── Structured extraction: who owes the next move, and when ──────────────
	// Summaries alone can't route a workflow. These answer, one question at a
	// time, what the customer actually committed to — so the orchestrator can
	// branch in code instead of hoping a summary phrased it usefully.
	purpose: CommunicationPurpose;
	/** How they asked to be reached, when they said. */
	preferred_contact_method: 'phone' | 'email' | 'sms' | 'in_person' | 'none';
	/** When they asked us to make contact, verbatim ("tomorrow morning"), else null. */
	callback_when: string | null;
	/** They said THEY would make the next contact ("I'll call you when I'm back"). */
	customer_will_initiate: boolean;
	/** How they said they'd do it ("call", "email"), else null. */
	customer_initiate_method: string | null;
	/** An exact date/time they named for it, ISO 8601 if resolvable, else null. */
	customer_initiate_exact_datetime: string | null;
	/** A vague window they named, verbatim ("a couple of weeks"), else null. */
	customer_initiate_timeframe: string | null;
	/** That window in days — the number the suspense timer is set from. */
	customer_initiate_timeframe_days: number | null;
	/** They want a meeting/visit/face-to-face, not just a reply. */
	wants_meeting: boolean;
	meeting_when: string | null;
	meeting_where: string | null;
	/**
	 * Whether we could actually price the job from what they told us. A request
	 * for a quote is not a quotable job: without dimensions, existing equipment
	 * and site conditions the only honest next step is an intake.
	 */
	has_enough_info_to_quote: boolean;
	/** What we'd have to ask to be able to quote. */
	missing_info_for_quote: string[];
	/** Who owes the next move. */
	next_action_owner: 'customer' | 'business';
}

const SYSTEM_PROMPT = `You are a data-extraction engine for a business.
Analyze the customer's inbound voicemail/SMS and classify it.
A voicemail transcript may START with an automated IVR greeting/menu spoken by the system (e.g. "Welcome to Acme, for billing press 1, for sales press 2..."). That greeting text is NOT the customer — ignore the greeting and its menu wording, and classify ONLY the customer's own words.
The menu option a customer pressed is a routing hint (which department they picked), NOT their intent — the customer's actual words always decide the intent. If what they say conflicts with the key they pressed, the message wins.
Do not infer beyond what is stated or strongly implied.

EMERGENCY ALWAYS WINS: if the message describes an ACTIVE safety or property emergency (water actively leaking/flooding/gushing, gas smell, fire/smoke/sparks, sewage backup, no heat in freezing weather, no water), the bucket is "emergency" and urgency is "critical" — EVEN IF the customer also asks to schedule a visit, get someone out, or mentions a day/time. "My roof is leaking right now, can you send someone" is emergency, NOT booking. Do not downgrade an active emergency to booking/sales just because they want someone to come out — that is exactly what an emergency needs.

INTENT BUCKETS — pick exactly one that matches the PRIMARY intent:
- emergency: Immediate safety/property risk happening now — burst/leaking pipe, roof/ceiling leak with active water, flooding, water damage in progress, gas leak, fire, no heat in winter, no water, sewage backup. Takes precedence over every other bucket.
- booking: Wants to schedule, reschedule, confirm, or have someone come out for a NON-emergency appointment/estimate/visit. If they want to "come in", "come down", "set a time", or have someone "come look", it is booking — even if they also mention paying a bill. But NOT if it's an active emergency (see above): that stays "emergency".
- billing: Wants to know or discuss their account balance / an invoice / owed amount, with NO appointment or visit requested.
- complaint: Expressing dissatisfaction with service or outcome.
- cancellation: Wants to cancel a service or appointment.
- follow_up: Checking the status of an existing job/ticket.
- inquiry: Asking a general question about services/pricing with no clear next action.
- sales: New prospect interested in buying / getting an estimate but not requesting a specific appointment yet.
- other: None of the above.

URGENCY — pick exactly one:
- critical: Immediate safety risk (burst pipe, flooding, gas, fire, no heat/water, sewage).
- high: Significant problem, customer frustrated, same-day resolution needed.
- medium: Issue exists but can wait 1-2 business days.
- low: General inquiry, no time pressure mentioned.

Also set:
- wants_appointment: true if they ask to book/schedule/come in/have someone come out/set a time.
- wants_balance: true if they ask about their balance/bill/what they owe or want to pay.
- confidence: 0..1.
- needs_human_review: true if confidence < 0.75 or the message is ambiguous/conflicting/empty.
- reason: one short sentence.

PURPOSE — pick exactly one; this decides which workflow runs:
- emergency: Immediate safety/property risk in progress.
- enquiry: A question about services, capability, or pricing.
- opportunity: A prospect wanting work done / a quote / an estimate.
- support: An existing job, ticket, appointment, or account matter.
- complaint: Dissatisfaction with service or outcome.
- positive_feedback: Praise or thanks with no request attached.

WHO OWES THE NEXT MOVE — answer these separately and literally. Never infer a
commitment nobody made:
- wants_callback: true ONLY if they asked US to contact them.
- callback_when: if they asked us to contact them and said when, quote their words; else null.
- preferred_contact_method: only if they stated one; else "none".
- customer_will_initiate: true if THEY said they would make the next contact
  ("I'll call you when I get back", "I'll be in touch"). This can be true while
  wants_callback is false — that is the normal case, not a contradiction.
- customer_initiate_method / customer_initiate_exact_datetime / customer_initiate_timeframe:
  only what they actually said. Quote a vague window verbatim ("a couple of weeks").
- customer_initiate_timeframe_days: that window as a number of days — "a few days"=3,
  "next week"=7, "a couple of weeks"=14, "a month"=30. null if they named no window.
- next_action_owner: "customer" if customer_will_initiate is true and they did NOT
  ask us to contact them first; otherwise "business". If the customer said they
  will call us, the next move is theirs — we acknowledge and wait, we do not chase.
- wants_meeting / meeting_when / meeting_where: an appointment, visit, or
  face-to-face. Wanting one "eventually" is still true; when/where stay null
  unless stated.

QUOTES ARE NOT QUOTABLE ON REQUEST:
- has_enough_info_to_quote: true ONLY if the message contains the specifics a
  tradesperson would need to actually price the work — size/dimensions, the
  existing equipment, the site conditions, the scope. "I'd like a quote on a new
  air conditioner, what would central cost" is false: no home size, no existing
  system, no ductwork information. Naming a service is not scoping a job.
- missing_info_for_quote: the specifics we would have to ask for. Empty when
  has_enough_info_to_quote is true.

ACTION ITEMS — concrete next steps for the team, and only steps we can actually
take now:
- Never write "prepare a quote" when has_enough_info_to_quote is false. The real
  next step is an intake/discovery to find out what they need.
- Never write a task to contact the customer when next_action_owner is "customer".
  They told us they would call; chasing them contradicts what they asked for.

Return ONLY valid JSON matching the schema. No markdown, no explanation.

EXAMPLES:
Input: "hi yeah my basement is flooding right now i dont know what to do"
Output: {"intent_bucket":"emergency","urgency":"critical","sentiment":"negative","wants_appointment":false,"wants_balance":false,"confidence":0.97,"needs_human_review":false,"reason":"Active flooding is an emergency."}
Input: "just calling to see if someone can come look at my water heater its been making noise"
Output: {"intent_bucket":"booking","urgency":"medium","sentiment":"neutral","wants_appointment":true,"wants_balance":false,"confidence":0.9,"needs_human_review":false,"reason":"Wants someone to come out — a scheduling request."}
Input: "my roof is leaking after the repair, water is coming into my kitchen, can you get someone out today or schedule me for Monday"
Output: {"intent_bucket":"emergency","urgency":"critical","sentiment":"negative","wants_appointment":true,"wants_balance":false,"wants_callback":true,"confidence":0.95,"needs_human_review":false,"reason":"Active water damage is an emergency and takes precedence over the scheduling request."}
Input: "hi what's my balance, i think i owe you for the last job"
Output: {"intent_bucket":"billing","urgency":"low","sentiment":"neutral","wants_appointment":false,"wants_balance":true,"confidence":0.94,"needs_human_review":false,"reason":"Asking about their outstanding balance only."}
Input: "I just want to inquire. I want to book an appointment to come down and pay my bill."
Output: {"intent_bucket":"booking","urgency":"low","sentiment":"neutral","wants_appointment":true,"wants_balance":true,"confidence":0.9,"needs_human_review":false,"reason":"Primary ask is to book an appointment to come in; paying is secondary."}
Input: "I would like to get a quote on a new air conditioning unit. I am wondering what the cost of central would be. I will be out of town for a couple of weeks. I will call you when I return so we can set up an appointment."
Output: {"intent_bucket":"sales","purpose":"opportunity","urgency":"low","sentiment":"neutral","wants_appointment":false,"wants_balance":false,"wants_callback":false,"preferred_contact_method":"none","callback_when":null,"customer_will_initiate":true,"customer_initiate_method":"call","customer_initiate_exact_datetime":null,"customer_initiate_timeframe":"a couple of weeks","customer_initiate_timeframe_days":14,"wants_meeting":true,"meeting_when":null,"meeting_where":null,"has_enough_info_to_quote":false,"missing_info_for_quote":["home square footage","existing heating/cooling system","whether ductwork is present","site access"],"next_action_owner":"customer","confidence":0.95,"needs_human_review":false,"reason":"Prospect wants central AC pricing but gave no specifications; they will call us back after two weeks away.","action_items":["Schedule a customer intake to scope the central air conditioning job before any pricing"]}
Input: "Hi, can you call me tomorrow morning about the furnace you installed, it's making a noise."
Output: {"intent_bucket":"follow_up","purpose":"support","urgency":"medium","sentiment":"neutral","wants_appointment":false,"wants_balance":false,"wants_callback":true,"preferred_contact_method":"phone","callback_when":"tomorrow morning","customer_will_initiate":false,"customer_initiate_method":null,"customer_initiate_exact_datetime":null,"customer_initiate_timeframe":null,"customer_initiate_timeframe_days":null,"wants_meeting":false,"meeting_when":null,"meeting_where":null,"has_enough_info_to_quote":true,"missing_info_for_quote":[],"next_action_owner":"business","confidence":0.93,"needs_human_review":false,"reason":"Asked us to call them tomorrow morning about a noise on a job we did."}`;

const INTENT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	properties: {
		intent_bucket: {
			type: 'string',
			enum: [
				'emergency',
				'booking',
				'billing',
				'complaint',
				'cancellation',
				'follow_up',
				'inquiry',
				'sales',
				'other'
			]
		},
		urgency: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
		sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
		complaints: {
			type: 'array',
			items: { type: 'string' },
			description: 'Specific complaints or problems the customer raises (empty array if none).'
		},
		opportunity: {
			type: 'string',
			enum: ['none', 'low', 'medium', 'high'],
			description: 'Sales/revenue opportunity level implied by the message.'
		},
		wants_appointment: { type: 'boolean' },
		wants_balance: { type: 'boolean' },
		wants_callback: { type: 'boolean' },
		confidence: { type: 'number' },
		needs_human_review: { type: 'boolean' },
		reason: { type: 'string' },
		action_items: {
			type: 'array',
			items: { type: 'string' },
			description: '1-3 concrete next-step tasks for the rep/team based on this message (e.g. "Send the account balance to the customer", "Confirm the appointment time"). Always provide at least one. Never a quote we cannot price, never a chase the customer did not ask for.'
		},
		purpose: {
			type: 'string',
			enum: ['emergency', 'enquiry', 'opportunity', 'support', 'complaint', 'positive_feedback']
		},
		preferred_contact_method: {
			type: 'string',
			enum: ['phone', 'email', 'sms', 'in_person', 'none']
		},
		callback_when: { type: ['string', 'null'] },
		customer_will_initiate: { type: 'boolean' },
		customer_initiate_method: { type: ['string', 'null'] },
		customer_initiate_exact_datetime: { type: ['string', 'null'] },
		customer_initiate_timeframe: { type: ['string', 'null'] },
		customer_initiate_timeframe_days: { type: ['number', 'null'] },
		wants_meeting: { type: 'boolean' },
		meeting_when: { type: ['string', 'null'] },
		meeting_where: { type: ['string', 'null'] },
		has_enough_info_to_quote: { type: 'boolean' },
		missing_info_for_quote: { type: 'array', items: { type: 'string' } },
		next_action_owner: { type: 'string', enum: ['customer', 'business'] }
	},
	required: [
		'intent_bucket',
		'urgency',
		'sentiment',
		'complaints',
		'opportunity',
		'wants_appointment',
		'wants_balance',
		'wants_callback',
		'confidence',
		'needs_human_review',
		'reason',
		'action_items',
		'purpose',
		'preferred_contact_method',
		'callback_when',
		'customer_will_initiate',
		'customer_initiate_method',
		'customer_initiate_exact_datetime',
		'customer_initiate_timeframe',
		'customer_initiate_timeframe_days',
		'wants_meeting',
		'meeting_when',
		'meeting_where',
		'has_enough_info_to_quote',
		'missing_info_for_quote',
		'next_action_owner'
	]
};

/**
 * Classify an inbound message into a strict intent schema. Returns null on any failure
 * (caller should fall back to a deterministic classifier).
 */
export async function classifyMessageIntent(
	message: string,
	apiKey: string,
	context?: Record<string, unknown> | null,
	model = CLAUDE_FAST
): Promise<MessageIntent | null> {
	const text = (message || '').trim();
	if (!text) return null;
	// The orchestrator compiles a structured metadata blob (IVR digit, day/time, caller geo,
	// line type, weather, …). Hand it to the AI as context alongside the unstructured message.
	const contextBlock =
		context && Object.keys(context).length
			? `\n\nStructured call metadata (context — use it to inform your analysis; do not echo it back):\n${JSON.stringify(context, null, 2)}`
			: '';
	return await claudeJSON<MessageIntent>({
		apiKey,
		system: SYSTEM_PROMPT,
		user: `Analyze this customer message:\n\n${text}${contextBlock}`,
		schema: INTENT_SCHEMA,
		toolName: 'classify_message',
		model,
		temperature: 0,
		// The questionnaire roughly doubled the field count; 700 truncated the tool call.
		maxTokens: 1200
	});
}

/**
 * Deterministic backstop for ACTIVE emergencies. The AI is the primary classifier, but missing an
 * in-progress flood/gas/fire because the caller also mentioned a time is too costly to leave purely
 * to the model. Narrow on purpose — a plain "water heater" or "next week" must NOT trip it.
 */
export function looksLikeActiveEmergency(text: string | null | undefined): boolean {
	const t = (text || '').toLowerCase();
	if (!t) return false;
	// Gas / fire / electrical — inherently an emergency.
	if (/\b(gas (leak|smell)|smell(ing)? gas|carbon monoxide|fire|smoke|sparks?)\b/.test(t)) return true;
	// Sewage backing up / overflowing.
	if (/\b(sewage|sewer|septic)\b/.test(t) && /\b(back(ing|ed)?\s?up|overflow)/.test(t)) return true;
	// Active water damage: a water-damage word (or "water" next to a spillage cue) AND an
	// "it's happening now" cue. Kept tight so "water heater making noise" does NOT trip it.
	const water =
		/\b(flood(ing|ed)?|burst|gushing|pouring|leak(ing)?)\b/.test(t) ||
		(/\bwater\b/.test(t) &&
			/\b(everywhere|all over|coming (in|into)|pushing|gushing|pouring|damage)\b/.test(t)) ||
		/\bpushing water\b/.test(t);
	const active =
		/\b(right now|as we speak|actively|everywhere|all over|coming (in|into)|pushing|gushing|pouring)\b/.test(
			t
		);
	return water && active;
}

/** Map the AI intent bucket to the orchestrator's routing category. */
export function bucketToCategory(intent: MessageIntent): 'emergency' | 'billing' | 'sales' | 'support' {
	if (intent.urgency === 'critical' || intent.intent_bucket === 'emergency') return 'emergency';
	// A booking/appointment request always routes to the booking flow — even if they also
	// mention paying a bill (that's the "book an appointment to pay my bill" case).
	if (intent.wants_appointment || intent.intent_bucket === 'booking' || intent.intent_bucket === 'sales')
		return 'sales';
	// A balance/billing request routes to billing even if the model labelled the bucket
	// 'inquiry'/'other' — wants_balance is the reliable signal ("how much is my balance?").
	if (intent.intent_bucket === 'billing' || intent.wants_balance) return 'billing';
	return 'support';
}
