import { prisma } from '$lib/db';
import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const user = locals.user;

	if (!user) {
		throw redirect(303, '/login');
	}

	if (!user.company) {
		throw redirect(303, '/create-company');
	}

	const companyId = user.company.id;

	const dbContact = await prisma.contact.findFirst({
		where: { id: params.id, companyId }
	});

	if (!dbContact) {
		throw error(404, 'Profile not found');
	}

	const scheduledIntents = await prisma.scheduledIntent.findMany({
		where: { clientId: companyId, profileId: dbContact.id },
		orderBy: { dueAt: 'asc' },
		take: 100,
		select: {
			id: true,
			intentType: true,
			status: true,
			actor: true,
			dueAt: true,
			expiresAt: true,
			payload: true,
			createdAt: true,
			updatedAt: true
		}
	});

	return {
		profile: {
			id: dbContact.id,
			name: dbContact.name || 'Unknown'
		},
		scheduledIntents
	};
};
