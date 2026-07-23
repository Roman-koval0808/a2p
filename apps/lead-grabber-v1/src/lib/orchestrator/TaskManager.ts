import { prisma } from '$lib/db';
import { createTimer } from './TimerService';

export interface TaskPayload {
	comm_id: string;
	description: string;
	owner_id: string; // Must be a person (User.id)
	due: Date;
	category: 'customer_promise' | 'internal_followup';
	confidence?: number;
}

const CONFIDENCE_THRESHOLD = 0.8;

export async function createActionTask(payload: TaskPayload) {
	// Enforce owner is a user
	const owner = await prisma.user.findUnique({ where: { id: payload.owner_id } });
	if (!owner) {
		throw new Error(`Invalid owner_id: ${payload.owner_id}`);
	}

	const isLowConfidence = (payload.confidence ?? 1.0) < CONFIDENCE_THRESHOLD;

	const task = await prisma.actionTask.create({
		data: {
			comm_id: payload.comm_id,
			description: payload.description,
			owner_id: payload.owner_id,
			due: payload.due,
			category: payload.category,
			confidence: payload.confidence,
			// Route below-confidence to human review queue
			status: isLowConfidence ? 'review_pending' : 'open'
		}
	});

	if (isLowConfidence) {
		console.log(`⚠️ Task ${task.task_id} routed to review queue (confidence: ${payload.confidence})`);
	} else if (payload.category === 'customer_promise') {
		// Implement `customer_promise` category → registers `promise_due` timer, escalates on breach
		await createTimer({
			comm_id: payload.comm_id,
			condition: 'promise_due',
			fire_at: payload.due,
			metadata: {
				task_id: task.task_id
			}
		});
		console.log(`⏱️ Registered promise_due timer for task ${task.task_id} due at ${payload.due}`);
	}

	return task;
}

export async function handlePromiseDueBreach(comm_id: string, task_id: string) {
	const task = await prisma.actionTask.findUnique({
		where: { task_id }
	});

	if (task && task.status === 'open') {
		console.log(`⚠️ Escalating customer_promise task ${task_id} for comm ${comm_id} due to deadline breach`);
		await prisma.actionTask.update({
			where: { task_id },
			data: { status: 'escalated' }
		});
		// TODO: Dispatch notification
	}
}
