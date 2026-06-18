import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';

const DEVICE_ID_RE = /^[a-zA-Z0-9._:-]{8,128}$/;
const MAX_TOKEN_LEN = 4096;

function deny(message: string, status = 400) {
	return json({ success: false, error: message }, { status });
}

/**
 * POST /api/push/register-token — upsert FCM / VoIP token for the current user (session).
 * Body: { deviceId, platform: ios|android|web, fcmToken?, voipToken? } — at least one token.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return deny('Unauthorized', 401);
	}

	const body = await request.json().catch(() => ({}));
	const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
	const platform = typeof body.platform === 'string' ? body.platform.trim().toLowerCase() : '';
	const fcmToken = typeof body.fcmToken === 'string' ? body.fcmToken.trim() : '';
	const voipToken = typeof body.voipToken === 'string' ? body.voipToken.trim() : '';

	if (!DEVICE_ID_RE.test(deviceId)) {
		return deny('Invalid deviceId');
	}
	if (!['ios', 'android', 'web'].includes(platform)) {
		return deny('platform must be ios, android, or web');
	}
	if (!fcmToken && !voipToken) {
		return deny('Provide fcmToken and/or voipToken');
	}
	if (fcmToken.length > MAX_TOKEN_LEN || voipToken.length > MAX_TOKEN_LEN) {
		return deny('Token too long');
	}

	await prisma.userDevice.upsert({
		where: { userId_deviceId: { userId: locals.user.id, deviceId } },
		create: {
			userId: locals.user.id,
			deviceId,
			platform,
			fcmToken: fcmToken || null,
			voipToken: voipToken || null
		},
		update: {
			platform,
			...(fcmToken ? { fcmToken } : {}),
			...(voipToken ? { voipToken } : {})
		}
	});

	return json({ success: true });
};

/**
 * DELETE /api/push/register-token?deviceId=... — remove this device for the current user.
 */
export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		return deny('Unauthorized', 401);
	}
	const deviceId = url.searchParams.get('deviceId')?.trim() ?? '';
	if (!DEVICE_ID_RE.test(deviceId)) {
		return deny('Invalid deviceId');
	}
	await prisma.userDevice.deleteMany({
		where: { userId: locals.user.id, deviceId }
	});
	return json({ success: true });
};
