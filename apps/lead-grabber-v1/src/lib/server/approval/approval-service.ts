import { prisma } from '$lib/db';
import { registerTimer, cancelTimersForContainer } from '$lib/server/timer/timer-service';
import type { DraftType } from '@prisma/client';

export interface ReconciliationPayload {
	transcriptCaptured?: any;
	systemHas?: any;
	contactDetail?: {
		value: string;
		source: 'rep_entered' | 'ai_extracted' | 'both_agree';
	};
	flags?: string[];
	[key: string]: any;
}

export interface CreateApprovalInput {
	commId: string;
	draftType: DraftType;
	draftContent: string;
	contextPayload: ReconciliationPayload;
	approvalDeadline: Date;
}

export async function createCustomerFacingApproval(tx: any, input: CreateApprovalInput) {
	const db = tx || prisma;
	if (!input.commId) {
		throw new Error('Orphan guard violation: commId is required for approval creation (I-11)');
	}

	const approval = await db.commApproval.create({
		data: {
			commId: input.commId,
			draftType: input.draftType,
			draftContent: input.draftContent,
			contextPayload: input.contextPayload || {},
			approvalDeadline: input.approvalDeadline,
			state: 'pending'
		}
	});

	// Register mandatory approval_deadline timer (§1.4)
	await registerTimer(db, {
		commId: input.commId,
		type: 'approval_deadline',
		fireAt: input.approvalDeadline,
		payload: { approvalId: approval.id }
	});

	return approval;
}

export async function approveDraft(id: string, approvedBy: string, tx?: any) {
	const db = tx || prisma;
	const approval = await db.commApproval.update({
		where: { id },
		data: {
			state: 'approved',
			approvedBy
		}
	});

	// Cancel approval_deadline timer
	await cancelTimersForContainer(approval.commId, 'approval_deadline', 'draft_approved', db);

	return approval;
}

export async function rejectDraft(id: string, reason: string, tx?: any) {
	const db = tx || prisma;
	const approval = await db.commApproval.update({
		where: { id },
		data: {
			state: 'rejected',
			rejectedReason: reason
		}
	});

	// Cancel approval_deadline timer
	await cancelTimersForContainer(approval.commId, 'approval_deadline', 'draft_rejected', db);

	return approval;
}
