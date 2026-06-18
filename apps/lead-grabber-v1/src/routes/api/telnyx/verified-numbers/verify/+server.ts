import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { phone_number, verification_code } = await request.json();

		if (!phone_number || !verification_code) {
			return json(
				{
					success: false,
					error: 'phone_number and verification_code are required'
				},
				{ status: 400 }
			);
		}

		// Verify the code
		const response = await fetch(
			`https://api.telnyx.com/v2/verified_numbers/${encodeURIComponent(phone_number)}/verify`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TELNYX_API_KEY}`
				},
				body: JSON.stringify({
					verification_code
				})
			}
		);

		const data = await response.json();

		if (!response.ok) {
			console.error('Telnyx verify code error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to verify code'
				},
				{ status: response.status }
			);
		}

		return json({
			success: true,
			verified: data.data
		});
	} catch (error) {
		console.error('Error verifying code:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
