// ClearSky Scheduled Intents — daily sweep (spec §2, §8, §12).
//
// Once a day, one job reads the schedule rows that have come due. The table is
// deliberately stupid: it knows WHEN, not WHETHER. When something comes due,
// each row is checked against the four questions — if the answer to any is yes,
// the row is marked SKIPPED and nothing reaches the agent. Rejected work never
// appears in the queue at all, rather than appearing and being killed a second
// later.
//
// Verified intents are handed to the Orchestrator (scheduled-intents-handoff),
// never made into tasks here — the Orchestrator is where the safety rules and
// each client's settings get applied.
//
// Expired rows are MARKED, not deleted (§12): a pile of them is a signal that
// the daily job or the approval queue is falling behind.

import { prisma } from '$lib/db';
import { handoffDueIntent } from './scheduled-intents-handoff';

/**
 * A row as the sweep reads it. Declared here rather than imported from the Prisma client, whose
 * generated types are not available to `svelte-check` in this workspace.
 */
type DueRow = {
	id: string;
	clientId: string;
	profileId: string;
	intentType: any;
	actor: 'CUSTOMER' | 'BUSINESS';
	dueAt: Date;
	expiresAt: Date | null;
	idempotencyKey: string;
	payload: any;
	createdAt: Date;
};

export interface ScheduledIntentSweepResult {
	/** Rows that had come due this run. */
	due: number;
	/** Verified and queued for the Orchestrator. */
	handedOff: number;
	/** A check answered yes — marked SKIPPED, never queued. */
	skipped: number;
	/** Past their expiry — marked EXPIRED. */
	expired: number;
	/** Rows the run failed to process. */
	failed: number;
	/** Mode-B promises discharged because we actually spoke to them. */
	reached: number;
	/** Mode-B promises that expired without us ever making the call — §3.4 service failures. */
	failedPromises: number;
}

export async function checkDueScheduledIntents(
	now: Date = new Date()
): Promise<ScheduledIntentSweepResult> {
	const result: ScheduledIntentSweepResult = {
		due: 0,
		handedOff: 0,
		skipped: 0,
		expired: 0,
		failed: 0,
		reached: 0,
		failedPromises: 0
	};

	const due = await prisma.scheduledIntent.findMany({
		where: { status: 'PENDING', dueAt: { lte: now } },
		orderBy: { dueAt: 'asc' },
		take: 200
	});
	result.due = due.length;

	for (const intent of due) {
		try {
			// §12: a date that passes unserved isn't always still worth serving. The writer
			// set the expiry because only it knew the shelf life. Marked, never deleted.
			// Guarded by status: PENDING so a concurrent runner can't clobber a row the
			// handoff just CAS'd to DONE (the sweep runs in-process AND as an external cron).
			if (intent.expiresAt && intent.expiresAt <= now) {
				const expired = await prisma.scheduledIntent.updateMany({
					where: { id: intent.id, status: 'PENDING' },
					data: { status: 'EXPIRED', updatedAt: now }
				});
				if (expired.count === 0) continue;
				result.expired++;
				console.log(
					`[schedule-sweep] expired ${intent.id} (${intent.intentType}) — was due ${intent.dueAt.toISOString()}, expired ${intent.expiresAt.toISOString()}`
				);
				// §3.4 — a mode-B date that passed without us ringing is OUR broken promise, not a
				// lead going cold. An expired CUSTOMER_COMMITMENT_A row is a customer who never got
				// back to us; an expired B row is a customer who waited for a call we said we would
				// make. They must not look the same in the pile, or the second disappears into the
				// first. Reported as a service failure, with everything we did or didn't try.
				if (intent.actor === 'BUSINESS') {
					result.failedPromises++;
					const { readTrail, describeTrail } = await import('./callback-attempts');
					const trail = readTrail(intent.payload);
					console.error(
						`[schedule-sweep] SERVICE FAILURE — promised callback ${intent.id} expired unmet. ` +
							`Due ${intent.dueAt.toISOString()}, attempts: ${describeTrail(trail)}`
					);
				}
				continue;
			}

			// §8: the four checks on the trigger date.
			const verdict = await verifyDueIntent(intent);
			if (!verdict.pass) {
				// Through the single guarded door: it re-checks that the row belongs to this
				// profile and that its date has arrived, so no caller can resolve one customer's
				// promise with another customer's activity.
				const { skipIntent } = await import('./intent-resolution');
				const outcome = await skipIntent({
					intentId: intent.id,
					companyId: intent.clientId,
					profileId: intent.profileId,
					reason: verdict.reason ?? 'guard_failed',
					now
				});
				if (!outcome.skipped) continue;
				result.skipped++;
				console.log(`[schedule-sweep] skipped ${intent.id}: ${verdict.reason}`);
				continue;
			}

			// Scenario B — "call me when I'm back". Ringing once and giving up is not keeping the
			// promise: we try on the day, and again the next day, until we actually reach him
			// (clearsky-recontact-and-callback.md §3.1–3.3).
			if (intent.actor === 'BUSINESS') {
				const handled = await runCallbackAttempt(intent, now, result);
				if (handled) continue;
			}

			const handoff = await handoffDueIntent(intent, now);
			if (handoff.handedOff) result.handedOff++;
			else if (handoff.reason === 'queue_write_failed') {
				result.failed++;
				console.error(`[schedule-sweep] ${intent.id} queue write failed — will retry next run`);
			} else {
				console.log(`[schedule-sweep] ${intent.id} not handed off: ${handoff.reason}`);
			}
		} catch (e: any) {
			result.failed++;
			console.error(`[schedule-sweep] failed to process ${intent.id}:`, e?.message || e);
		}
	}

	if (result.due) {
		console.log(
			`[schedule-sweep] run complete — due=${result.due} handed_off=${result.handedOff} skipped=${result.skipped} expired=${result.expired} failed=${result.failed}`
		);
	}
	return result;
}

