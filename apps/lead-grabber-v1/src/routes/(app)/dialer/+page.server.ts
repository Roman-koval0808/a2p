import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';
import { getTenantProfiles } from '$lib/server/profiledb/profiles';

export const load: PageServerLoad = async ({ locals, fetch }) => {
	const user = locals.user;

	if (!user) {
		throw redirect(303, '/login');
	}

	// 1. Fetch profiles from ProfileDB (same as /profiles page)
	let contacts: any[] = [];
	try {
		const result = await getTenantProfiles(locals.user.company.id, { limit: '100' });
		if (result.status >= 200 && result.status < 300) {
			const json = result.body;
			if (json && Array.isArray(json.data)) {
				contacts = json.data.map((p: any) => ({
					name: p.isAnonymous ? (p.clearPhone && p.clearPhone !== '—' ? 'Caller (' + p.clearPhone + ')' : 'Anonymous Lead') : (p.name || 'Anonymous Lead'),
					phone: p.clearPhone && p.clearPhone !== '—' ? p.clearPhone : (p.phone || '')
				}));
			}
		}
	} catch (err) {
		console.error('Failed to load profiles from ProfileDB for dialer:', err);
	}

	// 2. Fetch company phone numbers from DB
	const companyId = user.company.id;
	const companyNumbers = await locals.prisma.companyPhoneNumber.findMany({
		where: { companyId },
		select: { phoneNumber: true, connectionLabel: true }
	});
	const normalizeDigits = (phone: string) => phone.replace(/\D/g, '');
	const companyNumberMap = new Map(companyNumbers.map((n) => [normalizeDigits(n.phoneNumber), n.connectionLabel]));

	// 3. Fetch active numbers from Telnyx to match what shows in /manage-numbers
	let activePhoneNumbers: any[] = [];
	try {
		const telnyxRes = await fetch(`https://api.telnyx.com/v2/phone_numbers?page[size]=100`, {
			headers: {
				Authorization: `Bearer ${TELNYX_API_KEY}`
			}
		});
		if (telnyxRes.ok) {
			const telnyxData = await telnyxRes.json();
			const allNumbers = telnyxData.data || [];
			activePhoneNumbers = allNumbers
				.filter((num: any) => companyNumberMap.has(normalizeDigits(num.phone_number)))
				.map((num: any) => ({
					phoneNumber: num.phone_number,
					connectionLabel: companyNumberMap.get(normalizeDigits(num.phone_number)) || num.connection_name || null
				}));
		}
	} catch (e) {
		console.error('Error fetching Telnyx numbers in dialer page load:', e);
	}

	// Fallback to all companyNumbers if Telnyx API fails
	const phoneNumbers = activePhoneNumbers.length > 0 ? activePhoneNumbers : companyNumbers;

	// 4. Fetch recent call history (which contains recording URLs for voicemails)
	const calls = await locals.prisma.communicationLog.findMany({
		where: {
			companyId,
			type: 'voice'
		},
		orderBy: { created: 'desc' },
		take: 50,
		include: {
			customer: true
		}
	});

	return {
		contacts,
		phoneNumbers,
		calls: JSON.parse(JSON.stringify(calls)) // Serialize Dates/Json safely
	};
};

export const actions = {
	deleteLog: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) {
			return { success: false, error: 'Unauthorized' };
		}
		
		const data = await request.formData();
		const id = data.get('id') as string;
		
		if (!id) {
			return { success: false, error: 'Missing log ID' };
		}

		try {
			await locals.prisma.communicationLog.delete({
				where: {
					id,
					companyId: user.company.id
				}
			});
			return { success: true };
		} catch (err: any) {
			console.error('Failed to delete call log:', err);
			return { success: false, error: err.message || 'Failed to delete call log' };
		}
	}
};

