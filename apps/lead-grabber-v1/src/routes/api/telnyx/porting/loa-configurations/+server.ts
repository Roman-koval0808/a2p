import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';

export const GET: RequestHandler = async () => {
	try {
		const response = await fetch('https://api.telnyx.com/v2/porting/loa_configurations', {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${TELNYX_API_KEY}`
			}
		});

		const data = await response.json();

		if (!response.ok) {
			console.error('Telnyx LOA configurations error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to fetch LOA configurations'
				},
				{ status: response.status }
			);
		}

		return json({
			success: true,
			configurations: data.data || []
		});
	} catch (error) {
		console.error('Error fetching LOA configurations:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
