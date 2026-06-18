import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';

// Telnyx Call Control API - Bridge command
export const POST: RequestHandler = async ({ request }) => {
	try {
		const { call_control_id, to, from, timeout_secs } = await request.json();

		if (!call_control_id || !to) {
			return json(
				{
					success: false,
					error: 'call_control_id and to are required'
				},
				{ status: 400 }
			);
		}

		const bridgePayload: any = {
			to
		};

		if (from) {
			bridgePayload.from = from;
		}

		if (timeout_secs) {
			bridgePayload.timeout_secs = timeout_secs;
		}

		const response = await fetch(
			`https://api.telnyx.com/v2/calls/${call_control_id}/actions/bridge`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TELNYX_API_KEY}`
				},
				body: JSON.stringify(bridgePayload)
			}
		);

		const data = await response.json();

		if (!response.ok) {
			console.error('Telnyx bridge error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to bridge call'
				},
				{ status: response.status }
			);
		}

		return json({
			success: true,
			result: data.data
		});
	} catch (error) {
		console.error('Error bridging call:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
