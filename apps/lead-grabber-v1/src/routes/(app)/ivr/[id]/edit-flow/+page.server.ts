import { prisma } from '$lib/db';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user?.company) throw redirect(302, '/login');
	const flow = await prisma.callFlow.findFirst({
		where: { id: params.id, companyId: locals.user.company.id }
	});
	if (!flow) throw redirect(302, '/ivr');
	return { flow };
};
