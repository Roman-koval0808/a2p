import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';

export const GET: RequestHandler = async ({ locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const now = new Date();
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

	const [
		totalCalls,
		totalSms,
		totalEmails,
		pendingAssignments,
		todaysEvents,
		unreadNotifications,
		totalContacts
	] = await Promise.all([
		prisma.communicationLog.count({ where: { companyId: auth.companyId, type: 'voice' } }),
		prisma.communicationLog.count({ where: { companyId: auth.companyId, type: 'sms' } }),
		prisma.communicationLog.count({ where: { companyId: auth.companyId, type: 'email' } }),
		prisma.communicationLog.count({
			where: {
				companyId: auth.companyId,
				assignedMembers: { none: {} }
			}
		}),
		prisma.scheduleEvent.count({
			where: {
				companyId: auth.companyId,
				startTime: { gte: startOfToday, lt: new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000) }
			}
		}),
		prisma.notification.count({ where: { companyId: auth.companyId, read: false } }),
		prisma.contact.count({ where: { companyId: auth.companyId } })
	]);

	return json({
		success: true,
		data: {
			totalCalls,
			totalSms,
			totalEmails,
			pendingAssignments,
			todaysEvents,
			unreadNotifications,
			totalContacts
		}
	});
};
