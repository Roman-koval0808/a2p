import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { phone_number_id, ...updateData } = body;

		if (!phone_number_id) {
			return json(
				{
					success: false,
					error: 'phone_number_id is required'
				},
				{ status: 400 }
			);
		}

		// Build update payload
		const updatePayload: any = {};

		if (updateData.connection_id !== undefined) {
			updatePayload.connection_id = updateData.connection_id;
		}

		if (updateData.messaging_profile_id !== undefined) {
			updatePayload.messaging_profile_id = updateData.messaging_profile_id;
		}

		if (updateData.tags !== undefined) {
			updatePayload.tags = updateData.tags;
		}

		if (updateData.emergency_enabled !== undefined) {
			updatePayload.emergency_enabled = updateData.emergency_enabled;
		}

		const response = await fetch(`https://api.telnyx.com/v2/phone_numbers/${phone_number_id}`, {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${TELNYX_API_KEY}`
			},
			body: JSON.stringify(updatePayload)
		});

		const data = await response.json();

		if (!response.ok) {
			console.error('Telnyx update error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to update number'
				},
				{ status: response.status }
			);
		}

		return json({
			success: true,
			number: data.data
		});
	} catch (error) {
		console.error('Error updating number:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
