// The single door through which a customer commitment may be marked resolved.
//
// A promise is one person's, and it is kept by THAT person getting in touch on or after the date
// they named. Sam said he'd ring in two weeks; Bert emailing about the same product an hour later
// is a different customer and a different conversation, and it must not touch Sam's row.
//
// Every automated skip goes through `skipIntent`. It re-reads the row inside the write and refuses
// unless both hold:
//
//   1. the row belongs to the profile being credited  — no cross-customer resolution, ever
//   2. its due date has arrived                       — a promise cannot be "kept" before its date
//
// The checks live in the UPDATE's own WHERE clause, so they hold even against a caller that passes
// the wrong ids, and even if two run concurrently.
//
// Any refusal logs a stack trace. If something in this codebase is still resolving a row it has no
// business touching, the next occurrence names the file and line rather than costing another round
// of guessing.

import { prisma } from '$lib/db';

export interface SkipIntentInput {
	intentId: string;
	/** The company the row must belong to. */
	companyId: string;
	/** The profile being credited with keeping the promise. Must own the row. */
	profileId: string;
	/** Why — goes in the log so a skipped row can be explained later. */
	reason: string;
	/**
	 * Require the promised date to have arrived.
	 *
	 * True for the daily sweep, which is asking "the date came — did he ever get in touch?".
	 * False when THIS person has just contacted us: someone who said "in two weeks" and rings on
	 * day one has still done what they said, and the row should close rather than sit pending and
	 * then nag them.
	 */
	requireDue?: boolean;
	/** An intent whose own trigger this is — never let a promise cancel itself. */
	excludeIdempotencyKey?: string;
	/**
	 * Why it closed, in the customer's terms — merged into the row's payload so the board can show
	 * "skipped because …" against the original promise instead of spawning a separate task.
	 */
	resolution?: { label: string; detail?: string | null };
	now?: Date;
}

export interface SkipIntentResult {
	skipped: boolean;
	reason: string;
}

/**
 * Mark one commitment resolved. Returns `{ skipped: false }` — without throwing — when the row
 * doesn't qualify, so a sweep can carry on with the rest.
 */
export async function skipIntent(input: SkipIntentInput): Promise<SkipIntentResult> {
	const now = input.now ?? new Date();

	const res = await prisma.scheduledIntent.updateMany({
		where: {
			id: input.intentId,
			clientId: input.companyId,
			status: 'PENDING',
			// Guard 1 — the row must belong to this person. Equality, never a phone/email lookup
			// that could widen to somebody else's record.
			profileId: input.profileId,
			// Guard 2 — for the sweep only: the date they named must have arrived.
			...(input.requireDue === false ? {} : { dueAt: { lte: now } }),
			// Guard 3 — a promise can never be resolved by the very communication that created it.
			...(input.excludeIdempotencyKey
				? { idempotencyKey: { not: input.excludeIdempotencyKey } }
				: {})
		},
		data: { status: 'SKIPPED', updatedAt: now }
	});

	// Record WHY on the row itself. A promise that simply goes grey tells a rep nothing; the point
	// of closing it is the reason it closed.
	if (res.count > 0 && input.resolution) {
		try {
			const row = await prisma.scheduledIntent.findUnique({
				where: { id: input.intentId },
				select: { payload: true }
			});
			const payload = ((row?.payload as Record<string, unknown>) || {}) as Record<string, unknown>;
			await prisma.scheduledIntent.update({
				where: { id: input.intentId },
				data: {
					payload: {
						...payload,
						resolutionLabel: input.resolution.label,
						resolutionDetail: input.resolution.detail ?? null,
						resolvedAt: now.toISOString()
					} as any
				}
			});
		} catch (e) {
			console.warn('[intent-resolution] Could not record the resolution reason:', e);
		}
	}

	if (res.count === 0) {
		// Not an error — the row may simply have been claimed by a concurrent run. But if a caller
		// is trying to resolve a row it doesn't own, or one that isn't due, this is where we find
		// out, with the call site attached.
		const row = await prisma.scheduledIntent.findUnique({
			where: { id: input.intentId },
			select: { profileId: true, status: true, dueAt: true, clientId: true }
		});

		let why = 'already_resolved_or_missing';
		if (row) {
			if (row.status !== 'PENDING') why = `status_is_${row.status}`;
			else if (row.clientId !== input.companyId) why = 'wrong_company';
			else if (row.profileId !== input.profileId)
				why = `wrong_profile (row=${row.profileId}, caller=${input.profileId})`;
			else if (input.requireDue !== false && row.dueAt > now)
				why = `not_due_until_${row.dueAt.toISOString()}`;
		}

		if (why.startsWith('wrong_profile')) {
			console.error(
				`[intent-resolution] REFUSED to skip ${input.intentId}: ${why}. ` +
					`Reason given: "${input.reason}". Call site below.`
			);
			console.trace('[intent-resolution] refused skip originated here');
		}

		return { skipped: false, reason: why };
	}

	console.log(
		`[intent-resolution] ${input.intentId} → SKIPPED for ${input.profileId} (${input.reason})`
	);
	return { skipped: true, reason: input.reason };
}


