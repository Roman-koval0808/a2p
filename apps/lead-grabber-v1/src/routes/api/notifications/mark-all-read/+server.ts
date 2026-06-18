import { prisma } from '$lib/db';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user?.company) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const companyId = locals.user.company.id;

	try {
		const result = await prisma.notification.updateMany({
			where: {
				companyId,
				read: false
			},
			data: {
				read: true
			}
		});

		return json({
			success: true,
			count: result.count,
			message: `Marked ${result.count} notifications as read`
		});
	} catch (e) {
		console.error('POST /api/notifications/mark-all-read error:', e);
		return json(
			{
				success: false,
				error: e instanceof Error ? e.message : 'Failed to mark notifications as read'
			},
			{ status: 500 }
		);
	}
};
