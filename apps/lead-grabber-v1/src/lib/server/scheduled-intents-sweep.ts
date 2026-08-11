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
}

export async function checkDueScheduledIntents(
	now: Date = new Date()
): Promise<ScheduledIntentSweepResult> {
	const result: ScheduledIntentSweepResult = { due: 0, handedOff: 0, skipped: 0, expired: 0, failed: 0 };

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
			// promise, so after the attempt is queued we decide whether to try again tomorrow
			// (clearsky-recontact-and-callback.md §3.1–3.3).
			if (intent.actor === 'BUSINESS') {
				const { haveWeReachedThem, decideNextAttempt, attemptsSoFar, canAutoDial } =
					await import('./callback-attempts');

				// §3.5 — we cannot ring a shared line and ask for a person we never identified.
				// That is a task for a human, and it is a different kind of work from a send.
				const dialable = await canAutoDial({
					companyId: intent.clientId,
					contactId: intent.profileId
				});
				if (!dialable.allowed) {
					await handoffDueIntent(intent, now);
					await prisma.scheduledIntent.updateMany({
						where: { id: intent.id, status: 'PENDING' },
						data: { status: 'DONE', updatedAt: now }
					});
					result.handedOff++;
					console.log(
						`[schedule-sweep] ${intent.id} not auto-dialable (${dialable.reason}) — ` +
							`handed to a human, no automated attempts`
					);
					continue;
				}

				const reached = await haveWeReachedThem({
					companyId: intent.clientId,
					contactId: intent.profileId,
					since: intent.createdAt
				});
				const decision = decideNextAttempt({
					reached,
					attemptsSoFar: attemptsSoFar(intent.payload),
					now
				});

				if (decision.action === 'stop_reached') {
					// We spoke to him. The obligation is discharged; nothing further is scheduled.
					await prisma.scheduledIntent.updateMany({
						where: { id: intent.id, status: 'PENDING' },
						data: { status: 'DONE', updatedAt: now }
					});
					result.skipped++;
					console.log(`[schedule-sweep] ${intent.id} reached (${decision.reason}) — no more attempts`);
					continue;
				}

				// Not reached: queue today's attempt for the agent, then decide about tomorrow.
				const handoffB = await handoffDueIntent(intent, now);
				if (handoffB.handedOff) result.handedOff++;

				if (decision.action === 'try_again' && decision.nextAt) {
					const payload = ((intent.payload as Record<string, unknown>) || {}) as Record<
						string,
						unknown
					>;
					await prisma.scheduledIntent.create({
						data: {
							clientId: intent.clientId,
							profileId: intent.profileId,
							intentType: intent.intentType,
							actor: 'BUSINESS',
							status: 'PENDING',
							dueAt: decision.nextAt,
							expiresAt: intent.expiresAt,
							idempotencyKey: `${intent.idempotencyKey}_attempt_${decision.attempt + 1}`,
							payload: { ...payload, callbackAttempts: decision.attempt } as any
						}
					});
					console.log(
						`[schedule-sweep] ${intent.id} attempt ${decision.attempt} — no answer, retrying ${decision.nextAt.toISOString()}`
					);
				} else {
					// §3.3: it stops being automation and becomes somebody's judgement.
					console.log(
						`[schedule-sweep] ${intent.id} ${decision.reason} — handed to a human, no further attempts`
					);
				}

				await prisma.scheduledIntent.updateMany({
					where: { id: intent.id, status: 'PENDING' },
					data: { status: 'DONE', updatedAt: now }
				});
				continue;
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
}): Promise<VerificationVerdict> {
	const since = intent.createdAt;

	// 1. Has the customer been in touch since they told us? Our own automated ack and
	//    the CRM note never count — otherwise every follow-up cancels itself (§5).
	//
	//    Deliberately NOT filtered in SQL: `metadata NOT (path = true)` compiles to
	//    `NOT (metadata->'flag' = 'true'::jsonb)`, which is NULL for every row where the
	//    key is absent — so a SQL NOT-filter excludes EVERYTHING, not just the flags.
	//    Fetch the recent rows and exclude the flags in code instead.
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
