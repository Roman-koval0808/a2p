import { prisma } from '$lib/db';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const user = locals.user;
	if (!user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const companyId = url.searchParams.get('companyId');
	if (!companyId || companyId !== user.company.id) {
		return json({ error: 'Unauthorized' }, { status: 403 });
	}

	try {
		const invites = await prisma.invite.findMany({
			where: {
				companyId: companyId
			},
			orderBy: {
				created: 'desc'
			},
			take: 50
		});

		return json({ invites });
	} catch (error) {
		console.error('Error fetching invites:', error);
		return json({ error: 'Failed to fetch invites' }, { status: 500 });
	}
};
