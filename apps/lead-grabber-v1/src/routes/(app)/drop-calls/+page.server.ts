import { prisma } from '$lib/db';
import type { PageServerLoad } from './$types';

const PAGE_SIZES = [10, 20, 50, 100] as const;

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user || !locals.user.company) {
		return { logs: [], totalCount: 0, limit: 20, page: 1 };
	}

	const limitParam = url.searchParams.get('limit');
	const limit = PAGE_SIZES.includes(Number(limitParam) as (typeof PAGE_SIZES)[number])
		? Number(limitParam)
		: 20;
	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
	const offset = (page - 1) * limit;

	try {
		const [logs, totalCount] = await Promise.all([
			prisma.dropCall.findMany({
				where: { companyId: locals.user.company.id },
				orderBy: { created: 'desc' },
				skip: offset,
				take: limit
			}),
			prisma.dropCall.count({
				where: { companyId: locals.user.company.id }
			})
		]);

		return {
			logs,
			totalCount,
			limit,
			page
		};
	} catch (error) {
		console.error('Failed to load drop calls:', error);
		return { logs: [], totalCount: 0, limit, page };
	}
};
