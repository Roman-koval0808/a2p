import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const shortcut = await prisma.shortcut.findFirst({
		where: { id: params.id, companyId: auth.companyId, userId: auth.id }
	});
	if (!shortcut) {
		return json({ success: false, error: 'Shortcut not found', code: 404 }, { status: 404 });
	}
	await prisma.shortcut.delete({ where: { id: params.id } });
	return json({ success: true, message: 'Shortcut deleted successfully' });
};
