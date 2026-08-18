import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';

const SCHEDULE_STATUSES = ['PENDING', 'DONE', 'SKIPPED', 'CANCELLED', 'EXPIRED'] as const;

/**
 * GET /api/a2p/schedule — the schedule is a LOOK-UP list, deliberately separate
 * from the task queue (spec §10: "the queue is today's work"). Filters: profileId,
 * status, from/to on dueAt, limit.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const companyId = locals.user?.company?.id;
	if (!companyId) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const profileId = url.searchParams.get('profileId') ?? undefined;
		const status = url.searchParams.get('status') ?? undefined;
		const from = url.searchParams.get('from') ?? undefined;
		const to = url.searchParams.get('to') ?? undefined;
		const limit = Math.min(
			200,
			Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50)
		);

		if (status && !(SCHEDULE_STATUSES as readonly string[]).includes(status)) {
			return json({ error: `status must be one of ${SCHEDULE_STATUSES.join(', ')}` }, { status: 400 });
		}

		const rows = await prisma.scheduledIntent.findMany({
			where: {
				clientId: companyId,
				...(profileId ? { profileId } : {}),
				...(status ? { status: status as (typeof SCHEDULE_STATUSES)[number] } : {}),
				...(from || to
					? {
							dueAt: {
								...(from && !isNaN(Date.parse(from)) ? { gte: new Date(from) } : {}),
								...(to && !isNaN(Date.parse(to)) ? { lte: new Date(to) } : {})
							}
						}
					: {})
			},
			orderBy: { dueAt: 'asc' },
			take: limit,
			select: {
				id: true,
				clientId: true,
				profileId: true,
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

		return json({ schedule: rows });
	} catch (err) {
		console.error('A2P schedule list error:', err);
		return json({ error: err instanceof Error ? err.message : 'Query failed' }, { status: 500 });
	}
};
