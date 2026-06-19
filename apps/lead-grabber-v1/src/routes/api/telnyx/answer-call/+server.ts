import { json } from '@sveltejs/kit';
import { TELNYX_API_KEY } from '$env/static/private';

export const POST = async ({ request }: { request: Request }) => {
	try {
		const { callId } = await request.json();

		if (!callId) {
			return json({ success: false, error: 'Missing call ID' }, { status: 400 });
		}

		console.log('📞 Answering call:', callId);

		// Call Telnyx API to answer the call with recording and detection
		const response = await fetch(`https://api.telnyx.com/v2/calls/${callId}/actions/answer`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${TELNYX_API_KEY}`
			},
			body: JSON.stringify({
				record: 'record-from-answer',
				answering_machine_detection: 'premium',
				answering_machine_detection_config: {
					total_analysis_time_millis: 5000,
					after_greeting_silence_millis: 1000,
					between_words_silence_millis: 1000,
					greeting_duration_millis: 1000,
					initial_silence_millis: 1000,
					maximum_number_of_words: 50,
					maximum_word_length_millis: 2000,
					silence_threshold: 512,
					greeting_total_analysis_time_millis: 50000,
					greeting_silence_duration_millis: 2000
				}
			})
		});

		const data = await response.json();

		if (!response.ok) {
			console.error('Telnyx answer API error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to answer call'
				},
				{ status: 500 }
			);
		}

		console.log('✅ Call answered successfully with recording and detection');
		return json({ success: true });
	} catch (error) {
		console.error('Error answering call:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
