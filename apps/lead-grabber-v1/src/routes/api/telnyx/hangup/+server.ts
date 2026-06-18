import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { callId } = await request.json();

		if (!callId) {
			return json({ success: false, error: 'Missing call ID' }, { status: 400 });
		}

		console.log('Hanging up call:', callId);

		// Call Telnyx API to hang up the call
		const response = await fetch(`https://api.telnyx.com/v2/calls/${callId}/actions/hangup`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${TELNYX_API_KEY}`
			},
			body: JSON.stringify({})
		});

		const data = await response.json();

		if (!response.ok) {
			console.error('Telnyx hangup API error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to hang up call'
				},
				{ status: 500 }
			);
		}

		return json({ success: true });
	} catch (error) {
		console.error('Error hanging up call:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
