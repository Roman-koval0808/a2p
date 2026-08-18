// Outbound email review ("sent-items mailbox sweep" step 2).
//
// When the sweep detects an email the company SENT from its connected Gmail mailbox, we log it
// as an outbound CommunicationLog (gmail-sync) and then review it here so the orchestrator world
// knows about it:
//   - AI analysis of what was sent (summary, intent, action items).
//   - An open CommContainer for the conversation (reused when the customer already has one open,
//     e.g. they emailed first), with the sent email appended as an outbound entry.
//   - CommTasks for any pending/action items, and a follow-up nudge timer when something is
//     awaiting the customer — these are the "pending items" a later phone/SMS/email reply from
//     the customer gets matched against (thread-resolver).
//   - The CommunicationLog is linked to the container so the UI shows one shared COM id.

import { prisma } from '$lib/db';
import { analyzeCallLog } from '$lib/server/openai';
import {
	classifyThreadType,
	createContainerAtIntake,
	createTask
} from '$lib/server/container/container-service';
import { registerTimer } from '$lib/server/timer/timer-service';
import {
	resolveContextContainer,
	appendEntryToContainer,
	linkCommunicationLogToContainer
} from '$lib/server/container/thread-resolver';
import type { CommunicationLog } from 'clearsky-db-client';

export interface OutboundEmailReviewInput {
	companyId: string;
	logId: string;
	content?: string | null;
	subject?: string | null;
	customerEmail?: string | null;
	customerPhone?: string | null;
	customerContactId?: string | null;
	customerProfileId?: string | null;
	fromEmail?: string | null;
	now?: Date;
}

export interface OutboundEmailReviewResult {
	reviewed: boolean;
	reason?: string;
	containerId?: string;
	commRef?: string;
	reusedContainer: boolean;
	tasksCreated: number;
	timerRegistered: boolean;
}

const MAX_TASKS = 5;
const TASK_DUE_MS = 48 * 3600 * 1000; // follow-up due in 48h
const NUDGE_MS = 72 * 3600 * 1000; // nudge timer in 72h

