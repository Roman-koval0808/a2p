import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { prisma } from '$lib/db';

function getDateRange(period: string): { start: Date; end: Date } {
	const end = new Date();
	end.setHours(23, 59, 59, 999);
	const start = new Date();
	start.setHours(0, 0, 0, 0);
	if (period === 'last_7') {
		start.setDate(start.getDate() - 6);
	} else if (period === 'last_30') {
		start.setDate(start.getDate() - 29);
	} else {
		start.setDate(1);
	}
	return { start, end };
}

/** All days between start and end (inclusive), YYYY-MM-DD */
function getDaysInRange(start: Date, end: Date): string[] {
	const days: string[] = [];
	const d = new Date(start);
	d.setHours(0, 0, 0, 0);
	const endDay = new Date(end);
	endDay.setHours(0, 0, 0, 0);
	while (d <= endDay) {
		days.push(d.toISOString().slice(0, 10));
		d.setDate(d.getDate() + 1);
	}
	return days;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user?.company?.id) {
		throw redirect(302, '/login');
	}
	const companyId = locals.user.company.id;
	const period = url.searchParams.get('period') || 'this_month';
	const { start, end } = getDateRange(period);

	const [categories, companyNumbers, voiceLogs, countsByCategory, totals, callsByDay, durationAgg] =
		await Promise.all([
			prisma.callTrackingCategory.findMany({
				where: { companyId },
				orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
			}),
			prisma.companyPhoneNumber.findMany({
				where: { companyId },
				include: { callTrackingCategory: { select: { id: true, name: true } } },
				orderBy: { created: 'asc' }
			}),
			prisma.communicationLog.findMany({
				where: {
					companyId,
					type: 'voice',
					created: { gte: start, lte: end }
				},
				orderBy: { created: 'desc' },
				take: 50,
				include: {
					callTrackingCategory: { select: { id: true, name: true } },
					customer: { select: { id: true, name: true, phone: true } }
				}
			}),
			prisma.communicationLog.groupBy({
				by: ['callTrackingCategoryId', 'direction'],
				where: {
					companyId,
					type: 'voice',
					created: { gte: start, lte: end }
				},
				_count: { id: true }
			}),
			prisma.communicationLog.groupBy({
				by: ['direction'],
				where: {
					companyId,
					type: 'voice',
					created: { gte: start, lte: end }
				},
				_count: { id: true }
			}),
			// Calls per day for chart (raw for date bucketing)
			prisma.$queryRaw<
				{ day: Date; direction: string; count: bigint }[]
			>`SELECT created::date as day, direction, COUNT(*)::bigint as count
  FROM communication_logs
  WHERE "companyId" = ${companyId} AND type = 'voice' AND created >= ${start} AND created <= ${end}
  GROUP BY created::date, direction
  ORDER BY day`.then((rows) =>
				rows.map((r) => ({
					day:
						r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
					direction: r.direction,
					count: Number(r.count)
				}))
			),
			// Average call duration (seconds)
			prisma.communicationLog.aggregate({
				where: {
					companyId,
					type: 'voice',
					created: { gte: start, lte: end },
					duration: { not: null }
				},
				_avg: { duration: true },
				_count: { id: true }
			})
		]);

	const inboundTotal = totals.find((t) => t.direction === 'inbound')?._count?.id ?? 0;
	const outboundTotal = totals.find((t) => t.direction === 'outbound')?._count?.id ?? 0;

	// Build category stats: { categoryId: { name, inbound, outbound } }
	const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
	const byCategory: Record<
		string,
		{ name: string; inbound: number; outbound: number; total: number }
	> = {};
	for (const c of categories) {
		byCategory[c.id] = { name: c.name, inbound: 0, outbound: 0, total: 0 };
	}
	byCategory['_none'] = { name: 'Uncategorized', inbound: 0, outbound: 0, total: 0 };
	for (const row of countsByCategory) {
		const key = row.callTrackingCategoryId ?? '_none';
		const name = key === '_none' ? 'Uncategorized' : (categoryNames.get(key) ?? 'Unknown');
		if (!byCategory[key]) byCategory[key] = { name, inbound: 0, outbound: 0, total: 0 };
		const count = row._count.id;
		if (row.direction === 'inbound') byCategory[key].inbound = count;
		else if (row.direction === 'outbound') byCategory[key].outbound = count;
	}
	for (const k of Object.keys(byCategory)) {
		byCategory[k].total = byCategory[k].inbound + byCategory[k].outbound;
	}

	// Build callsOverTime: one entry per day with inbound/outbound
	const dayMap = new Map<string, { inbound: number; outbound: number }>();
	for (const dayStr of getDaysInRange(start, end)) {
		dayMap.set(dayStr, { inbound: 0, outbound: 0 });
	}
	for (const row of callsByDay) {
		const day = row.day;
		if (!dayMap.has(day)) dayMap.set(day, { inbound: 0, outbound: 0 });
		const entry = dayMap.get(day)!;
		if (row.direction === 'inbound') entry.inbound = row.count;
		else if (row.direction === 'outbound') entry.outbound = row.count;
	}
	const callsOverTime = Array.from(dayMap.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, v]) => ({ date, ...v }));

	const avgDurationSeconds = durationAgg._avg.duration ?? null;
	const callsWithDuration = durationAgg._count.id;

	// Peak day (by total calls)
	let peakDay: { date: string; count: number } | null = null;
	for (const row of callsOverTime) {
		const total = row.inbound + row.outbound;
		if (total > 0 && (!peakDay || total > peakDay.count)) {
			peakDay = { date: row.date, count: total };
		}
	}

	return {
		period,
		start: start.toISOString(),
		end: end.toISOString(),
		categories,
		companyNumbers,
		voiceLogs,
		callsOverTime,
		avgDurationSeconds,
		callsWithDuration,
		peakDay,
		stats: {
			inboundTotal,
			outboundTotal,
			totalCalls: inboundTotal + outboundTotal,
			byCategory: Object.entries(byCategory).filter(
				([, v]) => v.total > 0 || v.name === 'Uncategorized'
			)
		}
	};
};
