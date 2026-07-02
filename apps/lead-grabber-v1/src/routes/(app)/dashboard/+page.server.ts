import { prisma } from '$lib/db';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getTenantEvents } from '$lib/server/profiledb/telemetry';
import { getTenantProfiles } from '$lib/server/profiledb/profiles';

export const load: PageServerLoad = async ({ locals, fetch }) => {
	const user = locals.user;

	if (!user) {
		throw redirect(303, '/login');
	}
	if (!user.company) {
		throw redirect(303, '/create-company');
	}

	const companyId = user.company.id;
	const now = new Date();

	// 1. Latest Communications (fetched from ProfileDB telemetry events like communication-log page)
	let latestCommunications: any[] = [];
	try {
		const result = await getTenantEvents({ tenantSlug: companyId, limit: '20' });
		if (result.status >= 200 && result.status < 300) {
			const data = result.body;
			const events = Array.isArray(data.data) ? data.data : [];

			latestCommunications = events.map((ev: any) => {
				const payload = ev.payload || {};
				const type = ev.eventType.includes('sms') ? 'sms' : (ev.eventType.includes('voicemail') || ev.eventType.includes('call') ? 'voice' : 'web');
				const direction = ev.eventType.includes('received') || ev.eventType.includes('incoming') || ev.eventType === 'sms_received' || ev.eventType === 'telnyx.voice.voicemail' ? 'inbound' : 'outbound';
				
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
					destination: payload.to || payload.from || locals.user.company.id,
					summary: summary,
					created: ev.occurredAt,
					metadata: {
						thread_id: payload.threadId || payload.thread_id || ev.customerProfileId
					}
				};
			});
		}
	} catch (err) {
		console.error('Failed to load communication events from ProfileDB:', err);
	}

	// 2. Site Visitors (CDP Profiles)
	let siteVisitors: any[] = [];
	try {
		const result = await getTenantProfiles(companyId, { limit: '10' });
		if (result.status >= 200 && result.status < 300) {
			const json = result.body;
			if (json && Array.isArray(json.data)) {
				siteVisitors = json.data;
			}
		}
	} catch (err) {
		console.error('Failed to load profiles from ProfileDB:', err);
	}

	// 3. Upcoming Appointments (seed if empty)
	let upcomingAppointments = await prisma.scheduleEvent.findMany({
		where: {
			companyId,
			startTime: { gte: now }
		},
		orderBy: { startTime: 'asc' },
		take: 5
	});

	if (upcomingAppointments.length === 0) {
		const mockEvents = [
			{
				companyId,
				title: 'Emergency Leak Consultation',
				description: 'Urgent main supply line review and valve replacement.',
				startTime: new Date(now.getTime() + 2 * 60 * 60 * 1000), // in 2 hours
				endTime: new Date(now.getTime() + 3.5 * 60 * 60 * 1000),
				color: 'red'
			},
			{
				companyId,
				title: 'Kitchen Remodel Quote Visit',
				description: 'Estimate fixture upgrade and new pipe routing.',
				startTime: new Date(now.getTime() + 24 * 60 * 60 * 1000), // tomorrow
				endTime: new Date(now.getTime() + 25.5 * 60 * 60 * 1000),
				color: 'blue'
			},
			{
				companyId,
				title: 'Drain Maintenance Diagnostic',
				description: 'Routine snake check and pipe cleaning.',
				startTime: new Date(now.getTime() + 48 * 60 * 60 * 1000), // in 2 days
				endTime: new Date(now.getTime() + 49 * 60 * 60 * 1000),
				color: 'pink'
			}
		];

		await prisma.scheduleEvent.createMany({ data: mockEvents });

		upcomingAppointments = await prisma.scheduleEvent.findMany({
			where: {
				companyId,
				startTime: { gte: now }
			},
			orderBy: { startTime: 'asc' },
			take: 5
		});
	}

	// 4. Assigned Leads
	const assignedLeads = await prisma.message.findMany({
		where: {
			companyId,
			assignedToId: user.id
		},
		orderBy: { updated: 'desc' },
		take: 5
	});

	// Stats
	const totalLeadsCount = await prisma.message.count({ where: { companyId } });
	const emergencyAlertsCount = await prisma.message.count({
		where: { companyId, intent: 'emergency' }
	});
	const activeProjectsCount = siteVisitors.filter(v => v.intentBucket === 'active').length;
	const appointmentsCount = upcomingAppointments.length;

	return {
		user,
		latestCommunications,
		siteVisitors,
		upcomingAppointments,
		assignedLeads,
		stats: {
			totalLeads: totalLeadsCount,
			emergencyAlerts: emergencyAlertsCount,
			activeProjects: activeProjectsCount,
			appointments: appointmentsCount
		}
	};
};