/**
 * One day's callback attempt against a mode-B promise (§3).
 *
 * Returns true when it has fully handled the row, false to fall through to the normal handoff.
 *
 * The shape is a QUEUE, not a loop: today's row is closed and tomorrow's is written, so nothing is
 * held in memory between attempts and a crashed sweep loses at most one day.
 */
async function runCallbackAttempt(
	intent: DueRow,
	now: Date,
	result: ScheduledIntentSweepResult
): Promise<boolean> {
	const { haveWeReachedThem, decideNextAttempt, readTrail, describeTrail, canAutoDial } =
		await import('./callback-attempts');

	const trail = readTrail(intent.payload);
	// The promise date, not this row's — each retry is a new row, so `createdAt` would forget the
	// conversation we had on attempt one. The first row in a chain seeds it from its own creation.
	const promiseSince = trail.promiseSince ? new Date(trail.promiseSince) : intent.createdAt;
	const rootIntentId = trail.rootIntentId ?? intent.id;

	// §3.5 — we cannot ring a shared line and ask for a person we never identified. That is a task
	// for a human, and it is a different kind of work from a send. Checked before anything is
	// dialled, and before any attempt is counted.
	const dialable = await canAutoDial({ companyId: intent.clientId, contactId: intent.profileId });
	if (!dialable.allowed) {
		const handoff = await handoffDueIntent(intent, now);
		if (handoff.handedOff) result.handedOff++;
		console.log(
			`[schedule-sweep] ${intent.id} not auto-dialable (${dialable.reason}) — handed to a human, no automated attempts`
		);
		return true;
	}

	const reached = await haveWeReachedThem({
		companyId: intent.clientId,
		contactId: intent.profileId,
		since: promiseSince
	});
	const decision = decideNextAttempt({ reached, attemptsSoFar: trail.attempts.length, now });

	if (decision.action === 'stop_reached') {
		// "Once we reach him we remove the condition that we need to call each day." The obligation
		// is discharged; no attempt is queued and no tomorrow is written. What happens next is
		// decided by what he said on that call, which is scenario A's re-contact analysis — not
		// this loop's business.
		await prisma.scheduledIntent.updateMany({
			where: { id: intent.id, status: 'PENDING' },
			data: { status: 'DONE', updatedAt: now }
		});
		result.reached++;
		console.log(
			`[schedule-sweep] ${intent.id} reached (${decision.reason}) after ${trail.attempts.length} attempt(s) — daily calling stopped`
		);
		return true;
	}

	// Not reached. Queue today's attempt for the agent — this is the row that carries the COM id
	// of the original conversation, so the whole chase reads as one exchange.
	const handoff = await handoffDueIntent(intent, now);
	if (!handoff.handedOff) {
		if (handoff.reason === 'queue_write_failed') {
			// The row stays PENDING and the next sweep retries it. Writing tomorrow's attempt now
			// would count a call we never actually queued.
			result.failed++;
			console.error(`[schedule-sweep] ${intent.id} attempt queue write failed — will retry next run`);
			return true;
		}
		// already_handled — another runner has this row. Don't double-schedule tomorrow.
		console.log(`[schedule-sweep] ${intent.id} not handed off: ${handoff.reason}`);
		return true;
	}
	result.handedOff++;

	const attempts = [
		...trail.attempts,
		{ n: decision.attempt, at: now.toISOString(), outcome: reached.reason }
	];

	// Tomorrow, unless the promise expires first — `expiresAt` is the only bound on "keep trying",
	// and a row written past it would be marked EXPIRED unread on the next sweep, quietly turning
	// a service failure into a no-op.
	const withinShelfLife = !intent.expiresAt || (decision.nextAt && decision.nextAt < intent.expiresAt);
	if (decision.nextAt && withinShelfLife) {
		await prisma.scheduledIntent.create({
			data: {
				clientId: intent.clientId,
				profileId: intent.profileId,
				intentType: intent.intentType,
				actor: 'BUSINESS',
				status: 'PENDING',
				dueAt: decision.nextAt,
				expiresAt: intent.expiresAt,
				// Keyed off the ROOT, so a re-run of the same day can never fork the chain into
				// two parallel queues of attempts.
				idempotencyKey: `cb_${rootIntentId}_attempt_${decision.attempt + 1}`,
				payload: {
					...((intent.payload as Record<string, unknown>) || {}),
					rootIntentId,
					promiseSince: promiseSince.toISOString(),
					callbackAttempts_history: attempts
				} as any
			}
		});
		console.log(
			`[schedule-sweep] ${intent.id} attempt ${decision.attempt} — no answer, trying again ${decision.nextAt.toISOString()}`
		);
	} else {
		// We ran out of shelf life before we ran out of will. The row expires tomorrow and §3.4
		// reports it as the broken promise it is.
		console.warn(
			`[schedule-sweep] ${intent.id} attempt ${decision.attempt} — no answer and the promise expires ` +
				`${intent.expiresAt?.toISOString()}. History: ${describeTrail({ ...trail, attempts })}`
		);
	}

	await prisma.scheduledIntent.updateMany({
		where: { id: intent.id, status: 'PENDING' },
		data: { status: 'DONE', updatedAt: now }
	});
	return true;
}

