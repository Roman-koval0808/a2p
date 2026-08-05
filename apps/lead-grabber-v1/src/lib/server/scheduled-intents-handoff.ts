// ClearSky Scheduled Intents — Orchestrator handoff (spec §2, §9).
//
// The daily job never creates tasks directly — it hands off here, and this is
// what the spec means by "hand to the Orchestrator": the verified intent is
// queued as an approval-gated draft in the SAME consultant/agent queue every
// other orchestrator outcome uses (the `pending_approval` CommunicationLog rows
// job-fulfillment writes for ACT-REV-008 etc.). Safety rules and each client's
// settings gate that queue; nothing skips them. This adds no new door — it
// changes what wakes the existing one up.
//
// The draft is personalised and quotes the customer's own words (spec §9). It
// can never be a batch message: it is written against what THIS customer said.

import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';
import { resolveContactChannel, type ResolvedContactChannel } from './contact-channel-resolver';

export interface HandoffResult {
	handedOff: boolean;
	reason?: 'already_handled' | 'no_contact' | 'queue_write_failed';
	channel?: ResolvedContactChannel;
	queueId?: string;
	draft?: string;
}

/**
 * The personalised follow-up draft (spec §9). Quotes the customer's exact phrase
 * — that's the whole reason we kept it. A generic "just checking in" throws away
 * the only thing that makes it land: evidence we listened.
 */
export function buildFollowUpDraft(intent: {
	actor: 'CUSTOMER' | 'BUSINESS';
	payload: any;
}): string {
	const what = (intent.payload?.whatHeWants || 'it').trim();
	const timeframe = (intent.payload?.rawTimeframe || '').trim();
	const method = (intent.payload?.preferredChannel || '').trim();

	if (intent.actor === 'CUSTOMER') {
		// He said HE'D act. Restate only what he actually said — never why, never "when
		// you're back" (he may not be going anywhere). Works for any trade: air
		// conditioning or a manicure, the sentence is the same.
		const phrase = timeframe ? ` in ${timeframe}` : '';
		const how =
			method === 'call'
				? 'give us a call'
				: method === 'email'
					? 'email us'
					: method === 'sms'
						? 'text us'
						: 'be in touch';
		return `You mentioned you'd ${how} about ${what}${phrase} — thought I'd save you the job…`;
	}

	// Scenario B — they asked us to act; we're honouring a promise, not marketing.
	const when = timeframe ? ` ${timeframe}` : '';
	const channel = method ? ` ${method}` : '';
	return `You asked us to${channel} about ${what}${when} — getting back to you as promised.`;
}

/**
 * Queue the verified intent as an approval-gated draft and mark it done.
 *
 * Ordering matters (review finding): the queue write comes FIRST, the PENDING →
 * DONE claim SECOND. If the queue write fails the row stays PENDING and the next
 * sweep retries it. If the claim then loses the CAS (a concurrent runner already
 * marked it DONE), the just-written draft is deleted — it would be a duplicate.
 * The only remaining hole is a crash between queue write and CAS, which leaves a
 * visible duplicate draft for the human reviewer rather than a silently lost
 * follow-up.
 */
export async function handoffDueIntent(
	intent: {
		id: string;
		clientId: string;
		profileId: string;
		actor: 'CUSTOMER' | 'BUSINESS';
		payload: any;
	},
	now: Date = new Date()
): Promise<HandoffResult> {
	const [contact, company] = await Promise.all([
		prisma.contact.findUnique({
			where: { id: intent.profileId },
			select: { id: true, name: true, cell: true, phone: true, email: true, landline: true }
		}),
		prisma.company.findUnique({ where: { id: intent.clientId }, select: { name: true } })
	]);

	const channel = resolveContactChannel({
		requestedChannel: intent.payload?.preferredChannel ?? null,
		originalChannel: intent.payload?.originalChannel ?? null,
		originalTarget: intent.payload?.originalTarget ?? null,
		mobile: contact?.cell || contact?.phone || null,
		email: contact?.email || null,
		landline: contact?.landline || null
	});

	const draft = buildFollowUpDraft(intent);
	const who = contact?.name?.trim() || 'the customer';
	// A real subject for the email — the summary dialog and the confirm flow both read
	// it, so a confirmed draft never goes out as "No subject" (§9).
	const subject = `About ${(intent.payload?.whatHeWants || 'your message').trim()}`;

	// The agent-facing summary carries the reachability verdict, so the
	// "unreachable / manual call" rows (§11) are visibly work for a person.
	const channelNote =
		channel.outcome === 'unreachable'
			? ` (UNREACHABLE — no usable contact info; ${who} is waiting on us)`
			: channel.outcome === 'manual_call'
				? ` (MANUAL CALL — ${channel.target || 'shared landline'}; ring the office and ask for ${who})`
				: channel.outcome === 'voice'
					? ` (call ${who} on ${channel.target})`
					: '';

	// The CommunicationLog `type` only offers sms/email/voice/web — manual_call and
	// unreachable rows are work for a person, so they land as 'voice' (the metadata
	// carries the exact outcome). email never appears as a type here for a row with
	// a phone-number destination.
	const type: 'sms' | 'email' | 'voice' =
		channel.outcome === 'sms' ? 'sms' : channel.outcome === 'email' ? 'email' : 'voice';

	const queue = await logCommunication({
		type,
		direction: 'outbound',
		status: 'pending_approval',
		destination: channel.target ?? undefined,
		company_id: intent.clientId,
		customer_id: contact?.id ?? intent.profileId,
		summary: `[SCHED-INTENT] ${who}: ${draft.substring(0, 60)}…${channelNote}`,
		content: draft,
		metadata: {
			action: 'SCHED-INTENT-FOLLOWUP',
			origin: 'scheduled_intent',
			intentId: intent.id,
			scheduled_intent_followup: true,
			channel: channel.outcome,
			channel_reason: channel.reason,
			subject,
			companyName: company?.name || null
		}
	});

	// The queue write must succeed before the row is claimed — otherwise a failure
	// would leave the intent DONE forever with no draft behind it.
	if (!queue) {
		console.error(`[schedule-handoff] queue write failed for intent ${intent.id} — will retry next sweep`);
		return { handedOff: false, reason: 'queue_write_failed' };
	}

	// CAS: only one runner wins the transition. Losing means a concurrent runner
	// already queued this intent — remove the duplicate we just wrote.
	const claimed = await prisma.scheduledIntent.updateMany({
		where: { id: intent.id, status: 'PENDING' },
		data: { status: 'DONE', updatedAt: now }
	});
	if (claimed.count === 0) {
		await prisma.communicationLog.delete({ where: { id: queue.id } }).catch(() => {
			// Best effort — the duplicate draft is at worst visible to the reviewer.
		});
		return { handedOff: false, reason: 'already_handled' };
	}

	console.log(
		`[schedule-handoff] queued follow-up for intent ${intent.id} (${channel.outcome}) as pending_approval ${queue.id}`
	);

	return { handedOff: true, channel, queueId: queue.id, draft };
}
