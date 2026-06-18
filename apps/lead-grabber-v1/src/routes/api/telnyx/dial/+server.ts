import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY, TELNYX_CONNECTION_ID } from '$env/static/private';
import { formatPhoneForDialing } from '$lib/utils/phone';
import { getFirstCompanyNumber } from '$lib/company-numbers';
import { prisma } from '$lib/db';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { to, from: fromParam, clientId } = await request.json();

		if (!to) {
			return json({ success: false, error: 'Missing destination phone number' }, { status: 400 });
		}

		const companyId = locals.user?.company?.id;
		if (!companyId) {
			return json({ success: false, error: 'Unauthorized' }, { status: 401 });
		}

		let from: string;
		if (fromParam) {
			from = fromParam;
		} else {
			const companyNumber = await getFirstCompanyNumber(prisma, companyId);
			if (!companyNumber) {
				return json(
					{
						success: false,
						error: 'No phone number assigned. Assign a number in Manage Numbers.'
					},
					{ status: 400 }
				);
			}
			from = companyNumber.phoneNumber;
		}

		// Format phone number for dialing (E.164 format)
		const formattedPhone = formatPhoneForDialing(to);

		// Create the call using Telnyx API
		const response = await fetch('https://api.telnyx.com/v2/calls', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${TELNYX_API_KEY}`
			},
			body: JSON.stringify({
				connection_id: TELNYX_CONNECTION_ID,
				to: formattedPhone,
				from,
				send_silence_when_idle: false, // Ensures continuous audio
				client_state: clientId ? btoa(JSON.stringify({ clientId })) : undefined,
				webhook_url: `${request.headers.get('origin')}/api/telnyx/call-webhook`, // Ensure webhooks are properly routed
				// Optional: Enable answering machine detection if needed
				answering_machine_detection: 'premium',
				answering_machine_detection_config: {
					total_analysis_time_millis: 5000,
					after_greeting_silence_millis: 1000,
					between_words_silence_millis: 1000,
					greeting_duration_millis: 1000,
					initial_silence_millis: 1000,
					maximum_number_of_words: 1000,
					maximum_word_length_millis: 2000,
					silence_threshold: 512,
					greeting_total_analysis_time_millis: 50000,
					greeting_silence_duration_millis: 2000
				}
			})
		});

		const data = await response.json();

		if (!response.ok) {
			console.error('Telnyx API error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to initiate call'
				},
				{ status: 500 }
			);
		}

		// Return the call ID and success status
		return json({
			success: true,
			callId: data.data.call_control_id,
			callLegId: data.data.call_leg_id
		});
	} catch (error) {
		console.error('Error initiating call:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