export interface VerificationVerdict {
	pass: boolean;
	reason?: string;
}

/**
 * Our own rows never count as the customer getting in touch — the automated ack
 * we sent and the CRM note we wrote would otherwise cancel every follow-up (§5).
 * Note the flags are checked in code, not SQL: a JSONB `NOT (path = true)`
 * filter is NULL for every row where the key is absent, which excludes ALL rows.
 */
export function isAutomatedRow(metadata: unknown): boolean {
	const meta = (metadata ?? {}) as Record<string, unknown>;
	return meta.scheduled_intent_ack === true || meta.scheduled_intent_note === true;
}

/**
 * The four checks on the trigger date (spec §8). If ANY answers yes, the row is
 * skipped — he did what he said, the job moved on, or the customer opted out.
 */
export async function verifyDueIntent(intent: {
	id: string;
	clientId: string;
	profileId: string;
	createdAt: Date;
	actor?: string | null;
}): Promise<VerificationVerdict> {
	const since = intent.createdAt;

	// Check 1 asks "has he been in touch?" — and what that means depends entirely on who owed the
	// move.
	//
	//   Mode A, he said he'd ring us: him ringing IS the thing we were waiting for. Row discharged.
	//   Mode B, he asked US to ring him: him texting "thanks" discharges nothing. We still owe him
	//   the call. Treating any inbound as satisfaction cancels the obligation the moment he
	//   replies to the thank-you SMS we sent him on 1 Aug — which is every scenario-B customer who
	//   is polite.
	//
	// This is why mode B looked built and did nothing: the branch that runs the daily calls sits
	// after this gate, and this gate skipped the rows before they ever got there.
	//
	// A mode-B promise is discharged by an actual conversation, and that is `haveWeReachedThem`'s
	// job, not this one's. The remaining three checks still apply: if he booked, or the job moved
	// on, or he opted out, there is nothing left to ring about.
	const contactDischarges = intent.actor !== 'BUSINESS';

	// 1. Has the customer been in touch since they told us? Our own automated ack and
	//    the CRM note never count — otherwise every follow-up cancels itself (§5).
	//
	//    Deliberately NOT filtered in SQL: `metadata NOT (path = true)` compiles to
	//    `NOT (metadata->'flag' = 'true'::jsonb)`, which is NULL for every row where the
	//    key is absent — so a SQL NOT-filter excludes EVERYTHING, not just the flags.
	//    Fetch the recent rows and exclude the flags in code instead.
	if (contactDischarges) {
		const recentInbound = await prisma.communicationLog.findMany({
			where: {
				companyId: intent.clientId,
				customerId: intent.profileId,
				direction: 'inbound',
				created: { gt: since }
			},
			select: { id: true, metadata: true },
			orderBy: { created: 'desc' },
			take: 5
		});
		const hasRealContact = recentInbound.some((row) => !isAutomatedRow(row.metadata));
		if (hasRealContact) return { pass: false, reason: 'customer_contacted_since' };
	}

	// 2. Has he booked anything since?
	const booked = await prisma.appointment.findFirst({
		where: {
			contactId: intent.profileId,
			status: 'booked',
			created: { gt: since }
		},
		select: { id: true }
	});
	if (booked) return { pass: false, reason: 'booked_appointment' };

	// 3. Has the job moved on or been won since?
	const job = await prisma.transaction.findFirst({
		where: {
			contactId: intent.profileId,
			OR: [
				{ created: { gt: since } },
				{ status: 'closed', jobCompletedAt: { gt: since } }
			]
		},
		select: { id: true }
	});
	if (job) return { pass: false, reason: 'job_moved_on' };

	// 4. Has he opted out since?
	const contact = await prisma.contact.findUnique({
		where: { id: intent.profileId },
		select: { phone: true, cell: true }
	});
	const phone = (contact?.cell || contact?.phone || '').replace(/[^\d+]/g, '');
	if (phone) {
		const optedOut = await prisma.smsConsent.findFirst({
			where: {
				companyId: intent.clientId,
				phone,
				status: 'revoked',
				revokedAt: { gt: since }
			},
			select: { id: true }
		});
		if (optedOut) return { pass: false, reason: 'opted_out' };
	}

	return { pass: true };
}
