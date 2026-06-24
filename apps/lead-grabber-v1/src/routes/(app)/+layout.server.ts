import { redirect } from '@sveltejs/kit';

export const load = async ({ locals }) => {
	const user = locals.user;
	if (!user) throw redirect(302, '/login');

	let availableCompanies = [];
	if (user.platformRole === 'CLEARSKY_ADMIN') {
		availableCompanies = await locals.prisma.company.findMany({
			select: { id: true, name: true },
			orderBy: { name: 'asc' }
		});
	} else {
		const memberships = await locals.prisma.companyMember.findMany({
			where: { userId: user.id },
			include: { company: { select: { id: true, name: true } } }
		});
		availableCompanies = memberships.map((m: any) => m.company).filter(Boolean);
	}

	return { user, availableCompanies };
};
