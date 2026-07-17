import { prisma } from '$lib/db';
import { getFcmMessaging } from './push/firebase';

/**
 * Notify the company's reps of a new booking — creates a Task (always visible) and,
 * best-effort, an FCM push. Fire-and-forget; never throws. Lazy-import this from the
 * request path so firebase-admin stays off the module-load graph.
 */
export async function notifyRepsOfBooking(companyId: string, message: string): Promise<void> {
	try {
		await prisma.task.create({ data: { companyId, title: message } });
	} catch (e: any) {
		console.error('[rep-notify] task create failed:', e?.message || e);
	}
	try {
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
			notification: { title: 'New appointment', body: message },
			data: { type: 'appointment_booked', companyId }
		});
	} catch (e: any) {
		console.error('[rep-notify] push failed:', e?.message || e);
	}
}
