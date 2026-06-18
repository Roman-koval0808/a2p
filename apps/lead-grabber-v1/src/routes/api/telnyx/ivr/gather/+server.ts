import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';

// Telnyx Call Control API - Gather Using Audio command
export const POST: RequestHandler = async ({ request }) => {
	try {
		const {
			call_control_id,
			audio_url,
			invalid_audio_url,
			timeout_millis,
			minimum_digits,
			maximum_digits,
			terminating_digit,
			finish_on_key,
			client_state
		} = await request.json();

		if (!call_control_id || !audio_url) {
			return json(
				{
					success: false,
					error: 'call_control_id and audio_url are required'
				},
				{ status: 400 }
			);
		}

		const gatherPayload: Record<string, unknown> = {
			audio_url,
			...(invalid_audio_url && { invalid_audio_url }),
			...(timeout_millis != null && { timeout_millis: Number(timeout_millis) }),
			...(minimum_digits != null && { minimum_digits: Number(minimum_digits) }),
			...(maximum_digits != null && { maximum_digits: Number(maximum_digits) }),
			...((terminating_digit ?? finish_on_key) != null && {
				terminating_digit: terminating_digit ?? finish_on_key
			}),
			...(client_state && { client_state })
		};

		const response = await fetch(
			`https://api.telnyx.com/v2/calls/${call_control_id}/actions/gather_using_audio`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TELNYX_API_KEY}`
				},
				body: JSON.stringify(gatherPayload)
			}
		);

		const data = await response.json();

		if (!response.ok) {
			console.error('Telnyx gather error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to gather input'
				},
				{ status: response.status }
			);
		}

		return json({
			success: true,
			result: data.data
		});
	} catch (error) {
		console.error('Error gathering input:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
