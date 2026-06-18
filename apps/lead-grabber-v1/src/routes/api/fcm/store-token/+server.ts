import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';

export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const body = await request.json().catch(() => ({}));
	const token = typeof body.token === 'string' ? body.token.trim() : '';
	const platform = typeof body.platform === 'string' ? body.platform.trim() : null;
	const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : null;

	if (!token) {
		return json({ success: false, error: 'token is required', code: 400 }, { status: 400 });
	}

	const existing = await prisma.fcmToken.findFirst({
		where: {
			userId: auth.id,
			...(deviceId ? { deviceId } : { deviceId: null })
		}
	});
	if (existing) {
		await prisma.fcmToken.update({
			where: { id: existing.id },
			data: { token, platform: platform ?? undefined, updated: new Date() }
		});
	} else {
		await prisma.fcmToken.create({
			data: {
				userId: auth.id,
				token,
				platform: platform ?? undefined,
				deviceId: deviceId ?? undefined
			}
		});
	}

	return json({ success: true, message: 'Token stored successfully' });
};
