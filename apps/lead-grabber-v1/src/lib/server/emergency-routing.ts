// Pure routing decision for process_orchestrator — extracted so the three-case business logic
// (see the George scenarios) can be unit-tested without a live database or Telnyx.
//
// The orchestrator imports and USES these, so a test here exercises the real code path.

export type MessageCategory = 'emergency' | 'billing' | 'sales' | 'support';

export interface RoutingDecision {
	/** Emergency → immediately text the on-call technician. */
	dispatchToTech: boolean;
	/** Create a customer-facing reply draft in the approval queue (needs a human "Confirm"). */
	draftCustomerReply: boolean;
	/** When a draft is created, whether it is flagged [DEFERRED] (arrived off-hours). */
	deferred: boolean;
	/** Start the 10-minute technician-callback SLA clock. */
	startSlaClock: boolean;
}

/**
 * The three cases, verbatim:
 *  1. Emergency (any hour): text the tech + start SLA, and DO NOT draft a customer reply.
 *  2. Non-emergency, off-hours: draft a [DEFERRED] customer reply; do NOT wake the tech.
 *  3. Non-emergency, working hours: draft a customer reply; do NOT text the tech.
 */
export function decideRouting(input: {
	messageCategory: MessageCategory;
	isOffHours: boolean;
}): RoutingDecision {
	if (input.messageCategory === 'emergency') {
		return {
			dispatchToTech: true,
			draftCustomerReply: false,
			deferred: false,
			startSlaClock: true
		};
	}
	return {
		dispatchToTech: false,
		draftCustomerReply: true,
		deferred: input.isOffHours,
		startSlaClock: false
	};
}

/**
 * The orchestrator's fallback office-hours test, used when no location office-hours are configured.
 * Open Mon–Fri, [openHour, closeHour) in the clock of the `now` Date. Returns true when OUTSIDE
 * that window (weekend or before open / at-or-after close).
 */
export function isOffHours(
	now: Date,
	opts: { openHour?: number; closeHour?: number } = {}
): boolean {
	const day = now.getDay(); // 0 = Sunday … 6 = Saturday
	if (day === 0 || day === 6) return true;
	const hour = now.getHours();
	return hour < (opts.openHour ?? 9) || hour >= (opts.closeHour ?? 17);
}
