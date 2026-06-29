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

		const companyId = locals.user.company.id;

		// Fetch both tables with size offset + limit to correctly paginate after sorting
		const maxTake = offset + limit;

		const dbLogs = await prisma.communicationLog.findMany({
			where: { companyId },
			include: {
				assignedMembers: {
					include: { user: true }
				},
				communicationThread: {
					include: { contact: true }
				},
				customer: true
			},
			orderBy: { created: 'desc' },
			take: maxTake
		});

		const dbDropCalls = await prisma.dropCall.findMany({
			where: { companyId },
			orderBy: { created: 'desc' },
			take: maxTake
		});

		const logCount = await prisma.communicationLog.count({
			where: { companyId }
		});

		const dropCallCount = await prisma.dropCall.count({
			where: { companyId }
		});

		const totalCount = logCount + dropCallCount;

		// Map communication logs
		const mappedLogs = dbLogs.map((log) => {
			const assignedMemberNames = log.assignedMembers.map((am) => am.user.name || am.user.email);
			
			let status = 'green';
			if (log.status === 'pending_approval') {
				status = 'blue';
			} else if (log.direction === 'inbound') {
				status = 'in';
			} else {
				status = 'out';
			}

			let purpose = 'General';
			const meta = (log.metadata as any) || {};
			if (log.status === 'pending_approval') {
				purpose = 'Confirm';
			} else if (meta.category_gpt) {
				purpose = meta.category_gpt;
			}

			const isOutbound = log.direction === 'outbound';
			let customerValue = isOutbound ? log.destination : log.source;
			let companyValue = isOutbound ? log.source : log.destination;
			
			const customerNameOrPhone = log.customer?.name || log.communicationThread?.contact?.name || customerValue || '—';
			const companyNameOrPhone = companyValue || companyId;

			// If inbound: customer sent it (source), company received it (destination)
			// If outbound: company sent it (source), customer received it (destination)
			// For drafts/pending approval, the source should also display as the customer name.
			let displaySource = isOutbound 
				? (log.status === 'pending_approval' ? customerNameOrPhone : companyNameOrPhone)
				: customerNameOrPhone;
			let displayDestination = isOutbound ? customerNameOrPhone : companyNameOrPhone;
			if (!isOutbound) {
				let intentStr = '';
				if (meta.ivr_digit && meta.ivr_intent) {
					intentStr = ` (Ext ${meta.ivr_digit} - ${meta.ivr_intent})`;
				} else if (meta.ivr_intent) {
					intentStr = ` (${meta.ivr_intent})`;
				} else if (meta.ivr_digit) {
					intentStr = ` (Ext ${meta.ivr_digit})`;
				}
				displayDestination = `${companyNameOrPhone}${intentStr}`;
			}

			return {
				id: log.id,
				type: log.type,
				direction: log.direction,
				status,
				source: displaySource,
				destination: displayDestination,
				summary: log.summary || log.content || '',
				content: log.content || '',
				metadata: meta,
				created: log.created,
				updated: log.updated.toISOString(),
				commId: log.communicationThread?.id || log.communicationThreadId,
				threadStatus: log.communicationThread?.status,
				threadSummary: log.communicationThread?.summary,
				assignedMemberNames,
				raw: log,
				isDropCall: false
			};
		});

		// Map drop calls
		const mappedDropCalls = dbDropCalls.map((dc) => {
			return {
				id: dc.id,
				type: 'voice',
				direction: 'inbound',
				status: 'red', // red status color
				source: dc.phoneNumber,
				destination: 'IVR (Dropped)',
				summary: `Dropped Call - duration ${Math.round(dc.duration)}s (${dc.knownContact ? 'Known Contact' : 'Unknown Contact'})`,
				content: `Call from ${dc.phoneNumber} hung up in IVR after ${dc.duration} seconds.`,
				metadata: { isDropCall: true, duration: dc.duration, knownContact: dc.knownContact },
				created: dc.created,
				updated: dc.updated.toISOString(),
				commId: `DROP-${dc.id.slice(-6).toUpperCase()}`,
				threadStatus: 'failed',
				threadSummary: 'Dropped in IVR',
				assignedMemberNames: [],
				raw: dc,
				isDropCall: true
			};
		});

		// Merge and sort in memory
		const combined = [...mappedLogs, ...mappedDropCalls].sort(
			(a, b) => b.created.getTime() - a.created.getTime()
		);

		// Slice for pagination and format created date to string
		const logs = combined.slice(offset, offset + limit).map((item) => ({
			...item,
			created: item.created.toISOString()
		}));

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
