import { prisma } from '$lib/db';
import { createTimer } from './TimerService';

export interface DraftPayload {
	comm_id: string;
	draft_type: 'email' | 'sms';
	draft_content: string;
	context_payload?: any;
	deadline_minutes?: number; // Default 60
}

/**
 * Enforce: execution never auto-posts customer-facing content.
 * All outgoing customer-facing content must go through this queue.
 */
export async function createApprovalDraft(payload: DraftPayload) {
	const deadlineMinutes = payload.deadline_minutes || 60;
	const deadline = new Date(Date.now() + deadlineMinutes * 60000);

	// 1. Create the Approval Draft
	const approval = await prisma.actionApproval.create({
		data: {
			comm_id: payload.comm_id,
			draft_type: payload.draft_type,
			draft_content: payload.draft_content,
			context_payload: payload.context_payload || {},
			requires_approval: true,
			approval_deadline: deadline,
			state: 'pending'
		}
	});

	// 2. Register approval_deadline timer
	await createTimer({
		comm_id: payload.comm_id,
		condition: 'approval_deadline',
		fire_at: deadline,
		metadata: {
			approval_id: approval.approval_id
		}
	});

	// 3. Notify owner (Phase 1, part of Approval Queue)
	// TODO: dispatch notification to user

	return approval;
}

/**
 * Handle timer breach escalation
 */
export async function handleApprovalDeadlineBreach(comm_id: string, approval_id: string) {
	const approval = await prisma.actionApproval.findUnique({
		where: { approval_id }
	});

	if (approval && approval.state === 'pending') {
		console.log(`⚠️ Escalating approval ${approval_id} for comm ${comm_id} due to deadline breach`);
		// Re-notify owner, or escalate to someone else
		// Mark the state if it expires
		// await prisma.actionApproval.update({ ... });
	}
}
