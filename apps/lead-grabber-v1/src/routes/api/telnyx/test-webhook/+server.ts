import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, fetch }) => {
	// Get parameters from the URL
	const from = url.searchParams.get('from') || '+18005551234';
	const text = url.searchParams.get('text') || "Hello, I'm a test customer";
	const to = url.searchParams.get('to') || '+17059800835';

	// Create sample webhook payload based on real Telnyx webhook
	const payload = {
		record_type: 'message',
		direction: 'inbound',
		from: {
			phone_number: from
		},
		to: [
			{
				phone_number: to
			}
		],
		text: text,
		media: [],
		messaging_profile_id: '400196aa-d694-4fee-b2ee-0578afb3bb01',
		received_at: new Date().toISOString(),
		id: `test-${Date.now()}`
	};

	console.log('Sending test webhook with payload:', payload);

	// Send the payload to our webhook handler
	try {
		// Create a request to our own webhook endpoint
		const response = await fetch('/api/telnyx/webhook', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		});

		const responseData = await response.text();

		return json({
			success: response.ok,
			status: response.status,
			response: responseData,
			payload: payload,
			instructions:
				'To simulate an incoming message, visit: /api/telnyx/test-webhook?from=+12345678901&text=Your message here'
		});
	} catch (error) {
		console.error('Error sending test webhook:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : String(error),
				payload: payload
			},
			{ status: 500 }
		);
	}
};

// Also handle POST for form submissions
export const POST: RequestHandler = async ({ request, fetch }) => {
	try {
		const formData = await request.formData();
		const from = formData.get('from')?.toString() || '+18005551234';
		const text = formData.get('text')?.toString() || "Hello, I'm a test customer";
		const to = formData.get('to')?.toString() || '+17059800835';

		// Create sample webhook payload
		const payload = {
			record_type: 'message',
			direction: 'inbound',
			from: {
				phone_number: from
			},
			to: [
				{
					phone_number: to
				}
			],
			text: text,
			media: [],
			messaging_profile_id: '400196aa-d694-4fee-b2ee-0578afb3bb01',
			received_at: new Date().toISOString(),
			id: `test-${Date.now()}`
		};

		console.log('Sending test webhook with payload:', payload);

		// Send the payload to our webhook handler
		const response = await fetch('/api/telnyx/webhook', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		});

		const responseData = await response.text();

		return json({
			success: response.ok,
			status: response.status,
			response: responseData,
			payload: payload
		});
	} catch (error) {
		console.error('Error in test webhook POST:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : String(error)
			},
			{ status: 500 }
		);
	}
};
