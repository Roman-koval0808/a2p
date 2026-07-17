import { prisma } from '$lib/db';
import { sendOwnerSmsAlert } from './sms-alert';
import { getFcmMessaging } from './push/firebase';

// Queue statuses that still count as "open" (awaiting a human / execution) and can breach.
const OPEN_STATUSES = ['pending_approval', 'ready_for_execution', 'pending'];

/**
 * SLA-breach detector (T3.4). Reads `dueAt` (previously written but never read) on
 * open action-queue items and, when overdue, escalates to the rep via SMS + push.
 *
 * The autocaller "press 1 to be connected" bridge is Epic 4 (T4.1). Refining this to
 * a dedicated 10-minute callback task that also cross-checks Telnyx outbound logs is
 * a follow-up; this establishes the read+escalate loop that closes the write-only gap.
 */
export async function checkSlaBreaches(): Promise<{ overdue: number; escalated: number }> {
	const now = new Date();
	const overdue = await prisma.pipelineActionQueue.findMany({
		where: { dueAt: { lt: now }, status: { in: OPEN_STATUSES }, slaEscalatedAt: null },
		include: { decision: { include: { event: { select: { companyId: true } } } } },
		take: 200
	});

	let escalated = 0;
	for (const item of overdue) {
		const companyId = (item as any).decision?.event?.companyId as string | undefined;
		if (!companyId) continue;

		const msg = `SLA VIOLATION — task ${item.actionId} is overdue (due ${item.dueAt?.toISOString()}). Please action it now.`;
		// (a) SMS to owner, (b) push to reps. Bridge autocaller is Epic 4 (T4.1).
		await sendOwnerSmsAlert(companyId, msg).catch(() => {});
		await notifyRepsViaPush(companyId, 'SLA breach', msg).catch(() => {});

		// Stamp escalation WITHOUT changing status, so the item stays in its queue.
		await prisma.pipelineActionQueue.update({
			where: { id: item.id },
			data: { slaEscalatedAt: now }
		});
		escalated++;
	}

	return { overdue: overdue.length, escalated };
}

async function notifyRepsViaPush(companyId: string, title: string, body: string): Promise<void> {
	const messaging = getFcmMessaging();
	if (!messaging) return;
	const members = await prisma.companyMember.findMany({
		where: { companyId, status: 'active' },
		select: { userId: true }
	});
	const userIds = [...new Set(members.map((m) => m.userId))];
	if (!userIds.length) return;
	const devices = await prisma.userDevice.findMany({
		where: { userId: { in: userIds }, fcmToken: { not: null } },
		select: { fcmToken: true }
	});
	const tokens = devices.map((d) => d.fcmToken as string).filter(Boolean);
	if (!tokens.length) return;
	await messaging.sendEachForMulticast({
		tokens,
		notification: { title, body },
		data: { type: 'sla_breach', companyId }
	});
}