/** A promise that was just closed, with the context needed to interpret the new message. */
export interface ClosedCommitment {
	intentId: string;
	/** When the promise was made — the original call. */
	promisedAt: Date;
	/** His words about timing ("a couple of weeks"). */
	promise: string;
	/** What the original call was about. */
	topic: string;
	/** The container the original conversation lives in, when known. */
	conversationId: string | null;
}

/**
 * The promises this person currently has open — read only, nothing is closed.
 *
 * Separate from closing them because the decision now depends on WHAT they said: a customer who
 * rang about a leaking tap has not withdrawn his furnace enquiry, so that promise must survive.
 * The caller reads the message against these, then closes only what the message actually resolves.
 */
export async function findOpenCommitments(input: {
	companyId: string;
	profileId: string;
	/** The communication that triggered this — excluded, so a promise can't resolve itself. */
	excludeIdempotencyKey?: string;
}): Promise<ClosedCommitment[]> {
	const rows = await prisma.scheduledIntent.findMany({
		where: {
			clientId: input.companyId,
			profileId: input.profileId,
			status: 'PENDING',
			intentType: 'CUSTOMER_COMMITMENT_A',
			...(input.excludeIdempotencyKey
				? { idempotencyKey: { not: input.excludeIdempotencyKey } }
				: {})
		},
		select: { id: true, payload: true, createdAt: true },
		take: 20
	});

	return rows.map((row) => {
		const p = (row.payload as Record<string, any>) || {};
		return {
			intentId: row.id,
			promisedAt: row.createdAt,
			promise: p.rawTimeframe || p.whatHeWants || '',
			topic: p.whatHeWants || '',
			conversationId: p.conversationId ?? null
		};
	});
}

/**
 * This person just got in touch. Close the promises THEY made — and nobody else's.
 *
 * Scoped by `profileId` equality, so a different customer asking about the same product can never
 * reach these rows. That widening (matching any contact by phone or email) is what let one
 * customer's email cancel another's callback.
 */
export async function resolveOwnCommitments(input: {
	companyId: string;
	profileId: string;
	/** The communication that triggered this — excluded, so a promise can't cancel itself. */
	excludeIdempotencyKey?: string;
	/** Why they closed — recorded on each row. */
	resolution?: { label: string; detail?: string | null };
	now?: Date;
}): Promise<ClosedCommitment[]> {
	const now = input.now ?? new Date();

	const open = await prisma.scheduledIntent.findMany({
		where: {
			clientId: input.companyId,
			profileId: input.profileId,
			status: 'PENDING',
			intentType: 'CUSTOMER_COMMITMENT_A'
		},
		// The payload carries what he promised and what it was about — the caller needs both to
		// ask "is this new message about that?" (§2.1).
		select: { id: true, payload: true, createdAt: true },
		take: 20
	});
	if (open.length === 0) return [];

	const closed: ClosedCommitment[] = [];
	for (const row of open) {
		const out = await skipIntent({
			intentId: row.id,
			companyId: input.companyId,
			profileId: input.profileId,
			reason: 'customer_got_in_touch',
			requireDue: false,
			excludeIdempotencyKey: input.excludeIdempotencyKey,
			resolution: input.resolution,
			now
		});
		if (!out.skipped) continue;
		const p = (row.payload as Record<string, any>) || {};
		closed.push({
			intentId: row.id,
			promisedAt: row.createdAt,
			promise: p.rawTimeframe || p.whatHeWants || '',
			topic: p.whatHeWants || '',
			conversationId: p.conversationId ?? null
		});
	}
	return closed;
}


/**
 * Attach the reason to a promise that has already closed.
 *
 * The reading of the customer's new message only exists AFTER the row is closed, so the label is
 * written in a second step. The board renders it as "skipped because …" beneath the original
 * promise — one row telling the whole story, rather than a closed row plus a separate task.
 */
export async function recordResolution(
	intentId: string,
	label: string,
	detail?: string | null
): Promise<void> {
	try {
		const row = await prisma.scheduledIntent.findUnique({
			where: { id: intentId },
			select: { payload: true }
		});
		const payload = ((row?.payload as Record<string, unknown>) || {}) as Record<string, unknown>;
		await prisma.scheduledIntent.update({
			where: { id: intentId },
			data: {
				payload: {
					...payload,
					resolutionLabel: label,
					resolutionDetail: detail ?? null,
					resolvedAt: new Date().toISOString()
				} as any
			}
		});
	} catch (e) {
		console.warn(`[intent-resolution] Could not record the reason on ${intentId}:`, e);
	}
}
