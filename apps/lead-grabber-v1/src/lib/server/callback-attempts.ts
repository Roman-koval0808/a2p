// Scenario B — "call me when I'm back" (clearsky-recontact-and-callback.md §3).
//
// Joe named the window and asked US to ring. So we ring on the day, and if we don't get him we ring
// again tomorrow, and the day after, "until we make contact". This is the half of stated intent
// that was never built: mode B fired once and gave up.
//
// Two things make it harder than a loop:
//
//   1. Reaching his voicemail is not reaching him. A twelve-second connected call is either "not
//      now, thanks" or his answering machine, and the fact of connection cannot tell them apart.
//   2. Every attempt has to be recallable. When this stops being automation and becomes somebody's
//      judgement, that person needs to see what we already tried.
//
// Attempts are a QUEUE, not a watcher: each one either succeeds or schedules tomorrow's. Nothing
// sits in memory between them, which is the rule both scheduled-intent specs insist on.

import { prisma } from '$lib/db';
import { getLineType } from './number-lookup';
import { isExclusiveLine } from './profiledb/tiers';

/**
 * Seconds of connected call below which we assume we got an answering machine rather than him.
 *
 * ⚠️ PROPOSED — §6.3 is open with Rory. A greeting plus our message runs ~15–25s; a real
 * conversation almost always runs longer. This WILL be wrong in both directions.
 */
export const MIN_CONNECT_SECONDS = 20;

export interface ReachedResult {
	reached: boolean;
	reason: string;
	/** When contact happened, for the history. */
	at?: Date;
}

/**
 * Did we actually speak to them since the promise was made?
 *
 * Counts either direction: our call that connected for long enough, or them ringing us back — if
 * he calls in himself the obligation is discharged, however it happened.
 *
 * `since` is the moment the PROMISE was made, not the moment this attempt row was created. Each
 * retry is a fresh row, so keying off `createdAt` would narrow the window to the last 24 hours and
 * forget a conversation we had on attempt one.
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
			return { reached: true, reason: 'customer_called_us', at: c.created ?? undefined };
		}

		const meta = (c.metadata as Record<string, any> | null) || {};

		// Telnyx told us outright that a machine answered — the most reliable signal available,
		// and the only one that is not a guess. Checked before the duration so a long message
		// left on an answering service can never be read as a conversation.
		if (meta.machine_detection === 'machine' || meta.answered_by === 'machine') continue;
		// Our own voicemail-drop paths mark themselves.
		if (meta.voicemail_left === true || meta.left_voicemail === true) continue;

		const seconds = typeof c.duration === 'number' ? c.duration : 0;
		if (seconds >= MIN_CONNECT_SECONDS) {
			return { reached: true, reason: `spoke_for_${seconds}s`, at: c.created ?? undefined };
		}
	}

	return { reached: false, reason: 'no_conversation_yet' };
}

/** One attempt, as it is recorded on the promise for the next person to read. */
export interface CallbackAttempt {
	n: number;
	at: string;
	outcome: string;
}

export interface CallbackTrail {
	/** The id of the promise this chain started from — every retry keeps pointing at it. */
	rootIntentId: string | null;
	/** When the promise was made. The window `haveWeReachedThem` searches. */
	promiseSince: string | null;
	attempts: CallbackAttempt[];
}

/**
 * Read the attempt trail off a promise's payload.
 *
 * Older rows carry only a `callbackAttempts` counter — read it as a trail of that many unrecorded
 * attempts so a promise written before this shipped still reports a truthful count.
 */
export function readTrail(payload: unknown): CallbackTrail {
	const p = (payload as Record<string, any>) || {};
	const attempts = Array.isArray(p.callbackAttempts_history) ? p.callbackAttempts_history : null;
	if (attempts) {
		return {
			rootIntentId: p.rootIntentId ?? null,
			promiseSince: p.promiseSince ?? null,
			attempts: attempts as CallbackAttempt[]
		};
	}

	const legacy = typeof p.callbackAttempts === 'number' && p.callbackAttempts > 0 ? p.callbackAttempts : 0;
	return {
		rootIntentId: p.rootIntentId ?? null,
		promiseSince: p.promiseSince ?? null,
		attempts: Array.from({ length: legacy }, (_, i) => ({
			n: i + 1,
			at: 'unrecorded',
			outcome: 'no_answer'
		}))
	};
}

export function attemptsSoFar(payload: unknown): number {
	return readTrail(payload).attempts.length;
}

/** Human-readable history, for the task that a person picks up (§3.3). */
export function describeTrail(trail: CallbackTrail): string {
	if (!trail.attempts.length) return 'no attempts yet';
	return trail.attempts
		.map((a) => `#${a.n} ${a.at === 'unrecorded' ? 'date not recorded' : a.at.slice(0, 10)} — ${a.outcome}`)
		.join('; ');
}

export interface NextAttemptDecision {
	action: 'try_again' | 'stop_reached';
	/** The attempt being made right now. */
	attempt: number;
	/** When to try next — only for 'try_again'. */
	nextAt: Date | null;
	reason: string;
}

/**
 * What to do after an attempt: stop because we got him, or try again tomorrow.
 *
 * There is no attempt cap. The instruction is "we keep trying until we make contact", and the
 * bound is the promise's own `expiresAt` — a date the writer set because only it knew the shelf
 * life. An expired mode-B promise is a service failure and is reported as one (§3.4); it is not a
 * loop quietly running out of patience.
 *
 * (This departs from spec §3.3, which stops after N attempts and hands to a human. §6.2 — the
 * value of N — was never answered, and the instruction we are building to is explicit. Raised in
 * the history entry rather than decided here.)
 */
export function decideNextAttempt(input: {
	reached: ReachedResult;
	attemptsSoFar: number;
	now?: Date;
}): NextAttemptDecision {
	const now = input.now ?? new Date();

	if (input.reached.reached) {
		// "Once we reach him we remove the condition that we need to call each day."
		return {
			action: 'stop_reached',
			attempt: input.attemptsSoFar,
			nextAt: null,
			reason: input.reached.reason
		};
	}

	// Tomorrow, same time. Not "in 24 hours" — a promise to ring back is a daytime obligation, and
	// the sweep runs pre-shift in the client's own timezone.
	const nextAt = new Date(now);
	nextAt.setDate(nextAt.getDate() + 1);

	return { action: 'try_again', attempt: input.attemptsSoFar + 1, nextAt, reason: 'no_answer' };
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
