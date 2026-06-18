import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
        // Ensure user is authenticated
		if (!locals.user) {
			return json({ success: false, error: 'Unauthorized' }, { status: 401 });
		}

		const body = await request.json();
		const { deviceId, platform, fcmToken, voipToken } = body;

		if (!deviceId) {
			return json({ success: false, error: 'deviceId is required' }, { status: 400 });
		}

		// Upsert user device using deviceId and userId as standard composite key
		const device = await prisma.userDevice.upsert({
			where: {
				userId_deviceId: {
					userId: locals.user.id,
					deviceId
				}
			},
			update: {
				...(platform !== undefined && { platform }),
				...(fcmToken !== undefined && { fcmToken }),
				...(voipToken !== undefined && { voipToken }),
				updated: new Date()
			},
			create: {
				userId: locals.user.id,
				deviceId,
				platform: platform || 'unknown',
				fcmToken,
				voipToken
			}
		});

		return json({
			success: true,
			device
		});
	} catch (error) {
		console.error('[API] /api/push/register Error:', error);
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};
