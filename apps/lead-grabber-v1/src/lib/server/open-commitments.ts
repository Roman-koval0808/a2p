// ClearSky Scheduled Intents — open commitments (spec §7).
//
// While a customer has an open commitment, they are taken out of decay and out
// of every kind of nudging: score decay, cold-category demotion, automatic
// nurture emails, keep-in-touch messages. Ray said on the 4th he'd call in a
// couple of weeks; chasing him inside that window reads as "they weren't
// listening" — the exact opposite of the point. This extends the already-locked
// rule that someone with a booking doesn't need chasing.
//
// What counts as an open commitment (spec §7):
//   - A booked appointment
//   - Something the customer said they'd do, with a date on it (a pending
//     ScheduledIntent row with a future dueAt)
//   - A job in progress / outstanding quote (an open Transaction)
//
// The EXCEPTION: things we owe the customer still go out — a service reminder
// firing because a warranty expires has nothing to do with a conversation about
// air conditioning. Marketing goes quiet; obligations don't.

import { prisma } from '$lib/db';


export interface CommitmentWindow {
	kind: 'appointment' | 'scheduled_intent' | 'transaction';
	startedAt: Date;
	/** When the commitment resolves. null = no date named (e.g. a quote) — nothing to subtract. */
	resolvesAt: Date | null;
}

export interface OpenCommitment {
	kind: CommitmentWindow['kind'];
	id: string;
}

/**
 * What the customer is currently committed to, per profile (Contact.id).
 * `dueAt >= now` keeps rows pending-but-not-yet-due out of the decay maths until
 * their date actually arrives.
 */
export async function getOpenCommitments(
	profileId: string,
	now: Date = new Date()
): Promise<OpenCommitment[]> {
	const [appointments, intents, transactions] = await Promise.all([
		prisma.appointment.findMany({
			where: {
				contactId: profileId,
				status: 'booked',
				OR: [{ endTime: null }, { endTime: { gte: now } }]
			},
			select: { id: true },
			take: 20
		}),
		prisma.scheduledIntent.findMany({
			where: {
				profileId,
				status: 'PENDING',
				// Only rows that represent something the CUSTOMER said they'd do. Our own
				// planned nudges (KEEP_IN_TOUCH, SERVICE_RECALL, REVIEW_REQUEST…) must not
				// suppress decay or marketing — they ARE the nudges.
				intentType: { in: ['CUSTOMER_COMMITMENT_A', 'CUSTOMER_COMMITMENT_B'] },
				dueAt: { gt: now }
			},
			select: { id: true },
			take: 20
		}),
		prisma.transaction.findMany({
			where: { contactId: profileId, status: 'open' },
			select: { id: true },
			take: 20
		})
	]);

	return [
		...appointments.map((a) => ({ kind: 'appointment' as const, id: a.id })),
		...intents.map((i) => ({ kind: 'scheduled_intent' as const, id: i.id })),
		...transactions.map((t) => ({ kind: 'transaction' as const, id: t.id }))
	];
}

export async function hasOpenCommitment(profileId: string, now: Date = new Date()): Promise<boolean> {
	const commitments = await getOpenCommitments(profileId, now);
	return commitments.length > 0;
}

/**
 * The committed windows, with their dates, for the decay correction (§7).
 * Each window is "the days he told us about": from when the commitment started
 * (or the customer last contacted us, whichever is later) to when it resolves.
 */
export async function getCommitmentWindows(
	profileId: string,
	now: Date = new Date()
): Promise<CommitmentWindow[]> {
	const [appointments, intents, transactions] = await Promise.all([
		prisma.appointment.findMany({
			where: {
				contactId: profileId,
				status: 'booked',
				OR: [{ endTime: null }, { endTime: { gte: now } }]
			},
			select: { id: true, created: true, endTime: true },
			take: 20
		}),
		prisma.scheduledIntent.findMany({
			where: {
				profileId,
				status: 'PENDING',
				intentType: { in: ['CUSTOMER_COMMITMENT_A', 'CUSTOMER_COMMITMENT_B'] },
				dueAt: { gt: now }
			},
			select: { id: true, createdAt: true, dueAt: true },
			take: 20
		}),
		prisma.transaction.findMany({
			where: { contactId: profileId, status: 'open' },
			select: { id: true, created: true },
			take: 20
		})
	]);

	return [
		...appointments.map((a) => ({
			kind: 'appointment' as const,
			startedAt: a.created,
			resolvesAt: a.endTime
		})),
		...intents.map((i) => ({
			kind: 'scheduled_intent' as const,
			startedAt: i.createdAt,
			resolvesAt: i.dueAt
		})),
		...transactions.map((t) => ({
			kind: 'transaction' as const,
			startedAt: t.created,
			resolvesAt: null
		}))
	];
}

/**
 * The days the customer told us about, to subtract from the inactivity count.
 *
 * Not a freeze on the record — a correction to the sum (spec §7 "Decay: We Don't
 * Count the Days He Told Us About"). The score is supposed to measure interest,
 * and Ray telling us his plan IS interest; he isn't going cold, he's on holiday.
 * The moment the commitment resolves, the clock runs normally again.
 *
 * Each window contributes min(resolvesAt, now) − max(startedAt, lastEventAt),
 * floored at 0 — a window that started before we last heard from them only
 * covers the period from last contact, and a window still in the future covers
 * up to now. Windows with no resolve date (a quote) contribute nothing to the
 * subtraction but still suppress nudging.
 */
export function committedWindowDays(
	windows: CommitmentWindow[],
	lastEventAt: Date,
	now: Date = new Date()
): number {
	let totalMs = 0;
	for (const w of windows) {
		if (!w.resolvesAt) continue;
		const end = Math.min(w.resolvesAt.getTime(), now.getTime());
		const start = Math.max(w.startedAt.getTime(), lastEventAt.getTime());
		if (end > start) totalMs += end - start;
	}
	return Math.round(totalMs / 86_400_000);
}

/**
 * Effective inactive days after subtracting every committed window. The number
 * the decay maths should run on.
 */
export function effectiveInactiveDays(
	lastEventAt: Date,
	windows: CommitmentWindow[],
	now: Date = new Date()
): number {
	const rawDays = Math.max(0, (now.getTime() - lastEventAt.getTime()) / 86_400_000);
	const windowed = rawDays - committedWindowDays(windows, lastEventAt, now);
	return Math.max(0, Math.round(windowed * 10) / 10);
}

/**
 * §7 gate for nurture-style sends: marketing and keep-in-touch go quiet while a
 * commitment is open; obligations (service reminders) always fire.
 *
 * `kind` is the message being considered: 'nurture' | 'keep_in_touch' | 'service_reminder'.
 */
export async function shouldSuppressMarketing(
	profileId: string,
	kind: 'nurture' | 'keep_in_touch' | 'service_reminder',
	now: Date = new Date()
): Promise<boolean> {
	if (kind === 'service_reminder') return false;
	return hasOpenCommitment(profileId, now);
}
