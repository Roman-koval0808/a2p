// Scenario B — "call me when I'm back" (clearsky-recontact-and-callback.md §3).
//
// He named the date and asked US to ring. So we ring on that date, and if we don't get him we ring
// again tomorrow, and the day after, until we actually speak to him. This is the half of stated
// intent that was never built: mode B fired once and gave up.
//
// Two things make it harder than a loop:
//
//   1. Reaching his voicemail is not reaching him. A twelve-second connected call is either "not
//      now, thanks" or his answering machine, and we cannot tell from the fact of connection.
//   2. It has to stop. After MAX_ATTEMPTS it is no longer automation's problem — a person decides
//      whether to keep trying, and gets the attempt history to decide with.
//
// Attempts are a QUEUE, not a watcher: each one either succeeds or schedules tomorrow's. Nothing
// sits in memory between them, which is the rule both scheduled-intent specs insist on.

import { prisma } from '$lib/db';
import { getLineType } from './number-lookup';
import { isExclusiveLine } from './profiledb/tiers';

/**
 * How many days running we try before handing it to a person.
 *
 * ⚠️ PROPOSED — §6.2 is open with Rory. Five working days is a week of trying, which feels like
 * the point at which continuing is a judgement rather than a rule.
 */
export const MAX_ATTEMPTS = 5;

/**
 * Seconds of connected call below which we assume we got an answering machine rather than him.
 *
 * ⚠️ PROPOSED — §6.3 is open with Rory. A greeting plus our message runs ~15–25s; a real
 * conversation almost always runs longer. This WILL be wrong sometimes in both directions, which
 * is why MAX_ATTEMPTS exists as the backstop.
 */
export const MIN_CONNECT_SECONDS = 20;

export interface ReachedResult {
	reached: boolean;
	reason: string;
}

/**
 * Did we actually speak to them since the promise was made?
 *
 * Counts either direction: our call that connected for long enough, or them ringing us back — if
 * he calls in himself, the obligation is discharged however it happened.
 */
export async function haveWeReachedThem(input: {
	companyId: string;
	contactId: string;
	since: Date;
}): Promise<ReachedResult> {
	const calls = await prisma.communicationLog.findMany({
		where: {
			companyId: input.companyId,
			customerId: input.contactId,
			type: 'voice',
			created: { gt: input.since }
		},
		select: { direction: true, duration: true, metadata: true, created: true },
		orderBy: { created: 'desc' },
		take: 20
	});

	for (const c of calls) {
		// They rang us. However that happened, we are talking again.
		if (c.direction === 'inbound') {
			return { reached: true, reason: 'customer_called_us' };
		}

		const meta = (c.metadata as Record<string, any> | null) || {};

		// Telnyx told us outright that a machine answered — the most reliable signal available.
		if (meta.machine_detection === 'machine' || meta.answered_by === 'machine') continue;
		// Our own voicemail-drop paths mark themselves.
		if (meta.voicemail_left === true || meta.left_voicemail === true) continue;

		const seconds = typeof c.duration === 'number' ? c.duration : 0;
		if (seconds >= MIN_CONNECT_SECONDS) {
			return { reached: true, reason: `spoke_for_${seconds}s` };
		}
	}

	return { reached: false, reason: 'no_conversation_yet' };
}

/** Attempts already made against this promise, from its payload. */
export function attemptsSoFar(payload: unknown): number {
	const p = (payload as Record<string, unknown>) || {};
	const n = p.callbackAttempts;
	return typeof n === 'number' && n >= 0 ? n : 0;
}

export interface NextAttemptDecision {
	action: 'try_again' | 'stop_reached' | 'stop_exhausted';
	attempt: number;
	/** When to try next — only for 'try_again'. */
	nextAt: Date | null;
	reason: string;
}

/**
 * What to do after an attempt: try tomorrow, stop because we got them, or stop because we have
 * tried enough and a person should decide.
 */
export function decideNextAttempt(input: {
	reached: ReachedResult;
	attemptsSoFar: number;
	now?: Date;
}): NextAttemptDecision {
	const now = input.now ?? new Date();
	const attempt = input.attemptsSoFar + 1;

	if (input.reached.reached) {
		return {
			action: 'stop_reached',
			attempt: input.attemptsSoFar,
			nextAt: null,
			reason: input.reached.reason
		};
	}

	if (attempt >= MAX_ATTEMPTS) {
		return {
			action: 'stop_exhausted',
			attempt,
			nextAt: null,
			reason: `no_answer_after_${attempt}_attempts`
		};
	}

	// Tomorrow, same time. Not "in 24 hours" — a promise to ring back is a daytime obligation, and
	// the sweep runs pre-shift in the client's own timezone.
	const nextAt = new Date(now);
	nextAt.setDate(nextAt.getDate() + 1);

	return { action: 'try_again', attempt, nextAt, reason: 'no_answer' };
}


export interface AutoDialVerdict {
	allowed: boolean;
	reason: string;
}

/**
 * May we ring this person automatically at all? (§3.5)
 *
 * A shared line — landline, VoIP, toll-free — identifies a handset, not a person. Auto-dialling one
 * means ringing an office or a household and asking for somebody whose identity we never
 * established. That is a task for a human, not a message send.
 *
 * The doc calls this "the row most likely to be skipped in a build, because it looks like an edge
 * case and isn't: every landline caller who never gave a mobile or an email lands here."
 *
 * An email on file is enough to proceed — they are Tier 1, so the person is resolved even though
 * the line isn't.
 */
export async function canAutoDial(input: {
	companyId: string;
	contactId: string;
}): Promise<AutoDialVerdict> {
	const contact = await prisma.contact.findFirst({
		where: { id: input.contactId, companyId: input.companyId },
		select: { phone: true, email: true, cell: true }
	});

	if (!contact) return { allowed: false, reason: 'contact_not_found' };
	// An exclusive identifier resolves the person, whatever line they rang from.
	if (contact.email?.trim()) return { allowed: true, reason: 'email_on_file' };
	if (contact.cell?.trim()) return { allowed: true, reason: 'mobile_on_file' };

	const phone = contact.phone?.trim();
	if (!phone) return { allowed: false, reason: 'nothing_to_dial' };

	const lineType = await getLineType(phone);
	if (isExclusiveLine(lineType)) return { allowed: true, reason: `line_is_${lineType}` };

	// Landline, VoIP, toll-free — or a lookup we could not complete. Never default upward.
	return { allowed: false, reason: `shared_line_${lineType}` };
}
