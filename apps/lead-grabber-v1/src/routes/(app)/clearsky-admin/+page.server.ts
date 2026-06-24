import { redirect } from '@sveltejs/kit';

export const load = async ({ locals }) => {
	const user = locals.user;
	if (!user) throw redirect(302, '/login');

	if (user.platformRole !== 'CLEARSKY_ADMIN') {
		throw redirect(302, '/dashboard');
	}

	const stats = {
		totalCompanies: await locals.prisma.company.count(),
		totalUsers: await locals.prisma.user.count(),
		supportStaff: await locals.prisma.user.count({
			where: { platformRole: 'CLEARSKY_SUPPORT' }
		})
	};

	const companies = await locals.prisma.company.findMany({
		include: {
			owner: { select: { name: true, email: true } },
			_count: { select: { teamMembers: true, communicationLogs: true } }
		},
		orderBy: { created: 'desc' }
	});

	return { stats, companies };
};
