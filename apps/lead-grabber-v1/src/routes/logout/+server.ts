import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';

const DEVICE_ID_RE = /^[a-zA-Z0-9._:-]{8,128}$/;

async function clearDeviceIfRequested(userId: string | undefined, deviceId: string | null) {
	if (!userId || !deviceId || !DEVICE_ID_RE.test(deviceId)) {
		return;
	}
	await prisma.userDevice.deleteMany({
		where: { userId, deviceId }
	});
}

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	const deviceId = url.searchParams.get('deviceId');
	await clearDeviceIfRequested(locals.user?.id, deviceId);
	cookies.delete('app_session', { path: '/' });
	const redirectTo = url.searchParams.get('redirect') || '/login';
	throw redirect(303, redirectTo);
};

export const POST: RequestHandler = async ({ url, cookies, locals }) => {
	const deviceId = url.searchParams.get('deviceId');
	await clearDeviceIfRequested(locals.user?.id, deviceId);
	cookies.delete('app_session', { path: '/' });
	const redirectTo = url.searchParams.get('redirect') || '/login';
	throw redirect(303, redirectTo);
};
