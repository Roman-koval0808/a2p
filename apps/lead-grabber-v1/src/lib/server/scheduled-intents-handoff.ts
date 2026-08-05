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
	reason?: 'already_handled' | 'no_contact';
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
		// Ray: "You mentioned you'd be away a couple of weeks and would give us a call
		// about air conditioning when you were back — thought I'd save you the job…"
		const phrase = timeframe ? `you'd be away ${timeframe}` : "you'd be away";
		const how = method ? `and would ${method} about ${what}` : `and would be in touch about ${what}`;
		return `You mentioned ${phrase} ${how} when you were back — thought I'd save you the job…`;
	}

	// Scenario B — they asked us to act; we're honouring a promise, not marketing.
	const when = timeframe ? ` ${timeframe}` : '';
	const channel = method ? ` ${method}` : '';
	return `You asked us to${channel} about ${what}${when} — getting back to you as promised.`;
}

/**
 * Queue the verified intent as an approval-gated draft and mark it done.
 * Idempotent: the PENDING → DONE transition is a compare-and-swap, so two sweeps
 * (or a sweep and a manual re-run) can never queue the same intent twice.
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
	// CAS: only one runner wins the transition. A 0-row update means it was already
	// handed off (or cancelled) — never queue a second draft.
	const claimed = await prisma.scheduledIntent.updateMany({
		where: { id: intent.id, status: 'PENDING' },
		data: { status: 'DONE', updatedAt: now }
	});
	if (claimed.count === 0) return { handedOff: false, reason: 'already_handled' };

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

	const queue = await logCommunication({
		type: channel.outcome === 'sms' ? 'sms' : 'email',
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
			companyName: company?.name || null
		}
	});

	const queueId = queue?.id;
	if (queueId) {
		console.log(
			`[schedule-handoff] queued follow-up for intent ${intent.id} (${channel.outcome}) as pending_approval ${queueId}`
		);
	} else {
		console.error(`[schedule-handoff] queued intent ${intent.id} but no queue row was created`);
	}

	return { handedOff: true, channel, queueId, draft };
}
