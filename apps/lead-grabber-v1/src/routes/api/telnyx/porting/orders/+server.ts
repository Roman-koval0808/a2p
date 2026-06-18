import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();

		// Required fields for porting order
		const {
			phone_numbers,
			end_user_name,
			authorized_person_name,
			account_number,
			billing_telephone_number,
			customer_reference,
			pin_passcode,
			customer_group_reference,
			service_address,
			requested_foc_date,
			messaging_profile_id,
			connection_id
		} = body;

		if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
			return json(
				{
					success: false,
					error: 'phone_numbers array is required'
				},
				{ status: 400 }
			);
		}

		// Build porting order payload
		const orderPayload: any = {
			phone_numbers: phone_numbers.map((num: string) => ({
				phone_number: num
			})),
			end_user_name,
			authorized_person_name,
			account_number,
			billing_telephone_number,
			customer_reference,
			pin_passcode,
			customer_group_reference,
			service_address: {
				street_name: service_address?.street_name || '',
				city: service_address?.city || '',
				state: service_address?.state || '',
				postal_code: service_address?.postal_code || '',
				country_code: service_address?.country_code || 'US'
			},
			requested_foc_date
		};

		if (messaging_profile_id) {
			orderPayload.messaging_profile_id = messaging_profile_id;
		}

		if (connection_id) {
			orderPayload.connection_id = connection_id;
		}

		const response = await fetch('https://api.telnyx.com/v2/porting/orders', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${TELNYX_API_KEY}`
			},
			body: JSON.stringify(orderPayload)
		});

		const data = await response.json();

		if (!response.ok) {
			console.error('Telnyx porting order error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to create porting order'
				},
				{ status: response.status }
			);
		}

		return json({
			success: true,
			order: data.data,
			orderId: data.data?.id
		});
	} catch (error) {
		console.error('Error creating porting order:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};

export const GET: RequestHandler = async ({ url }) => {
	try {
		const page = url.searchParams.get('page') || '1';
		const limit = url.searchParams.get('limit') || '20';

		const params = new URLSearchParams({
			'page[number]': page,
			'page[size]': limit
		});

		const response = await fetch(`https://api.telnyx.com/v2/porting/orders?${params.toString()}`, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${TELNYX_API_KEY}`
			}
		});

		const data = await response.json();

		if (!response.ok) {
			console.error('Telnyx porting orders error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to fetch porting orders'
				},
				{ status: response.status }
			);
		}

		return json({
			success: true,
			orders: data.data || [],
			meta: data.meta
		});
	} catch (error) {
		console.error('Error fetching porting orders:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
