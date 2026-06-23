import { prisma } from '$lib/db';
import { redirect, error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, fetch }) => {
	const user = locals.user;

	if (!user) {
		throw redirect(303, '/login');
	}

	if (!user.company) {
		throw redirect(303, '/create-company');
	}

	const companyId = user.company.id;
	const PROFILEDB_URL = process.env.PROFILEDB_URL || 'http://localhost:6277';

	// Get user's role
	const companyMember = await prisma.companyMember.findFirst({
		where: {
			userId: user.id,
			companyId: user.company.id
		}
	});
	const userRole = companyMember?.role || 'member';

	// If super admin, fetch all representatives for assignment dropdown
	let representatives: any[] = [];
	if (userRole === 'admin') {
		const members = await prisma.companyMember.findMany({
			where: { companyId: user.company.id, role: 'member' },
			include: { user: true }
		});
		representatives = members.map(m => ({ id: m.user.id, name: m.user.name, email: m.user.email }));
	}

	try {
		// 1. Fetch profile from ProfileDB
		let profileRes = await fetch(`${PROFILEDB_URL}/api/v1/tenants/${locals.user.company.id}/profiles/${params.id}`);
		let cdpProfile: any = null;
		if (profileRes.ok) {
			cdpProfile = await profileRes.json();
		}

		// 2. Fetch history from ProfileDB
		let historyRes = await fetch(`${PROFILEDB_URL}/api/v1/tenants/${locals.user.company.id}/profiles/${params.id}/history`);
		let historyEvents: any[] = [];
		if (historyRes.ok) {
			historyEvents = await historyRes.json();
		}

		// Fallback to prisma contact if not found in CDP
		if (!cdpProfile) {
			const dbProfile = await prisma.contact.findFirst({
				where: { id: params.id, companyId }
			});
			if (!dbProfile) {
				throw error(404, 'Profile not found');
			}
			// Map dbProfile to look like CDP Profile
			cdpProfile = {
				id: dbProfile.id,
				name: dbProfile.name || 'Unknown Caller',
				phone: dbProfile.phone || '',
				email: dbProfile.email || '',
				clearPhone: dbProfile.phone || '—',
				clearEmail: dbProfile.email || '—',
				tier: 'T3',
				scoreLive: 0,
				intentBucket: 'unclassified',
				isAnonymous: !dbProfile.email && !dbProfile.phone,
				lastSeen: dbProfile.updated || new Date()
			};
		}

		// 3. Compute Identity Resolution History
		const identityHistory: any[] = [];
		let currentName: string | null = null;
		let currentEmail: string | null = null;
		let currentPhone: string | null = null;

		let clearPhone = cdpProfile.clearPhone || '—';
		let clearEmail = cdpProfile.clearEmail || '—';

		historyEvents.forEach((ev: any) => {
			const payload = ev.payload || {};
			const emailVal = payload.email || null;
			const nameVal = payload.name || null;
			const phoneVal = payload.phone || null;

			if (phoneVal && phoneVal !== '—') {
				clearPhone = phoneVal;
			} else if (payload.textContent && clearPhone === '—') {
				const match = payload.textContent.match(/Voice Call from:\s*(\+?[\d\s\-()]+)/);
				if (match) clearPhone = match[1].trim();
			}
			if (emailVal && emailVal !== '—') {
				clearEmail = emailVal;
			}

			if (nameVal && nameVal !== currentName) {
				identityHistory.push({
					timestamp: ev.occurredAt,
					field: 'Name',
					oldValue: currentName,
					newValue: nameVal
				});
				currentName = nameVal;
			}
			if (emailVal && emailVal !== currentEmail) {
				identityHistory.push({
					timestamp: ev.occurredAt,
					field: 'Email',
					oldValue: currentEmail,
					newValue: emailVal
				});
				currentEmail = emailVal;
			}
			if (phoneVal && phoneVal !== currentPhone) {
				identityHistory.push({
					timestamp: ev.occurredAt,
					field: 'Phone',
					oldValue: currentPhone,
					newValue: phoneVal
				});
				currentPhone = phoneVal;
			}
		});

		// 4. Compute behavioral facts
		let viewedService = false;
		let viewedPricing = false;
		let formSubmitted = false;

		historyEvents.forEach((ev: any) => {
			if (ev.pageUrl && (ev.pageUrl.includes('pricing') || ev.eventType.includes('price'))) {
				viewedPricing = true;
			}
			if (
				ev.pageUrl &&
				(ev.pageUrl.includes('service') ||
					ev.eventType.includes('svc') ||
					ev.pageUrl.includes('bathroom') ||
					ev.pageUrl.includes('roof') ||
					ev.pageUrl.includes('hot-water') ||
					ev.pageUrl.includes('drain'))
			) {
				viewedService = true;
			}
			if (ev.eventType.includes('submit') || ev.eventType.includes('booked')) {
				formSubmitted = true;
			}
		});

		let intentLevel = 'Low';
		if (cdpProfile.intentBucket === 'emergency') intentLevel = 'Emergency';
		else if (cdpProfile.scoreLive >= 80) intentLevel = 'Very High';
		else if (cdpProfile.scoreLive >= 50 || (viewedService && viewedPricing)) intentLevel = 'High';
		else if (viewedService) intentLevel = 'Medium';

		let interpretation = 'Monitor page views and visitor interaction logs to build a behavioral profile.';
		let recAction = 'Monitor Behavior';

		const isAnonymous = !clearEmail && !clearPhone;
		if (cdpProfile.intentBucket === 'emergency') {
			interpretation = 'Active emergency situation detected. Urgent assistance required. Auto-dispatching technician.';
			recAction = 'Verify dispatch status';
		} else if (intentLevel === 'High' && !formSubmitted) {
			interpretation =
				"Visitor viewed service pages and pricing, showing strong buying intent but hasn't booked yet. Recommend showing a limited-time promo banner or exit intent discount.";
			recAction = 'Show 20% Promo Banner';
		} else if (formSubmitted) {
			interpretation = 'Visitor successfully submitted a lead capture form. Follow-up workflow initiated.';
			recAction = 'Queue follow-up draft';
		} else if (intentLevel === 'Very High' && !isAnonymous) {
			interpretation =
				'High score + identified contact details. Trigger automated SMS outreach / email follow-up sequence immediately.';
			recAction = 'Notify owner / Dispatch SMS';
		}

		// 5. Parse historyEvents as Communications for the table
		const comms = historyEvents.map((ev: any) => {
			const payload = ev.payload || {};
			const dateObj = new Date(ev.occurredAt);
			const date = dateObj.toLocaleDateString('en-US', {
				month: 'short',
				day: '2-digit',
				year: 'numeric'
			});
			const time = dateObj.toLocaleTimeString('en-US', {
				hour: 'numeric',
				minute: '2-digit',
				hour12: true
			});

			const type = ev.eventType.includes('sms')
				? 'sms'
				: ev.eventType.includes('voicemail') || ev.eventType.includes('call')
					? 'voice'
					: 'web';
			const direction =
				ev.eventType.includes('received') ||
				ev.eventType.includes('incoming') ||
				ev.eventType === 'sms_received' ||
				ev.eventType === 'telnyx.voice.voicemail'
					? 'In'
					: 'Out';

			let status: 'red' | 'green' | 'blue' = 'blue';
			if (ev.intentBucket === 'emergency') {
				status = 'red';
			} else if (ev.intentBucket === 'active') {
				status = 'green';
			}

			let summary = payload.detail || payload.body || payload.text || payload.textContent || payload.voicemail_text || ev.eventType;
			const isSmsSent = ev.eventType === 'sms_sent' || ev.eventType === 'message.sent';
			const isSmsRecv = ev.eventType === 'sms_received' || ev.eventType === 'message.received';
			const isVoice = ev.eventType.includes('voicemail') || ev.eventType.includes('call') || ev.eventType.includes('voice');

			if (isVoice) {
				summary = `Voicemail: "${payload.voicemail_text || payload.textContent || payload.detail || 'Emergency call'}"`;
			} else if (isSmsSent) {
				summary = `SMS Sent: "${payload.body || payload.text || payload.detail || summary}"`;
			} else if (isSmsRecv) {
				summary = `SMS Received: "${payload.body || payload.text || payload.detail || summary}"`;
			} else if (ev.eventType === 'call_initiated') {
				summary = `Outbound Call: "${payload.detail || summary}"`;
			} else if (ev.eventType === 'job_completed') {
				summary = `Job Completed: Invoiced $${Number(payload.revenue || 250.0).toFixed(2)}`;
			}

			return {
				id: ev.id,
				date,
				time,
				type,
				direction,
				source: clearPhone !== '—' ? clearPhone : (clearEmail !== '—' ? clearEmail : 'Anonymous'),
				endpoint: payload.to || payload.from || locals.user.company.id,
				purpose: ev.intentBucket || 'unclassified',
				summary: summary,
				commId: ev.id,
				status,
				raw: ev
			};
		});

		return {
			profile: {
				...cdpProfile,
				clearPhone,
				clearEmail,
				past_names: identityHistory.filter(h => h.field === 'Name').map(h => h.newValue)
			},
			communications: comms,
			historyEvents,
			identityHistory,
			behavioralFacts: {
				viewedService,
				viewedPricing,
				formSubmitted
			},
			behavioralAnalysis: {
				intentLevel,
				interpretation,
				recAction
			},
			userRole,
			representatives,
			userCompanyId: locals.user.company.id
		};
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 404) {
			throw e;
		}
		console.error('Error fetching profile:', e);
		throw error(500, 'Failed to fetch profile');
	}
};

