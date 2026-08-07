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
			// Guard 2 — the date they named must have arrived. Contact before it is part of the
			// conversation that made the promise, not the promise being kept.
			dueAt: { lte: now }
		},
		data: { status: 'SKIPPED', updatedAt: now }
	});

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
			else if (row.dueAt > now) why = `not_due_until_${row.dueAt.toISOString()}`;
		}

		if (why.startsWith('wrong_profile') || why.startsWith('not_due_until')) {
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
