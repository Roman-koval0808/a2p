import { prisma } from '$lib/db';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user?.company) {
		throw redirect(302, '/login');
	}
	const flows = await prisma.callFlow.findMany({
		where: { companyId: locals.user.company.id },
		include: { rules: { orderBy: { created: 'asc' } } },
		orderBy: { updated: 'desc' }
	});
	return { flows };
};
