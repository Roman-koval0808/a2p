import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const page = url.searchParams.get('page') || '1';
		const limit = url.searchParams.get('limit') || '50';
		const search = url.searchParams.get('search');

		const params = new URLSearchParams({
			'page[number]': page,
			'page[size]': limit
		});

		if (search) {
			params.append('filter[phone_number][contains]', search);
		}

		const response = await fetch(
			`https://api.telnyx.com/v2/verified_numbers?${params.toString()}`,
			{
				method: 'GET',
				headers: {
					Authorization: `Bearer ${TELNYX_API_KEY}`
				}
			}
		);

		const data = await response.json();

		if (!response.ok) {
			console.error('Telnyx verified numbers error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to fetch verified numbers'
				},
				{ status: response.status }
			);
		}

		const verifiedNumbers =
			data.data?.map((num: any) => ({
				number: num.phone_number,
				verifiedAt: new Date(num.verified_at || num.created_at).toLocaleString(),
				id: num.id
			})) || [];

		return json({
			success: true,
			numbers: verifiedNumbers,
			meta: data.meta
		});
	} catch (error) {
		console.error('Error fetching verified numbers:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { phone_number } = await request.json();

		if (!phone_number) {
			return json(
				{
					success: false,
					error: 'phone_number is required'
				},
				{ status: 400 }
			);
		}

		// Request verification code
		const response = await fetch('https://api.telnyx.com/v2/verified_numbers', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${TELNYX_API_KEY}`
			},
			body: JSON.stringify({
				phone_number
			})
		});

		const data = await response.json();

		if (!response.ok) {
			console.error('Telnyx verify number error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to request verification'
				},
				{ status: response.status }
			);
		}

		return json({
			success: true,
			verification: data.data
		});
	} catch (error) {
		console.error('Error verifying number:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
