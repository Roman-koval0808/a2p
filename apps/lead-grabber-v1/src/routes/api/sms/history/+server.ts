import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized, pagination } from '$lib/api/spec';

export const GET: RequestHandler = async ({ url, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
	const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)));
	const skip = (page - 1) * limit;

	const where = { companyId: auth.companyId, type: 'sms' as const };
	const [total, logs] = await Promise.all([
		prisma.communicationLog.count({ where }),
		prisma.communicationLog.findMany({
			where,
			skip,
			take: limit,
			orderBy: { created: 'desc' },
			include: { customer: { select: { name: true } } }
		})
	]);

	const data = logs.map((l) => ({
		id: l.id,
		direction: l.direction,
		from: l.direction === 'outbound' ? l.source : l.destination,
		to: l.direction === 'outbound' ? l.destination : l.source,
		contactName: l.customer?.name ?? null,
		message: l.content ?? l.summary ?? '',
		status: l.status === 'success' || l.status === 'completed' ? 'delivered' : l.status,
		timestamp: l.created.toISOString()
	}));

	return json({
		success: true,
		data,
		pagination: pagination(page, limit, total)
	});
};
