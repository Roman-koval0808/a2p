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

	const where = { companyId: auth.companyId, type: 'email' as const };
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
		to: l.destination ?? '',
		contactName: l.customer?.name ?? null,
		subject: (l.metadata as { subject?: string })?.subject ?? l.summary ?? '',
		bodyPreview: (l.content ?? '').slice(0, 80),
		status: l.status === 'success' || l.status === 'completed' ? 'delivered' : l.status,
		timestamp: l.created.toISOString()
	}));

	return json({
		success: true,
		data,
		pagination: pagination(page, limit, total)
	});
};
