import { prisma } from '$lib/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url, depends }) => {
	depends('app:notifications');

	if (!locals.user?.company) {
		return { notifications: [], total: 0, page: 1, perPage: 50 };
	}

	const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
	const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get('perPage') || '50')));
	const type = url.searchParams.get('type'); // email, sms, voice, etc.
	const read = url.searchParams.get('read'); // true | false
	const companyId = locals.user.company.id;

	const where: { companyId: string; type?: string; read?: boolean } = { companyId };
	if (type) where.type = type;
	if (read === 'true') where.read = true;
	if (read === 'false') where.read = false;

	const [notifications, total] = await Promise.all([
		prisma.notification.findMany({
			where,
			orderBy: { createdAt: 'desc' },
			skip: (page - 1) * perPage,
			take: perPage
		}),
		prisma.notification.count({ where })
	]);

	return {
		notifications,
		total,
		page,
		perPage,
		totalPages: Math.ceil(total / perPage)
	};
};