export async function reviewOutboundEmail(
	input: OutboundEmailReviewInput
): Promise<OutboundEmailReviewResult> {
	const now = input.now || new Date();

	const log: CommunicationLog | null = await prisma.communicationLog.findUnique({
		where: { id: input.logId }
	});
	if (!log) {
		return {
			reviewed: false,
			reason: 'log_not_found',
			reusedContainer: false,
			tasksCreated: 0,
			timerRegistered: false
		};
	}

	const meta = (log.metadata as Record<string, any>) || {};
	if (meta.outbound_reviewed === true) {
		return {
			reviewed: false,
			reason: 'already_reviewed',
			reusedContainer: false,
			tasksCreated: 0,
			timerRegistered: false
		};
	}

	const content = (input.content ?? log.content ?? '').trim();
	if (!content) {
		return {
			reviewed: false,
			reason: 'empty_content',
			reusedContainer: false,
			tasksCreated: 0,
			timerRegistered: false
		};
	}

	// 1. AI analysis of what was sent (best-effort; a failure must not break the sweep).
	let analysis: {
		summary: string;
		intent: string;
		sub_intent: string | null;
		urgency: string;
		actionItems: string[];
		sentiment: string;
		datetime: string | null;
	} = {
		summary: log.summary || log.content || '',
		intent: '',
		sub_intent: null,
		urgency: 'medium',
		actionItems: [],
		sentiment: 'Neutral',
		datetime: null
	};
	try {
		const result = await analyzeCallLog(content);
		analysis = {
			summary: result.summary,
			intent: result.intent,
			sub_intent: result.sub_intent,
			urgency: result.urgency,
			actionItems: result.actionItems || [],
			sentiment: result.sentiment,
			datetime: result.datetime
		};
	} catch (e) {
		console.error('[outbound-review] AI analysis failed:', e);
	}

	// 1b. If the sent email proposed a specific time, record it as a pending appointment
	// proposal. An affirmative reply on ANY channel then auto-books it — or, when the reply
	// renegotiates the time, lands as a booking DRAFT in the approval queue (see orchestrator
	// Scenario 2b) instead of a self-serve booking link.
	let proposedAppointment: any = null;
	if (analysis.datetime) {
		try {
			const start = new Date(analysis.datetime);
			if (!isNaN(start.getTime())) {
				const end = new Date(start.getTime() + 60 * 60000);
				const label = start.toLocaleString('en-US', {
					weekday: 'short',
					month: 'short',
					day: 'numeric',
					hour: 'numeric',
					minute: '2-digit'
				});
				proposedAppointment = {
					requestedISO: start.toISOString(),
					proposedStartISO: start.toISOString(),
					proposedEndISO: end.toISOString(),
					proposedLabel: label,
					booked: false,
					source: 'outbound_email_review'
				};
			}
		} catch (e) {
			console.error('[outbound-review] Failed to build proposed appointment:', e);
		}
	}

	// 2. Universal context check: reuse the conversation this email continues — the sender's
	// identity first, falling back to company-wide open containers — regardless of which channel
	// the rest of the conversation happened on. Only when the matcher is genuinely unsure do we
	// start a fresh container.
	const resolution = await resolveContextContainer(
		{
			companyId: input.companyId,
			contactId: input.customerContactId || null,
			customerProfileId: input.customerProfileId || null,
			phone: input.customerPhone || null,
			email: input.customerEmail || null,
			channel: 'email',
			direction: 'outbound',
			subject: input.subject ?? log.summary ?? null,
			content,
			summary: log.summary || null,
			occurredAt: now
		},
		{}
	);

	let container: { id: string; commRef: string };
	let reusedContainer = false;

	if (resolution.matched && resolution.commId) {
		// The candidate carries the commRef, but a cross-channel/deduped match can resolve to a
		// container that isn't in the candidate list. Never fall through with an empty commRef —
		// the log would then be anchored to its thread id and show a different COM id than the
		// rest of the conversation. Read it off the container instead.
		let commRef = resolution.candidate?.commRef || '';
		if (!commRef) {
			const row = await prisma.commContainer.findUnique({
				where: { id: resolution.commId },
				select: { commRef: true }
			});
			commRef = row?.commRef || '';
		}
		container = { id: resolution.commId, commRef };
		reusedContainer = true;
	} else {
		const createResult = await createContainerAtIntake(prisma, {
			companyId: input.companyId,
			customerProfileId: input.customerProfileId || null,
			contactId: input.customerContactId || null,
			threadType: classifyThreadType({ text: content }),
			subject: input.subject ?? log.summary ?? undefined,
			now
		});
		container = { id: createResult.container.id, commRef: createResult.container.commRef };
	}

	// 3. Append the sent email as an outbound entry on the container.
	await appendEntryToContainer(prisma, {
		commId: container.id,
		direction: 'outbound',
		channel: 'email',
		fromParty: input.fromEmail || 'unknown',
		toParty: input.customerEmail || 'unknown',
		fromPartyType: 'rep',
		toPartyType: 'customer',
		transcript: content,
		analysisJson: analysis,
		occurredAt: now
	});

	// 4. Tasks for pending/action items (owner = company owner; skip when none resolvable).
	let tasksCreated = 0;
	let ownerUserId: string | null = null;
	try {
		const company = await prisma.company.findUnique({
			where: { id: input.companyId },
			select: { ownerId: true }
		});
		ownerUserId = company?.ownerId || null;
	} catch {
		/* best-effort */
	}

	if (ownerUserId) {
		for (const item of analysis.actionItems.slice(0, MAX_TASKS)) {
			const desc = item.trim();
			if (!desc) continue;
			await createTask(prisma, {
				commId: container.id,
				description: `[Sent-email follow-up] ${desc}`,
				ownerUserId,
				due: new Date(now.getTime() + TASK_DUE_MS),
				category: 'internal_followup',
				confidence: 0.8
			});
			tasksCreated++;
		}
	}

	// 5. Nudge timer when something is still pending on the customer's side.
	let timerRegistered = false;
	if (tasksCreated > 0) {
		try {
			await registerTimer(prisma, {
				commId: container.id,
				companyId: input.companyId,
				type: 'customer_retry',
				fireAt: new Date(now.getTime() + NUDGE_MS),
				payload: { source: 'outbound_email_review', logId: input.logId },
				supersedeSameType: true
			});
			timerRegistered = true;
		} catch (e) {
			console.error('[outbound-review] Failed to register nudge timer:', e);
		}
	}

	// 6. Link the comm log to the container (shared COM id) and mark reviewed.
	await linkCommunicationLogToContainer(input.logId, container, 'outbound_email_review', {
		contactId: input.customerContactId || null,
		companyId: input.companyId
	});
	await prisma.communicationLog.update({
		where: { id: input.logId },
		data: {
			metadata: {
				...meta,
				commContainerId: container.id,
				commRef: container.commRef,
				outbound_reviewed: true,
				...(proposedAppointment ? { proposed_appointment: proposedAppointment } : {}),
				outbound_review: {
					intent: analysis.intent,
					sub_intent: analysis.sub_intent,
					summary: analysis.summary,
					urgency: analysis.urgency,
					sentiment: analysis.sentiment,
					tasksCreated,
					timerRegistered,
					reusedContainer,
					proposed: !!proposedAppointment,
					reviewedAt: now.toISOString()
				}
			}
		}
	});

	return {
		reviewed: true,
		containerId: container.id,
		commRef: container.commRef,
		reusedContainer,
		tasksCreated,
		timerRegistered
	};
}
