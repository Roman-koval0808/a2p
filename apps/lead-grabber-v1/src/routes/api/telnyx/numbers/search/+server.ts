import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const countryCode = url.searchParams.get('country_code') || 'US';
		const areaCode = url.searchParams.get('area_code');
		const phoneNumber = url.searchParams.get('phone_number');
		const limit = url.searchParams.get('limit') || '20';
		const features = url.searchParams.get('features'); // sms, voice, mms

		// Build query params for Telnyx API
		const params = new URLSearchParams({
			'filter[country_code]': countryCode,
			'page[size]': limit
		});

		// Best effort: return similar results if exact match not found (US/CA only)
		if (countryCode === 'US' || countryCode === 'CA') {
			params.append('filter[best_effort]', 'true');
		}

		if (areaCode) {
			params.append('filter[national_destination_code]', areaCode);
		}

		if (phoneNumber) {
			params.append('filter[contains]', phoneNumber);
		}

		if (features) {
			// Telnyx expects filter[features]=voice (not filter[features][voice]=true)
			const featureList = features.split(',');
			featureList.forEach((feature) => {
				params.append('filter[features]', feature.trim());
			});
		}

		const response = await fetch(
			`https://api.telnyx.com/v2/available_phone_numbers?${params.toString()}`,
			{
				method: 'GET',
				headers: {
					Authorization: `Bearer ${TELNYX_API_KEY}`
				}
			}
		);

		const data = await response.json();

		if (!response.ok) {
			console.error('Telnyx search error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to search numbers'
				},
				{ status: response.status }
			);
		}

		// Transform Telnyx response to match frontend format
		const numbers =
			data.data?.map((num: any) => ({
				number: num.phone_number,
				location: num.region_information?.[0]?.region_name || 'Unknown',
				type: num.phone_number_type || 'Local',
				upfront: `$${num.cost_information?.upfront_cost || '0.00'}`,
				monthly: `$${num.cost_information?.monthly_cost || '0.00'}`,
				features: {
					sms: num.features?.sms || false,
					voice: num.features?.voice || false,
					mms: num.features?.mms || false
				}
			})) || [];

		return json({
			success: true,
			numbers,
			meta: data.meta
		});
	} catch (error) {
		console.error('Error searching numbers:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
