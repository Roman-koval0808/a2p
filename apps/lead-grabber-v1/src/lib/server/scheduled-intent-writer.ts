// ClearSky Scheduled Intents — dual-record persistence (spec §10).
//
// The customer's message produces TWO records, and they are not copies of each
// other:
//
//   1. Total Trades' record — a factual note on the customer's profile:
//      "Wants to discuss air conditioning. Said he'd call around 18 Aug."
//      It's a fact about THEIR customer, it happened, and Total Trades is
//      entitled to see it whether or not ClearSky ever does anything about it.
//   2. Our record — a ScheduledIntent row: "25 Aug — has Ray been in touch?"
//      It's a PLAN. Plans get cancelled and rescheduled.
//
// They can never be merged: cancelling our own work must not quietly delete the
// customer's words from Total Trades' view of their own pipeline.
//
// The write is one transaction so the two records can't drift apart, keyed by
// idempotencyKey so a double-run can never write (or re-trigger) twice.

import { prisma } from '$lib/db';
import type { ScheduledIntentExtraction } from './ai/scheduled-intent-parser';

/** Scenario A (customer acts): his date plus a week — the grace that lets silence mean something (§3). */
export const CUSTOMER_ACTOR_GRACE_DAYS = 7;
/** Ray: due 25 Aug, expires 8 Sep — two weeks past due, then "don't bother" (§12). */
export const CUSTOMER_ACTOR_EXPIRY_DAYS = 14;
/** Scenario B (we act): his date, nothing added (§6) — but a missed promise expires fast. */
export const BUSINESS_ACTOR_EXPIRY_DAYS = 7;

export interface DualRecordResult {
	recorded: boolean;
	reason?: 'not_schedulable' | 'already_exists';
	/** The CRM note id (Total Trades' record), when one was written. */
	noteId?: string;
	/** The ScheduledIntent row id (our record). */
	scheduledIntentId?: string;
	dueAt?: string;
	expiresAt?: string | null;
}

export async function writeScheduledIntent(opts: {
	companyId: string;
	/** Contact.id — required for the CRM note; null when the customer is unidentified. */
	contactId: string | null;
	/** The customer's profile id the schedule row is filed under. */
	profileId: string;
	extraction: ScheduledIntentExtraction;
	/** The channel the customer used (email | sms | voice | web) — for the CRM note's type. */
	channel?: 'email' | 'sms' | 'voice' | 'web';
	/** Where the customer reached us on that channel — kept so the §11 fallback can reach them later. */
	originalTarget?: string | null;
	conversationId?: string | null;
	reference?: Date;
	idempotencyKey: string;
}): Promise<DualRecordResult> {
	const { extraction } = opts;
	// The §4 confidence gate: if the extraction isn't schedulable, nothing is written.
	if (!extraction.schedulable || !extraction.calculatedTargetDate) {
		return { recorded: false, reason: 'not_schedulable' };
	}

	const reference = opts.reference ?? new Date();
	const target = new Date(extraction.calculatedTargetDate);
	const isCustomerActing = extraction.actor === 'CUSTOMER';

	// Scenario A: his date + 7 days. Scenario B: his date, nothing added.
	const dueAt = new Date(target);
	if (isCustomerActing) dueAt.setDate(dueAt.getDate() + CUSTOMER_ACTOR_GRACE_DAYS);
	const expiresAt = new Date(dueAt);
	expiresAt.setDate(expiresAt.getDate() + (isCustomerActing ? CUSTOMER_ACTOR_EXPIRY_DAYS : BUSINESS_ACTOR_EXPIRY_DAYS));

	return prisma.$transaction(async (tx) => {
		const existing = await tx.scheduledIntent.findUnique({
			where: { idempotencyKey: opts.idempotencyKey },
			select: { id: true, dueAt: true, expiresAt: true }
		});
		if (existing) {
			// Already recorded — never write the note or a second row on a re-run.
			return {
				recorded: false,
				reason: 'already_exists',
				scheduledIntentId: existing.id,
				dueAt: existing.dueAt.toISOString(),
				expiresAt: existing.expiresAt ? existing.expiresAt.toISOString() : null
			};
		}

		const intent = await tx.scheduledIntent.create({
			data: {
				clientId: opts.companyId,
				profileId: opts.profileId,
				intentType: isCustomerActing ? 'CUSTOMER_COMMITMENT_A' : 'CUSTOMER_COMMITMENT_B',
				dueAt,
				expiresAt,
				actor: extraction.actor ?? (isCustomerActing ? 'CUSTOMER' : 'BUSINESS'),
				status: 'PENDING',
				idempotencyKey: opts.idempotencyKey,
				payload: {
					whatHeWants: extraction.whatHeWants,
					rawTimeframe: extraction.rawTimeframe,
					calculatedTargetDate: extraction.calculatedTargetDate,
					confidence: extraction.confidence,
					preferredChannel: extraction.preferredChannel,
					// Where and how the customer reached us — without this, a "call me back"
					// intent filed from an email is unreachable when he never gave a number (§11).
					originalChannel: opts.channel ?? null,
					originalTarget: opts.originalTarget ?? null,
					conversationId: opts.conversationId ?? null,
					referenceIso: reference.toISOString()
				}
			}
		});

		let noteId: string | undefined;
		if (opts.contactId) {
			const note = await tx.communicationLog.create({
				data: {
					type: opts.channel ?? 'email',
					direction: 'inbound',
					status: 'success',
					customerId: opts.contactId,
					companyId: opts.companyId,
					summary: crmNoteText(extraction, dueAt),
					content: extraction.rawTimeframe
						? `Said (verbatim): "${extraction.rawTimeframe}"`
						: null,
					metadata: { scheduled_intent_note: true, intentId: intent.id }
				}
			});
			noteId = note.id;
		}

		return {
			recorded: true,
			noteId,
			scheduledIntentId: intent.id,
			dueAt: dueAt.toISOString(),
			expiresAt: expiresAt.toISOString()
		};
	});
}

/**
 * The factual note for Total Trades: what the customer wants, what they said
 * they'd do, and our interpretation of when — marked "around" because the date
 * is ours, not theirs (spec §4 keeps the assumption visible).
 */
export function crmNoteText(extraction: ScheduledIntentExtraction, dueAt: Date): string {
	const what = extraction.whatHeWants?.trim() || 'their plans';
	const method =
		extraction.preferredChannel ||
		(extraction.actor === 'BUSINESS' ? 'we would be in touch' : 'they would be in touch');
	const when = formatShortDate(dueAt);
	return `Wants to discuss ${what}. Said ${method} around ${when}.`;
}

function formatShortDate(d: Date): string {
	return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Toronto' });
}
