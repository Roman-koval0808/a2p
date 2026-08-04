// Turns the structured extraction (message-intent.ts) into the work the business
// should actually do next.
//
// Two failures this exists to prevent, both of which the AI's own action_items
// produce on their own:
//
//  1. "Prepare a quote for Rory." A quote request is an intent, not a quotable
//     job — without the home's size, the existing system, the ductwork, nobody
//     can price it. The real next step is an intake that finds those out.
//  2. "Call the customer back tomorrow", when the customer said "I'll call you
//     when I'm back in two weeks." They took the next move; chasing them
//     contradicts what they asked for and wastes the rep's day.
//
// Everything here is pure so it can be tested without a database or an API key.

import type { MessageIntent } from './message-intent';

export interface SuspensePlan {
	/** When to check whether the customer actually came back. */
	dueAt: Date;
	/** The promise, in the customer's own framing, for the rep to read. */
	description: string;
	/** Days the customer named (before the buffer), for logging/telemetry. */
	timeframeDays: number;
}

export interface NextActionPlan {
	/** Who owes the next move. */
	owner: 'customer' | 'business';
	/** Tasks to create, in order. Never empty. */
	tasks: string[];
	/** True when we cannot price the job and must scope it first. */
	intakeRequired: boolean;
	/** Set only when the customer owns the next move and named a window. */
	suspense: SuspensePlan | null;
	/** AI-proposed tasks that were dropped, with why — surfaced in the logs. */
	dropped: { task: string; reason: string }[];
}

/** Default window when the customer promised to return but named no timeframe. */
const DEFAULT_TIMEFRAME_DAYS = 14;
/**
 * Grace added to the customer's own window before we treat the promise as
 * broken. "A couple of weeks" is an approximation, and chasing on the exact day
 * reads as impatience.
 */
const SUSPENSE_BUFFER_DAYS = 2;

const TIMEFRAME_PATTERNS: [RegExp, number][] = [
	[/\btomorrow\b/i, 1],
	[/\b(a )?couple of days\b/i, 2],
	[/\b(a )?few days\b/i, 3],
	[/\bnext week\b/i, 7],
	[/\b(a )?week\b/i, 7],
	[/\b(a )?couple of weeks\b/i, 14],
	[/\b(a )?few weeks\b/i, 21],
	[/\bnext month\b/i, 30],
	[/\b(a )?month\b/i, 30]
];

/** Tasks that promise a price we have no basis to put a number on. */
const QUOTE_TASK = /\b(prepar|creat|draft|build|put together|send|provide|generat)\w*\b[^.]*\b(quote|quotation|estimate|pricing|price)\b/i;
/** A task that already schedules the scoping visit we would otherwise add. */
const INTAKE_TASK = /\b(intake|discovery|site (visit|assessment)|scope|scoping)\b/i;
/** Tasks that chase a customer who told us they would make the next contact. */
const CHASE_TASK =
	/\b(call|phone|ring|contact|reach out to|follow[- ]up with|follow up with|check in with|email|text)\b[^.]*\b(customer|client|caller|him|her|them|back)\b/i;

/**
 * Read a customer's own words for "when" into days. Prefers the number the model
 * already resolved; the patterns are the backstop for when it returns only the
 * verbatim phrase.
 */
