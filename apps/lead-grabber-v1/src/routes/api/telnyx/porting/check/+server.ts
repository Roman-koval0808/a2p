import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { phone_numbers } = await request.json();

		if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
			return json(
				{
					success: false,
					error: 'phone_numbers array is required'
				},
				{ status: 400 }
			);
		}

		// Check portability for each number
		const portabilityChecks = await Promise.all(
			phone_numbers.map(async (phoneNumber: string) => {
				try {
					const response = await fetch(`https://api.telnyx.com/v2/porting/portability/check`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${TELNYX_API_KEY}`
						},
						body: JSON.stringify({
							phone_number: phoneNumber
						})
					});

					const data = await response.json();

					if (!response.ok) {
						return {
							number: phoneNumber,
							status: 'Error',
							error: data.errors?.[0]?.detail || 'Failed to check portability'
						};
					}

					return {
						number: phoneNumber,
						status: data.data?.portable ? 'Portable' : 'Not Portable',
						carrier: data.data?.carrier_name || 'Unknown',
						numberType: data.data?.number_type || 'Unknown',
						portable: data.data?.portable || false
					};
				} catch (error) {
					return {
						number: phoneNumber,
						status: 'Error',
						error: error instanceof Error ? error.message : 'Unknown error'
					};
				}
			})
		);

		return json({
			success: true,
			results: portabilityChecks
		});
	} catch (error) {
		console.error('Error checking portability:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
