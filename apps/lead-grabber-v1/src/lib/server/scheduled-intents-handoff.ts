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
// The draft is written from structured parameters — no template, no assumptions.
// Claude generates a brief, customer-specific message from the facts the customer
// gave us: what they wanted, when they said they'd get in touch, and how.

import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';
import { resolveContactChannel, type ResolvedContactChannel } from './contact-channel-resolver';
import { ANTHROPIC_AI_KEY } from '$env/static/private';

export interface HandoffResult {
	handedOff: boolean;
	reason?: 'already_handled' | 'no_contact' | 'queue_write_failed';
	channel?: ResolvedContactChannel;
	queueId?: string;
	draft?: string;
}

/**
 * Generate a follow-up draft from structured parameters via Claude.
 * No template — the facts the customer gave us drive the draft.
 * Falls back to a minimal cue when Claude is unavailable.
 */
async function generateFollowUpDraft(opts: {
	actor: 'CUSTOMER' | 'BUSINESS';
	whatHeWants: string;
	rawTimeframe: string;
	preferredChannel: string;
	customerName: string;
	companyName: string | null;
}): Promise<string> {
	const { actor, whatHeWants, rawTimeframe, preferredChannel, customerName, companyName } = opts;
	const context =
		actor === 'CUSTOMER' ? 'they said they would contact us' : 'we said we would follow up with them';

	try {
		const { claudeText } = await import('./anthropic');
		const prompt =
			`Write a brief follow-up message to a customer. Use only the facts below — don't invent anything about why they haven't responded or where they are. Keep it warm and professional, under 4 sentences.\n\n` +
			`Customer name: ${customerName}\n` +
			`Company: ${companyName || 'the business'}\n` +
			`Topic they wanted to discuss: ${whatHeWants}\n` +
			`What they said about timing: "${rawTimeframe}"\n` +
			`Context: ${context}\n` +
			`Preferred contact method: ${preferredChannel || 'not specified'}\n\n` +
			`Write just the message body — no subject line, no signature.`;

		const result = await claudeText({
			apiKey: ANTHROPIC_AI_KEY,
			system: `You are a customer-service follow-up writer for ${companyName || 'a local business'}. Be warm, professional, and brief. Never invent details.`,
			messages: [{ role: 'user', content: prompt }],
			temperature: 0.3,
			maxTokens: 300
		});
		if (result) return result.trim();
	} catch (e) {
		console.error('[schedule-handoff] Claude draft generation failed:', e);
	}

	// Fallback: structured cue for the human to write from.
	const how = preferredChannel === 'call' ? 'give us a call' : 'be in touch';
	const when = rawTimeframe ? ` in ${rawTimeframe}` : '';
	return `[Write a follow-up to ${customerName} — they said they'd ${how} about ${whatHeWants}${when}.]`;
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

	const who = contact?.name?.trim() || 'the customer';
	const whatHeWants = (intent.payload?.whatHeWants || 'your message').trim();
	const rawTimeframe = (intent.payload?.rawTimeframe || '').trim();
	const preferredChannel = (intent.payload?.preferredChannel || '').trim();

	const draft = await generateFollowUpDraft({
		actor: intent.actor,
		whatHeWants,
		rawTimeframe,
		preferredChannel,
		customerName: who,
		companyName: company?.name || null
	});

	// A real subject for the email — the summary dialog and the confirm flow both read
	// it, so a confirmed draft never goes out as "No subject" (§9).
	const subject = `About ${whatHeWants}`;

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
		summary: `[SCHED-INTENT] ${who}: follow-up about ${whatHeWants} — ${intent.actor === 'CUSTOMER' ? "they said they'd be in touch" : "we said we'd follow up"}${rawTimeframe ? ` (said: "${rawTimeframe}")` : ''}${channelNote}`,
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

	// One conversation, one COM id (§2.2, and the reason this is a task set "asking for a form of
	// communication").
	//
	// The draft was landing as a free-standing log with its own id, so Joe's 1 Aug call and each
	// daily callback attempt showed the rep a different code for the same exchange — and a chain of
	// attempts produced a fresh one every morning. The promise knows which conversation it came
	// from; carry it onto the draft.
	//
	// Same customer, so the identity guards permit the link — the 2026-08-10 guards only block
	// linking ACROSS customers, and the container is re-read under both companyId and contactId
	// here so a payload that pointed at somebody else's thread cannot be honoured.
	const conversationId = intent.payload?.conversationId as string | undefined;
	if (conversationId) {
		try {
			const container = await prisma.commContainer.findFirst({
				where: { id: conversationId, companyId: intent.clientId, contactId: contact?.id ?? intent.profileId },
				select: { id: true, commRef: true }
			});
			if (container) {
				const { linkCommunicationLogToContainer } = await import('./container/thread-resolver');
				await linkCommunicationLogToContainer(
					queue.id,
					{ id: container.id, commRef: container.commRef },
					'scheduled_intent_followup',
					{ companyId: intent.clientId, contactId: contact?.id ?? intent.profileId }
				);
				console.log(
					`[schedule-handoff] draft ${queue.id} tagged with ${container.commRef} — one COM id for the whole thread`
				);
			} else {
				console.log(
					`[schedule-handoff] intent ${intent.id} names conversation ${conversationId}, but it is not this customer's — draft left untagged`
				);
			}
		} catch (e: any) {
			// A missing COM id makes the draft harder to trace; it does not make it wrong. The
			// follow-up still goes to the approval queue.
			console.error(`[schedule-handoff] could not tag draft ${queue.id} with a COM id:`, e?.message || e);
		}
	}

	console.log(
		`[schedule-handoff] queued follow-up for intent ${intent.id} (${channel.outcome}) as pending_approval ${queue.id}`
	);

	return { handedOff: true, channel, queueId: queue.id, draft };
}
