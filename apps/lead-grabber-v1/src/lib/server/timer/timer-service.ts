import { prisma } from '$lib/db';
import { UnifiedPipeline } from '$lib/server/pipeline/unified-pipeline';
import type { TimerType, TimerStatus } from '@prisma/client';

export interface RegisterTimerInput {
	commId: string;
	companyId?: string;
	type: TimerType;
	fireAt: Date;
	payload?: any;
	supersedeSameType?: boolean;
}

export async function registerTimer(tx: any, input: RegisterTimerInput) {
	const db = tx || prisma;
	if (!input.commId) {
		throw new Error('RegisterTimer invariant violation: commId is required (I-11)');
	}

	if (input.supersedeSameType) {
		await db.pipelineTimer.updateMany({
			where: {
				commId: input.commId,
				type: input.type,
				status: 'registered'
			},
			data: {
				status: 'superseded',
				cancelledAt: new Date(),
				cancelReason: 'superseded_by_new_timer'
			}
		});
	}

	const timer = await db.pipelineTimer.create({
		data: {
			commId: input.commId,
			companyId: input.companyId,
			type: input.type,
			fireAt: input.fireAt,
			payload: input.payload || {},
			status: 'registered'
		}
	});

	// Set stable idempotency key for firing event
	const fireEventKey = `tmr_${timer.id}`;
	return await db.pipelineTimer.update({
		where: { id: timer.id },
		data: { fireEventKey }
	});
}

export async function cancelTimer(id: string, reason: string, tx?: any) {
	const db = tx || prisma;
	return await db.pipelineTimer.update({
		where: { id },
		data: {
			status: 'cancelled',
			cancelledAt: new Date(),
			cancelReason: reason
		}
	});
}

export async function cancelTimersForContainer(commId: string, type?: TimerType, reason = 'manual_cancel', tx?: any) {
	const db = tx || prisma;
	return await db.pipelineTimer.updateMany({
		where: {
			commId,
			status: 'registered',
			...(type ? { type } : {})
		},
		data: {
			status: 'cancelled',
			cancelledAt: new Date(),
			cancelReason: reason
		}
	});
}

export function canAutoClose(
	container: {
		closurePolicy: string;
		slaDeadline: Date | null;
	},
	guards: {
		hasOpenPromise: boolean;
		hasPendingApproval: boolean;
		hasTentativeHold: boolean;
		now?: Date;
	}
): boolean {
	const now = guards.now || new Date();
	if (container.closurePolicy === 'indefinite') return false;
	if (container.slaDeadline && container.slaDeadline > now) return false;
	if (guards.hasOpenPromise) return false;
	if (guards.hasPendingApproval) return false;
	if (guards.hasTentativeHold) return false;
	return true;
}

export async function sweepTimers(now = new Date()): Promise<{ due: number; fired: number; skipped: number }> {
	const dueTimers = await prisma.pipelineTimer.findMany({
		where: {
			status: 'registered',
			fireAt: { lte: now }
		},
		take: 200,
		orderBy: { fireAt: 'asc' },
		include: {
			container: true
		}
	});

	let fired = 0;
	let skipped = 0;

	for (const timer of dueTimers) {
		try {
			const container = timer.container;
			if (!container) {
				await cancelTimer(timer.id, 'container_not_found');
				skipped++;
				continue;
			}

			const isUnmet = await evaluateTimerCondition(timer, container, now);
			if (!isUnmet) {
				await cancelTimer(timer.id, 'condition_met');
				skipped++;
				continue;
			}

			if (timer.type === 'hold_expiry') {
				const holdId = (timer.payload as any)?.holdId;
				if (holdId) {
					await prisma.commHold.update({
						where: { id: holdId },
						data: { status: 'released' }
					});
					await prisma.commTask.create({
						data: {
							commId: timer.commId,
							description: `Tentative hold expired without confirmation. Slot released.`,
							ownerUserId: 'u_sales_owner',
							due: now,
							category: 'internal_followup',
							status: 'open'
						}
					});
				}
			}

			// Fire synthetic event into Stage 1 Intake
			const fireEventKey = timer.fireEventKey || `tmr_${timer.id}`;
			const payload = {
				provider: 'timer',
				eventType: `timer.${timer.type}`,
				externalId: fireEventKey,
				companyId: timer.companyId || container.companyId,
				metadata: {
					comm_id: timer.commId,
					timer_id: timer.id,
					timer_type: timer.type,
					...(timer.payload as object || {})
				},
				textContent: `Synthetic escalation event triggered: timer ${timer.type} for container ${container.commRef}`
			};

			await UnifiedPipeline.process(payload);

			await prisma.pipelineTimer.update({
				where: { id: timer.id },
				data: {
					status: 'fired',
					firedAt: now
				}
			});

			fired++;
		} catch (err: any) {
			console.error(`[TimerService] Error processing timer ${timer.id}:`, err?.message || err);
		}
	}

	return { due: dueTimers.length, fired, skipped };
}

async function evaluateTimerCondition(timer: any, container: any, now: Date): Promise<boolean> {
	switch (timer.type) {
		case 'sla_breach': {
			// Unmet if container is still open and slaDeadline is breached
			return container.state !== 'closed' && container.resolution === null;
		}

		case 'thread_inactivity': {
			// Unmet if container is inactive and closure guards pass
			const hasOpenPromise = (await prisma.commTask.count({
				where: { commId: container.id, category: 'customer_promise', status: 'open' }
			})) > 0;

			const hasPendingApproval = (await prisma.commApproval.count({
				where: { commId: container.id, state: 'pending' }
			})) > 0;

			const hasTentativeHold = (await prisma.commHold.count({
				where: { commId: container.id, status: 'tentative' }
			})) > 0;

			const allowed = canAutoClose(container, {
				hasOpenPromise,
				hasPendingApproval,
				hasTentativeHold,
				now
			});

			return allowed && container.state !== 'closed';
		}

		case 'calendar_grace': {
			// Unmet if calendar entry still not found for container
			const payload = (timer.payload as any) || {};
			return payload.calendarStatus !== 'found';
		}

		case 'hold_expiry': {
			// Unmet if hold is still tentative
			const holdId = (timer.payload as any)?.holdId;
			if (!holdId) return true;
			const hold = await prisma.commHold.findUnique({ where: { id: holdId } });
			return !!hold && hold.status === 'tentative';
		}

		case 'approval_deadline': {
			// Unmet if approval is still pending
			const approvalId = (timer.payload as any)?.approvalId;
			if (!approvalId) return true;
			const approval = await prisma.commApproval.findUnique({ where: { id: approvalId } });
			return !!approval && approval.state === 'pending';
		}

		case 'promise_due': {
			// Unmet if task is still open
			const taskId = (timer.payload as any)?.taskId;
			if (!taskId) return true;
			const task = await prisma.commTask.findUnique({ where: { id: taskId } });
			return !!task && task.status === 'open';
		}

		case 'customer_retry': {
			// Unmet if customer has not been reached yet
			return container.state !== 'closed' && container.resolution !== 'resolved';
		}

		default:
			return true;
	}
}
