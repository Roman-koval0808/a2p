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

		// Fetch raw telemetry events from ProfileDB
		const profileDbUrl = process.env.PROFILEDB_URL || 'http://localhost:6277';
		const profileDbRes = await fetch(`${profileDbUrl}/api/v1/tenants/clearsky-demo/events?limit=${limit}&page=${page}`);
		if (!profileDbRes.ok) {
			console.error('ProfileDB events fetch failed:', profileDbRes.status);
			return {
				logs: [],
				members: membersForPicker,
				useA2pCommLog: true,
				totalCount: 0,
				limit,
				page
			};
		}
		const data = await profileDbRes.json();
		const events = Array.isArray(data.data) ? data.data : [];

		const logs = events.map((ev: any) => {
			const payload = ev.payload || {};
			const type = ev.eventType.includes('sms') ? 'sms' : (ev.eventType.includes('voicemail') || ev.eventType.includes('call') ? 'voice' : 'web');
			const direction = ev.eventType.includes('received') || ev.eventType.includes('incoming') || ev.eventType === 'sms_received' || ev.eventType === 'telnyx.voice.voicemail' ? 'inbound' : 'outbound';
			
			// Extract clean display name/source
			let source = '—';
			if (payload.phone || payload.customer_phone) {
				source = payload.phone || payload.customer_phone;
			} else if (ev.customerProfile?.name) {
				source = ev.customerProfile.name;
			} else if (ev.customerProfile?.phone && ev.customerProfile.phone.length < 20) {
				source = ev.customerProfile.phone;
			} else {
				source = 'Lead (' + ev.customerProfileId.slice(0, 6) + ')';
			}

			let summary = payload.detail || payload.body || payload.text || payload.textContent || payload.voicemail_text || ev.eventType;
			if (ev.eventType === 'telnyx.voice.voicemail') {
				summary = `Voicemail: "${payload.voicemail_text || 'Emergency call'}"`;
			} else if (ev.eventType === 'sms_sent') {
				summary = `SMS Sent: "${payload.body || payload.text || summary}"`;
			} else if (ev.eventType === 'sms_received') {
				summary = `SMS Received: "${payload.body || payload.text || summary}"`;
			} else if (ev.eventType === 'call_initiated') {
				summary = `Outbound Call: "${payload.detail || summary}"`;
			} else if (ev.eventType === 'job_completed') {
				summary = `Job Completed: Invoiced $${Number(payload.revenue || 250.00).toFixed(2)}`;
			}

			return {
				id: ev.id,
				type,
				direction,
				status: ev.intentBucket === 'emergency' ? 'red' : (ev.intentBucket === 'active' ? 'blue' : 'green'),
				source,
				destination: payload.to || payload.from || 'clearsky-demo',
				summary: summary,
				content: payload.textContent || payload.voicemail_text || payload.body || payload.text || '',
				metadata: {
					urgency_gpt: ev.intentBucket === 'emergency' ? 5 : 1,
					category_gpt: ev.intentBucket || 'General',
					subcat_gpt: ev.eventType,
					score: ev.engagementScore || ev.score || 0,
					scoreDelta: ev.scoreDelta || ev.delta || 0
				},
				created: ev.occurredAt,
				updated: ev.occurredAt,
				expand: {
					user_id: { name: 'System' },
					customer_id: {
						id: ev.customerProfileId,
						name: ev.customerProfile?.name || 'Customer',
						phone: payload.phone || payload.customer_phone || undefined,
						email: payload.email || payload.customer_email || undefined
					},
					assigned_members: []
				},
				raw: ev
			};
		});

		return {
			logs,
			members: membersForPicker,
			useA2pCommLog: true,
			totalCount: data.pagination?.total || 0,
			limit,
			page
		};
	} catch (err) {
		console.error('Error loading communication logs:', err);
		return { logs: [], members: [], useA2pCommLog: false, totalCount: 0, limit: 20, page: 1 };
	}
};
