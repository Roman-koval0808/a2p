import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		const { phone_number_id } = params;

		if (!phone_number_id) {
			return json(
				{
					success: false,
					error: 'phone_number_id is required'
				},
				{ status: 400 }
			);
		}

		const response = await fetch(`https://api.telnyx.com/v2/phone_numbers/${phone_number_id}`, {
			method: 'DELETE',
			headers: {
				Authorization: `Bearer ${TELNYX_API_KEY}`
			}
		});

		if (!response.ok) {
			const data = await response.json();
			console.error('Telnyx delete error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to delete number'
				},
				{ status: response.status }
			);
		}

		return json({
			success: true
		});
	} catch (error) {
		console.error('Error deleting number:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
