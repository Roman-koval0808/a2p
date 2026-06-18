import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';

export const GET: RequestHandler = async ({ locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const shortcuts = await prisma.shortcut.findMany({
		where: { companyId: auth.companyId, userId: null },
		orderBy: { code: 'asc' }
	});
	const data = shortcuts.map((s) => ({ id: s.id, code: s.code, message: s.message }));
	return json({ success: true, data });
};
