import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';
import { prisma } from '$lib/db';

export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		if (!locals.user?.company?.id) {
			return json({ success: false, error: 'Unauthorized' }, { status: 401 });
		}

		const companyId = locals.user.company.id;
		const companyNumbers = await prisma.companyPhoneNumber.findMany({
			where: { companyId },
			select: { phoneNumber: true }
		});
		// Normalize to digits only for comparison (handles +1xxx vs 1xxx differences)
		const normalizeDigits = (phone: string) => phone.replace(/\D/g, '');
		const companyNumberSet = new Set(companyNumbers.map((n) => normalizeDigits(n.phoneNumber)));

		const page = url.searchParams.get('page') || '1';
		const limit = url.searchParams.get('limit') || '50';
		const search = url.searchParams.get('search');
		const status = url.searchParams.get('status');
		const connectionId = url.searchParams.get('connection_id');
		const messagingProfileId = url.searchParams.get('messaging_profile_id');

		const params = new URLSearchParams({
			'page[number]': page,
			'page[size]': limit
		});

		if (search) {
			params.append('filter[phone_number][contains]', search);
		}

		if (status) {
			params.append('filter[status]', status);
		}

		if (connectionId) {
			params.append('filter[connection_id]', connectionId);
		}

		if (messagingProfileId) {
			params.append('filter[messaging_profile_id]', messagingProfileId);
		}

		const response = await fetch(`https://api.telnyx.com/v2/phone_numbers?${params.toString()}`, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${TELNYX_API_KEY}`
			}
		});

		const data = await response.json();

		if (!response.ok) {
			console.error('Telnyx list numbers error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to list numbers'
				},
				{ status: response.status }
			);
		}

		// Only include numbers that belong to this company
		const allNumbers = data.data || [];

		// Debug logging
		console.log('[numbers/list] Company numbers in DB:', Array.from(companyNumberSet));
		console.log(
			'[numbers/list] Telnyx returned',
			allNumbers.length,
			'numbers:',
			allNumbers.map((n: any) => n.phone_number)
		);

		const numbersForCompany =
			companyNumberSet.size > 0
				? allNumbers.filter((num: any) => companyNumberSet.has(normalizeDigits(num.phone_number)))
				: [];

		console.log('[numbers/list] After filtering:', numbersForCompany.length, 'numbers match');

		const numbers = numbersForCompany.map((num: any) => ({
			number: num.phone_number,
			status: num.status || 'Unknown',
			connection: num.connection_name || '-',
			messagingProfile: num.messaging_profile_name || '-',
			tags: num.tags || [],
			features: {
				sms: num.features?.sms || false,
				voice: num.features?.voice || false,
				mms: num.features?.mms || false
			},
			id: num.id
		}));

		return json({
			success: true,
			numbers,
			meta: data.meta
		});
	} catch (error) {
		console.error('Error listing numbers:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
