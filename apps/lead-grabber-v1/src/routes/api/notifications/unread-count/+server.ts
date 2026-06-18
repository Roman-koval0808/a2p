import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';

export const GET: RequestHandler = async ({ locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const count = await prisma.notification.count({
		where: { companyId: auth.companyId, read: false }
	});
	return json({ success: true, data: { count } });
};
