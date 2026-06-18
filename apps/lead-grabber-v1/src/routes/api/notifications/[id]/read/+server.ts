import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';

export const PUT: RequestHandler = async ({ params, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const n = await prisma.notification.findFirst({
		where: { id: params.id, companyId: auth.companyId }
	});
	if (!n) {
		return json({ success: false, error: 'Notification not found', code: 404 }, { status: 404 });
	}

	await prisma.notification.update({
		where: { id: params.id },
		data: { read: true }
	});
	return json({ success: true, message: 'Notification marked as read' });
};
