import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';

export const DELETE: RequestHandler = async ({ request, locals }) => {
	try {
		// Ensure user is authenticated
		if (!locals.user) {
			return json({ success: false, error: 'Unauthorized' }, { status: 401 });
		}

		const body = await request.json();
		const { deviceId } = body;

		if (!deviceId) {
			return json({ success: false, error: 'deviceId is required' }, { status: 400 });
		}

		// Delete the device associated with this user and deviceId
		await prisma.userDevice.deleteMany({
			where: {
				userId: locals.user.id,
				deviceId: deviceId
			}
		});

		return json({
			success: true,
			message: 'Device unregistered successfully'
		});
	} catch (error) {
		console.error('[API] /api/push/unregister Error:', error);
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};
