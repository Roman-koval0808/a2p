import { prisma } from '$lib/db';
import type { PageServerLoad } from './$types';
import { isA2pCommLogEnabled } from '$lib/server/a2p-client';
import { commCode } from '$lib/utils/comm-id';
import { getBookingUrl } from '$lib/utils/booking';
import { getConnectionInfo } from '$lib/server/google-calendar';

const PAGE_SIZES = [10, 20, 50, 100] as const;

export const load: PageServerLoad = async ({ locals, depends, fetch, url }) => {
	depends('app:communication-log');

	if (!locals.user || !locals.user.company) {
		return { logs: [], members: [], useA2pCommLog: false, totalCount: 0, limit: 20, page: 1, bookingUrl: null, googleCalendar: { connected: false, email: null } };
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

		// Booking link (for the Calendar popup + "not set up" warning on the page).
		const companyRow = await prisma.company.findUnique({
			where: { id: companyId },
			select: { settings: true }
		});
		const bookingUrl = getBookingUrl(companyRow);
		const googleCalendar = await getConnectionInfo(companyId);

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

			const meta = (log.metadata as any) || {};

			const isOutbound = log.direction === 'outbound';
			let customerValue = isOutbound ? log.destination : log.source;
			let companyValue = isOutbound ? log.source : log.destination;
			
			// Treat placeholder names as "no name" so we show the phone number instead of
			// a useless "Unknown Caller" for the source/endpoint.
			const GENERIC_NAMES = ['Unknown Caller', 'Unknown Customer', 'Anonymous', 'Unknown', 'Valued Customer'];
			const rawContactName = log.customer?.name || log.communicationThread?.contact?.name || '';
			const realName = rawContactName && !GENERIC_NAMES.includes(rawContactName) ? rawContactName : '';
			const customerNameOrPhone = realName || customerValue || '—';
			const companyNameOrPhone = companyValue || companyId;

			// If inbound: customer sent it (source), company received it (destination)
			// If outbound: company sent it (source), customer received it (destination)
			let displaySource = isOutbound ? companyNameOrPhone : customerNameOrPhone;
			let displayDestination = isOutbound ? customerNameOrPhone : companyNameOrPhone;

			// COM ID identifies the THREAD (topic/context): every message the thread-matcher linked
			// into the same conversation shares one random-LOOKING code; a different context — even
			// from the same customer — is a different thread and gets a different code. Unlinked
			// (brand-new) messages anchor on their own id.
			const convoCode = commCode(log.communicationThreadId, log.id);



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
				commId: convoCode,
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
			page,
			bookingUrl,
			googleCalendar
		};
	} catch (err) {
		console.error('Error loading communication logs:', err);
		return { logs: [], members: [], useA2pCommLog: false, totalCount: 0, limit: 20, page: 1, bookingUrl: null, googleCalendar: { connected: false, email: null } };
	}
};