export function timeframeToDays(intent: Partial<MessageIntent>): number | null {
	const fromModel = intent.customer_initiate_timeframe_days;
	if (typeof fromModel === 'number' && Number.isFinite(fromModel) && fromModel > 0) {
		return Math.round(fromModel);
	}

	if (intent.customer_initiate_exact_datetime) {
		const when = new Date(intent.customer_initiate_exact_datetime);
		if (!Number.isNaN(when.getTime())) {
			const days = Math.ceil((when.getTime() - Date.now()) / 86_400_000);
			if (days > 0) return days;
		}
	}

	const phrase = intent.customer_initiate_timeframe || '';
	if (!phrase) return null;
	// Longest match wins: "a couple of weeks" must not be read as "a week".
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

/**
 * Who owes the next move. The model answers this directly; we re-derive it from
 * the underlying booleans when it doesn't, because getting this wrong is what
 * makes the system pester people who are on holiday.
 */
export function resolveNextActionOwner(intent: Partial<MessageIntent>): 'customer' | 'business' {
	if (intent.next_action_owner === 'customer' || intent.next_action_owner === 'business') {
		return intent.next_action_owner;
	}
	if (intent.customer_will_initiate && !intent.wants_callback) return 'customer';
	return 'business';
}

function describeService(intent: Partial<MessageIntent>, fallback: string): string {
	const reason = (intent.reason || '').toLowerCase();
	const match = reason.match(
		/\b(central air|air conditioning|air conditioner|ac unit|furnace|heat pump|boiler|water heater|roof(ing)?|hvac|duct\w*)\b/
	);
	return match ? match[0] : fallback;
}

/**
 * Build the plan. `customerName` is used only for readable task text.
 */
export function deriveNextActionPlan(
	intent: Partial<MessageIntent> | null | undefined,
	customerName: string,
	now: Date = new Date()
): NextActionPlan {
	const who = customerName?.trim() || 'the customer';
	const dropped: { task: string; reason: string }[] = [];

	if (!intent) {
		return {
			owner: 'business',
			tasks: [`Review and follow up with ${who}`],
			intakeRequired: false,
			suspense: null,
			dropped
		};
	}

	const owner = resolveNextActionOwner(intent);
	// An emergency is never a wait state, whatever the customer said they'd do.
	const isEmergency = intent.purpose === 'emergency' || intent.urgency === 'critical';
	const effectiveOwner = isEmergency ? 'business' : owner;

	const wantsPricing =
		intent.purpose === 'opportunity' ||
		intent.purpose === 'enquiry' ||
		intent.intent_bucket === 'sales' ||
		intent.intent_bucket === 'inquiry';
	const intakeRequired = wantsPricing && intent.has_enough_info_to_quote === false;

	const tasks: string[] = [];
	for (const task of intent.action_items || []) {
		if (intakeRequired && QUOTE_TASK.test(task)) {
			dropped.push({ task, reason: 'not enough information to price the job — intake first' });
			continue;
		}
		if (effectiveOwner === 'customer' && CHASE_TASK.test(task)) {
			dropped.push({ task, reason: `${who} said they would make the next contact` });
			continue;
		}
		tasks.push(task);
	}

	// The prompt now asks for an intake task directly, so the model often supplies a
	// well-worded one itself. Only add ours when it didn't — two intake tasks for one
	// job is the same clutter this module exists to prevent.
	const hasIntakeTask = tasks.some((t) => INTAKE_TASK.test(t));
	if (intakeRequired && !hasIntakeTask) {
		const service = describeService(intent, 'the work');
		const missing = (intent.missing_info_for_quote || []).slice(0, 4);
		tasks.unshift(
			`Schedule a customer intake with ${who} to scope ${service} before quoting` +
				(missing.length ? ` (needed: ${missing.join(', ')})` : '')
		);
	}

	let suspense: SuspensePlan | null = null;
	if (effectiveOwner === 'customer') {
		const namedDays = timeframeToDays(intent);
		const timeframeDays = namedDays ?? DEFAULT_TIMEFRAME_DAYS;
		const window =
			intent.customer_initiate_timeframe ||
			(intent.customer_initiate_exact_datetime ? `on ${intent.customer_initiate_exact_datetime}` : '') ||
			`about ${timeframeDays} days`;
		const method = intent.customer_initiate_method || 'be in touch';

		tasks.unshift(
			`Hold for ${who} — they said they would ${method} in ${window}. Do not chase before then.`
		);
		suspense = {
			dueAt: new Date(now.getTime() + (timeframeDays + SUSPENSE_BUFFER_DAYS) * 86_400_000),
			description: `${who} said they would ${method} in ${window} — no contact since. Follow up now.`,
			timeframeDays
		};
	}

	if (!tasks.length) tasks.push(`Review and follow up with ${who}`);

	return {
		owner: effectiveOwner,
		tasks: Array.from(new Set(tasks)),
		intakeRequired,
		suspense,
		dropped
	};
}
