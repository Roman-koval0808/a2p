// Why did he get back in touch? (clearsky-recontact-and-callback.md §2.1)
//
// A customer said on 1 Aug he'd ring back about a furnace. On the 16th he leaves a voicemail. The
// system already closes the chase — but closing it is not the useful part. The rep needs to know
// what he actually said, without listening to the recording.
//
// This is deliberately NOT the generic intent extraction that runs on every message. It is a
// comparison against the ORIGINAL promise: is this the same subject, what does he want now, when,
// and has anything changed. Generic extraction cannot answer "is this related to the call he made
// a fortnight ago" because it never sees that call.

import { claudeJSON } from './anthropic';

export interface RecontactAnalysis {
	/** Is this about the thing he promised to come back about? See §6.1 — currently advisory. */
	relatedToOriginal: boolean;
	relatednessConfidence: number;
	/** What he wants us to do next. */
	wants: 'appointment' | 'callback' | 'information' | 'nothing';
	/** When `wants` is 'information' — what specifically. */
	informationRequested: string | null;
	/** An ISO date if he named one, else null. */
	when: string | null;
	/** His own words about timing, stored verbatim — the interpretation above is ours. */
	rawTimingPhrase: string | null;
	conditions: string[];
	lostInterest: boolean;
	/** ISO date he pushed to, when he postponed rather than cancelled. */
	postponedTo: string | null;
	summary: string;
}

const SCHEMA = {
	type: 'object',
	properties: {
		related_to_original: { type: 'boolean' },
		relatedness_confidence: { type: 'number' },
		wants: { type: 'string', enum: ['appointment', 'callback', 'information', 'nothing'] },
		information_requested: { type: ['string', 'null'] },
		when: { type: ['string', 'null'] },
		raw_timing_phrase: { type: ['string', 'null'] },
		conditions: { type: 'array', items: { type: 'string' } },
		lost_interest: { type: 'boolean' },
		postponed_to: { type: ['string', 'null'] },
		summary: { type: 'string' }
	},
	required: [
		'related_to_original',
		'relatedness_confidence',
		'wants',
		'lost_interest',
		'summary'
	]
} as const;

const SYSTEM = `You compare a customer's NEW message against a promise they made earlier, for a
home-services business.

Report only what the customer actually said. Do not infer enthusiasm, urgency or intent that is not
in their words — a rep will act on this without hearing the recording, so an invention here becomes
a wrong phone call.

- related_to_original: true only if the new message concerns the same subject as the earlier call.
  A customer ringing about a burst pipe when the earlier call was about a furnace is NOT related,
  however welcome the call is.
- wants: what they are asking US to do next. 'nothing' if they are only providing information or
  keeping us posted.
- when / raw_timing_phrase: raw_timing_phrase is their exact words ("early next week"). 'when' is
  your resolved date, or null when the phrase is too vague to date.
- postponed_to: set only when they are delaying the SAME intention. Losing interest is not a
  postponement.
- lost_interest: true only on a clear signal — bought elsewhere, changed their mind, cancelled.
  Silence, vagueness or a short message are not signals.
- conditions: anything they attached to going ahead ("if you can beat the other quote").`;

export interface RecontactInput {
	apiKey: string;
	/** What they promised, in their words, from the original call. */
	originalPromise: string;
	/** What the original call was about. */
	originalTopic: string;
	/** When the original call happened, for dating relative phrases. */
	originalDate: Date;
	/** The new message: transcript, SMS text or email body. */
	newMessage: string;
	/** When the new message arrived — the anchor for "next week". */
	receivedAt: Date;
}

/**
 * Returns null when the AI is unavailable or the message is empty. Callers must treat null as
 * "we don't know" and still surface the contact to a human — never as "nothing to do".
 */
export async function analyseRecontact(
	input: RecontactInput
): Promise<RecontactAnalysis | null> {
	const message = input.newMessage?.trim();
	if (!message) return null;

	const user = [
		`ORIGINAL CALL (${input.originalDate.toISOString().slice(0, 10)})`,
		`Topic: ${input.originalTopic || 'not recorded'}`,
		`They promised: ${input.originalPromise || 'to be in touch'}`,
		'',
		`NEW MESSAGE (received ${input.receivedAt.toISOString().slice(0, 10)})`,
		message
	].join('\n');

	const raw = await claudeJSON<Record<string, any>>({
		apiKey: input.apiKey,
		system: SYSTEM,
		user,
		schema: SCHEMA as any,
		toolName: 'report_recontact'
	});
	if (!raw) return null;

	return {
		relatedToOriginal: raw.related_to_original === true,
		relatednessConfidence:
			typeof raw.relatedness_confidence === 'number' ? raw.relatedness_confidence : 0,
		wants: (['appointment', 'callback', 'information', 'nothing'] as const).includes(raw.wants)
			? raw.wants
			: 'nothing',
		informationRequested: raw.information_requested || null,
		when: raw.when || null,
		rawTimingPhrase: raw.raw_timing_phrase || null,
		conditions: Array.isArray(raw.conditions) ? raw.conditions.filter(Boolean) : [],
		lostInterest: raw.lost_interest === true,
		postponedTo: raw.postponed_to || null,
		summary: raw.summary || message.slice(0, 200)
	};
}

export interface RecontactOutcome {
	/** Title for the rep's task. */
	title: string;
	/** Whether anything further should be automated for this customer. */
	continueAutomation: boolean;
	/** Set when they pushed the date — a fresh commitment must be written for it. */
	rescheduleTo: string | null;
}

/**
 * Turn the reading into the one thing that should land on the rep's board (§2.3).
 *
 * Exactly one task per closure. "Lost interest" still produces a task — somebody should know the
 * opportunity is gone — but stops further automated contact.
 */
export function outcomeFor(
	analysis: RecontactAnalysis | null,
	customerName: string
): RecontactOutcome {
	const who = customerName?.trim() || 'Customer';

	// No reading available. Never silently drop the contact — a human looks at it.
	if (!analysis) {
		return {
			title: `${who} got in touch — review the message`,
			continueAutomation: true,
			rescheduleTo: null
		};
	}

	if (analysis.lostInterest) {
		return {
			title: `${who} is no longer interested — close the opportunity`,
			continueAutomation: false,
			rescheduleTo: null
		};
	}

	if (analysis.postponedTo) {
		return {
			title: `${who} postponed to ${analysis.postponedTo.slice(0, 10)}`,
			// The new commitment is what keeps them in the pipeline; without it they fall out
			// silently the moment the old row closes.
			continueAutomation: true,
			rescheduleTo: analysis.postponedTo
		};
	}

	switch (analysis.wants) {
		case 'appointment':
			return { title: `${who} wants to book — call them back`, continueAutomation: true, rescheduleTo: null };
		case 'callback':
			return { title: `${who} asked for a call back`, continueAutomation: true, rescheduleTo: null };
		case 'information':
			return {
				title: `${who} asked for information${analysis.informationRequested ? `: ${analysis.informationRequested}` : ''}`,
				continueAutomation: true,
				rescheduleTo: null
			};
		default:
			return {
				title: `${who} got in touch — no action requested`,
				continueAutomation: true,
				rescheduleTo: null
			};
	}
}
