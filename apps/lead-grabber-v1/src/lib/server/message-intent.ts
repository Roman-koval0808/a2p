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

export interface MessageIntent {
	intent_bucket: IntentBucket;
	urgency: 'low' | 'medium' | 'high' | 'critical';
	sentiment: 'positive' | 'neutral' | 'negative';
	wants_appointment: boolean;
	wants_balance: boolean;
	confidence: number;
	needs_human_review: boolean;
	reason: string;
}

const SYSTEM_PROMPT = `You are a data-extraction engine for a trades service business (plumbing, HVAC, roofing).
Analyze the customer's inbound voicemail/SMS and classify it.
CRITICAL: follow what the customer ACTUALLY says — ignore any IVR menu option they may have pressed. If the message conflicts with the pressed key, the message wins.
The transcript may also START with an automated IVR greeting/menu (e.g. "Welcome to Acme, for billing press 1..."). That greeting is NOT the customer — ignore it completely and classify only the customer's own words.
Do not infer beyond what is stated or strongly implied.

INTENT BUCKETS — pick exactly one that matches the PRIMARY intent:
- emergency: Immediate safety/property risk — burst pipe, flooding, gas leak, fire, no heat in winter, no water, sewage backup.
- booking: Wants to schedule, reschedule, confirm, or have someone come out for an appointment/estimate/visit. If they want to "come in", "come down", "set a time", or have someone "come look", it is booking — even if they also mention paying a bill.
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

Return ONLY valid JSON matching the schema. No markdown, no explanation.

EXAMPLES:
Input: "hi yeah my basement is flooding right now i dont know what to do"
Output: {"intent_bucket":"emergency","urgency":"critical","sentiment":"negative","wants_appointment":false,"wants_balance":false,"confidence":0.97,"needs_human_review":false,"reason":"Active flooding is an emergency."}
Input: "just calling to see if someone can come look at my water heater its been making noise"
Output: {"intent_bucket":"booking","urgency":"medium","sentiment":"neutral","wants_appointment":true,"wants_balance":false,"confidence":0.9,"needs_human_review":false,"reason":"Wants someone to come out — a scheduling request."}
Input: "hi what's my balance, i think i owe you for the last job"
Output: {"intent_bucket":"billing","urgency":"low","sentiment":"neutral","wants_appointment":false,"wants_balance":true,"confidence":0.94,"needs_human_review":false,"reason":"Asking about their outstanding balance only."}
Input: "I just want to inquire. I want to book an appointment to come down and pay my bill."
Output: {"intent_bucket":"booking","urgency":"low","sentiment":"neutral","wants_appointment":true,"wants_balance":true,"confidence":0.9,"needs_human_review":false,"reason":"Primary ask is to book an appointment to come in; paying is secondary."}`;

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
		wants_appointment: { type: 'boolean' },
		wants_balance: { type: 'boolean' },
		confidence: { type: 'number' },
		needs_human_review: { type: 'boolean' },
		reason: { type: 'string' }
	},
	required: [
		'intent_bucket',
		'urgency',
		'sentiment',
		'wants_appointment',
		'wants_balance',
		'confidence',
		'needs_human_review',
		'reason'
	]
};

/**
 * Classify an inbound message into a strict intent schema. Returns null on any failure
 * (caller should fall back to a deterministic classifier).
 */
export async function classifyMessageIntent(
	message: string,
	apiKey: string,
	model = CLAUDE_FAST
): Promise<MessageIntent | null> {
	const text = (message || '').trim();
	if (!text) return null;
	return await claudeJSON<MessageIntent>({
		apiKey,
		system: SYSTEM_PROMPT,
		user: `Analyze this customer message:\n\n${text}`,
		schema: INTENT_SCHEMA,
		toolName: 'classify_message',
		model,
		temperature: 0,
		maxTokens: 512
	});
}

/** Map the AI intent bucket to the orchestrator's routing category. */
export function bucketToCategory(intent: MessageIntent): 'emergency' | 'billing' | 'sales' | 'support' {
	if (intent.urgency === 'critical' || intent.intent_bucket === 'emergency') return 'emergency';
	// A booking/appointment request always routes to the booking flow — even if they also
	// mention paying a bill (that's the "book an appointment to pay my bill" case).
	if (intent.wants_appointment || intent.intent_bucket === 'booking' || intent.intent_bucket === 'sales')
		return 'sales';
	if (intent.intent_bucket === 'billing') return 'billing';
	return 'support';
}