export const actions: Actions = {
	updateProfile: async ({ request, params, locals }) => {
		const user = locals.user;
		if (!user?.company) return { success: false };
		const form = await request.formData();
		const id = params.id;
		const name = form.get('name')?.toString() ?? null;
		const email = form.get('email')?.toString() ?? null;
		const phone = form.get('phone')?.toString() ?? null;
		try {
			await prisma.contact.updateMany({
				where: { id, companyId: user.company.id },
				data: { name, email, phone, updated: new Date() }
			});
			return { success: true };
		} catch (e) {
			console.error('Error updating profile:', e);
			return { success: false };
		}
	},
	deleteProfile: async ({ params, locals }) => {
		const user = locals.user;
		if (!user?.company) return { success: false };
		try {
			await prisma.contact.deleteMany({
				where: { id: params.id, companyId: user.company.id }
			});
			return { success: true };
		} catch (e) {
			console.error('Error deleting profile:', e);
			return { success: false };
		}
	},
	assignRepresentative: async ({ request, params, locals }) => {
		const user = locals.user;
		if (!user?.company) return { success: false };

		// Verify user is an admin
		const companyMember = await prisma.companyMember.findFirst({
			where: { userId: user.id, companyId: user.company.id }
		});
		if (companyMember?.role !== 'admin') return { success: false, error: 'Unauthorized' };

		const form = await request.formData();
		const representativeId = form.get('representativeId')?.toString() || null;
		const id = params.id;

		const PROFILEDB_URL = process.env.PROFILEDB_URL || 'http://localhost:6277';
		try {
			const res = await fetch(`${PROFILEDB_URL}/api/v1/tenants/${locals.user.company.id}/profiles/${id}/representative`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ representativeId })
			});

			if (res.ok) {
				return { success: true };
			} else {
				console.error('Failed to assign representative in ProfileDB');
				return { success: false, error: 'Failed to assign representative' };
			}
		} catch (e) {
			console.error('Error assigning representative:', e);
			return { success: false, error: 'Failed to assign representative' };
		}
	}
};
