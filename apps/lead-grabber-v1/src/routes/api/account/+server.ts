import { json } from '@sveltejs/kit';
import { prisma } from '$lib/db';
import type { RequestHandler } from '@sveltejs/kit';

export const DELETE: RequestHandler = async ({ cookies, locals }) => {
	const user = locals.user;
	if (!user) {
		return json({ success: false, message: 'Not authenticated.' }, { status: 401 });
	}

	try {
		// Delete user and cascade related data
		await prisma.user.delete({ where: { id: user.id } });
		// Optionally: delete related contacts, logs, etc. (if not cascaded)
		cookies.delete('app_session', { path: '/' });
		return json({ success: true, message: 'Account deleted successfully.' });
	} catch (err) {
		console.error('Account deletion error:', err);
		return json({ success: false, message: 'Account deletion failed.' }, { status: 500 });
	}
};
