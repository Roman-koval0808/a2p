import { prisma } from '$lib/db';
import type { PageServerLoad } from './$types';
import { isA2pCommLogEnabled } from '$lib/server/a2p-client';

const PAGE_SIZES = [10, 20, 50, 100] as const;

export const load: PageServerLoad = async ({ locals, depends, fetch, url }) => {
	depends('app:communication-log');

	if (!locals.user || !locals.user.company) {
		return { logs: [], members: [], useA2pCommLog: false, totalCount: 0, limit: 20, page: 1 };
	}

	const limitParam = url.searchParams.get('limit');
	const limit = PAGE_SIZES.includes(Number(limitParam) as (typeof PAGE_SIZES)[number])
		? Number(limitParam)
		: 20;
	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
	const offset = (page - 1) * limit;

	try {
		// Company members for agent picker (same as settings/company)
		const members = await prisma.companyMember.findMany({
			where: {
				companyId: locals.user.company.id,
				status: 'active'
			},
			take: 50,
			include: {
				user: {
					select: {
						id: true,
						name: true,
						email: true
					}
				}
			},
			orderBy: {
				created: 'desc'
			}
		});
		const membersForPicker = members.map((m) => ({
			id: m.user.id,
			name: m.user.name || m.user.email || 'Unknown',
			email: m.user.email || '',
			role: m.role
		}));

		// Fetch communication threads from Prisma
		const threads = await prisma.communicationThread.findMany({
			where: { companyId: locals.user.company.id },
			include: {
				logs: {
					orderBy: { created: 'asc' },
					include: {
						assignedMembers: {
							include: { user: true }
						}
					}
				},
				contact: true,
				tasks: true
			},
			orderBy: { updated: 'desc' },
			take: limit,
			skip: offset
		});

		const totalCount = await prisma.communicationThread.count({
			where: { companyId: locals.user.company.id }
		});

		// Flatten logs for the table, but give them a thread identifier
		const logs: any[] = [];
		for (const thread of threads) {
			for (const log of thread.logs) {
				const assignedMemberNames = log.assignedMembers.map((am) => am.user.name || am.user.email);
				
				let status = 'green';
				if (log.status === 'pending_approval') {
					status = 'blue';
				} else if (log.direction === 'inbound') {
					status = 'in';
				} else {
					status = 'out';
				}

				// The 'purpose' field in UI drives the 'Confirm' button
				let purpose = 'General';
				const meta = (log.metadata as any) || {};
				if (log.status === 'pending_approval') {
					purpose = 'Confirm';
				} else if (meta.category_gpt) {
					purpose = meta.category_gpt;
				}

				let displaySource = log.source || '—';
				let displayDestination = log.destination || locals.user.company.id;

				if (thread.contact?.name) {
					if (log.direction === 'inbound') {
						displaySource = thread.contact.name;
					} else {
						displayDestination = thread.contact.name;
					}
				}

				logs.push({
					id: log.id,
					type: log.type === 'voice' ? 'call' : log.type,
					direction: log.direction,
					status: status,
					source: displaySource,
					destination: displayDestination,
					summary: log.summary || log.content || '',
					content: log.content || '',
					metadata: meta,
					created: log.created.toISOString(),
					updated: log.updated.toISOString(),
					commId: thread.id,
					threadStatus: thread.status,
					threadSummary: thread.summary,
					assignedMemberNames,
					raw: log
				});
			}
		}

		return {
			logs,
			members: membersForPicker,
			useA2pCommLog: true,
			totalCount,
			limit,
			page
		};
	} catch (err) {
		console.error('Error loading communication logs:', err);
		return { logs: [], members: [], useA2pCommLog: false, totalCount: 0, limit: 20, page: 1 };
	}
};
