import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';

// Telnyx Call Control API - Speak command
export const POST: RequestHandler = async ({ request }) => {
	try {
		const { call_control_id, text, voice, language } = await request.json();

		if (!call_control_id || !text) {
			return json(
				{
					success: false,
					error: 'call_control_id and text are required'
				},
				{ status: 400 }
			);
		}

		const speakPayload: any = {
			payload: text
		};

		if (voice) {
			speakPayload.voice = voice;
		}

		if (language) {
			speakPayload.language = language;
		}

		const response = await fetch(
			`https://api.telnyx.com/v2/calls/${call_control_id}/actions/speak`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TELNYX_API_KEY}`
				},
				body: JSON.stringify(speakPayload)
			}
		);

		const data = await response.json();

		if (!response.ok) {
			console.error('Telnyx speak error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to speak'
				},
				{ status: response.status }
			);
		}

		return json({
			success: true,
			result: data.data
		});
	} catch (error) {
		console.error('Error speaking:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
