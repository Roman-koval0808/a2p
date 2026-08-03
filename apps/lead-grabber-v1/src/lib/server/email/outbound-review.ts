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
	openContainerCandidatesFor,
	matchContinuationToCandidates,
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

	// 2. Reuse an open container when the customer's conversation continues; otherwise create one.
	const candidates = await openContainerCandidatesFor({
		companyId: input.companyId,
		contactId: input.customerContactId || null,
		customerProfileId: input.customerProfileId || null,
		phone: input.customerPhone || null,
		email: input.customerEmail || null
	});

	const match = await matchContinuationToCandidates(
		{
			channel: 'email',
			direction: 'outbound',
			subject: input.subject ?? log.summary ?? null,
			content
		},
		candidates
	);

	let container: { id: string; commRef: string };
	let reusedContainer = false;

	if (match.matched && match.commId) {
		container = { id: match.commId, commRef: '' };
		const found = candidates.find((c) => c.id === match.commId);
		container.commRef = found?.commRef || '';
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
				outbound_review: {
					intent: analysis.intent,
					sub_intent: analysis.sub_intent,
					summary: analysis.summary,
					urgency: analysis.urgency,
					sentiment: analysis.sentiment,
					tasksCreated,
					timerRegistered,
					reusedContainer,
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
