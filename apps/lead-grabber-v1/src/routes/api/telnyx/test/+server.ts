import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	TELNYX_API_KEY,
	TELNYX_PHONE_NUMBER,
	TELNYX_MESSAGING_PROFILE_ID
} from '$env/static/private';

export const GET: RequestHandler = async () => {
	try {
		// Fetch profile info to test API key and connectivity
		const response = await fetch(
			`https://api.telnyx.com/v2/messaging_profiles/${TELNYX_MESSAGING_PROFILE_ID}`,
			{
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${TELNYX_API_KEY}`
				}
			}
		);

		const profileData = await response.json();

		return json({
			success: response.ok,
			phoneNumber: TELNYX_PHONE_NUMBER,
			hasApiKey: !!TELNYX_API_KEY,
			hasMessagingProfileId: !!TELNYX_MESSAGING_PROFILE_ID,
			profileStatus: response.ok ? 'OK' : 'ERROR',
			profileDetails: response.ok ? profileData.data : null,
			error: !response.ok ? profileData : null
		});
	} catch (error) {
		console.error('Telnyx test error:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : String(error),
				phoneNumber: TELNYX_PHONE_NUMBER,
				hasApiKey: !!TELNYX_API_KEY,
				hasMessagingProfileId: !!TELNYX_MESSAGING_PROFILE_ID,
				profileStatus: 'ERROR'
			},
			{ status: 500 }
		);
	}
};
