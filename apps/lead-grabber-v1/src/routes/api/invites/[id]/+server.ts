import { prisma } from '$lib/db';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const user = locals.user;
	if (!user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		// Verify invite belongs to user's company
		const invite = await prisma.invite.findUnique({
			where: { id: params.id }
		});

		if (!invite || invite.companyId !== user.company.id) {
			return json({ error: 'Invite not found' }, { status: 404 });
		}

		await prisma.invite.delete({
			where: { id: params.id }
		});

		return json({ success: true });
	} catch (error) {
		console.error('Error deleting invite:', error);
		return json({ error: 'Failed to delete invite' }, { status: 500 });
	}
};
