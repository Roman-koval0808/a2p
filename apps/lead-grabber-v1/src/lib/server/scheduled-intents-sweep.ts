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
			if (intent.expiresAt && intent.expiresAt <= now) {
				await prisma.scheduledIntent.update({
					where: { id: intent.id },
					data: { status: 'EXPIRED' }
				});
				result.expired++;
				console.log(
					`[schedule-sweep] expired ${intent.id} (${intent.intentType}) — was due ${intent.dueAt.toISOString()}, expired ${intent.expiresAt.toISOString()}`
				);
				continue;
			}

			// §8: the four checks on the trigger date.
			const verdict = await verifyDueIntent(intent);
			if (!verdict.pass) {
				await prisma.scheduledIntent.update({
					where: { id: intent.id },
					data: { status: 'SKIPPED', updatedAt: now }
				});
				result.skipped++;
				console.log(`[schedule-sweep] skipped ${intent.id}: ${verdict.reason}`);
				continue;
			}

			const handoff = await handoffDueIntent(intent, now);
			if (handoff.handedOff) result.handedOff++;
			else console.log(`[schedule-sweep] ${intent.id} not handed off: ${handoff.reason}`);
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
	const inbound = await prisma.communicationLog.findFirst({
		where: {
			companyId: intent.clientId,
			customerId: intent.profileId,
			direction: 'inbound',
			created: { gt: since },
			NOT: {
				metadata: {
					path: ['scheduled_intent_ack'],
					equals: true
				}
			},
			AND: [{ NOT: { metadata: { path: ['scheduled_intent_note'], equals: true } } }]
		},
		select: { id: true, created: true }
	});
	if (inbound) return { pass: false, reason: 'customer_contacted_since' };

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
