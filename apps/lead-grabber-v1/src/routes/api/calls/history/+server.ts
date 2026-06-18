import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized, pagination } from '$lib/api/spec';

function formatDuration(sec: number | null): string {
	if (sec == null || sec < 0) return '00:00';
	const m = Math.floor(sec / 60);
	const s = Math.floor(sec % 60);
	return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
	const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)));
	const skip = (page - 1) * limit;

	const where = { companyId: auth.companyId, type: 'voice' as const };
	const [total, logs] = await Promise.all([
		prisma.communicationLog.count({ where }),
		prisma.communicationLog.findMany({
			where,
			skip,
			take: limit,
			orderBy: { created: 'desc' },
			include: { customer: { select: { id: true, name: true } } }
		})
	]);

	const meta = (l: { metadata?: unknown }) =>
		(l.metadata as { startedAt?: string; endedAt?: string }) ?? {};
	const data = logs.map((l) => {
		const m = meta(l);
		return {
			id: l.id,
			contactId: l.customerId,
			contactName: l.customer?.name ?? l.summary ?? null,
			contactNumber: l.direction === 'outbound' ? l.destination : l.source,
			direction: l.direction,
			duration: l.duration ?? 0,
			durationFormatted: formatDuration(l.duration),
			status: l.status,
			startedAt: m.startedAt ?? l.created.toISOString(),
			endedAt: m.endedAt ?? l.created.toISOString()
		};
	});

	return json({
		success: true,
		data,
		pagination: pagination(page, limit, total)
	});
};
