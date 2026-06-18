import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, fetch }) => {
	try {
		const body = await request.json().catch(() => ({}));
		const fromNumber = body.from || '+15551234567';
		// Use the number that "received" the call — must be assigned to your company in Manage Numbers for IVR
		const toNumber = body.to || body.receiving_number || '+17059986143';

		const webhookPayload = {
			data: {
				event_type: 'call.initiated',
				id: `test-event-${Date.now()}`,
				occurred_at: new Date().toISOString(),
				payload: {
					call_control_id: `test-call-${Date.now()}`,
					call_leg_id: `test-leg-${Date.now()}`,
					call_session_id: `test-session-${Date.now()}`,
					direction: 'incoming',
					from: fromNumber,
					to: toNumber,
					state: 'ringing',
					created_at: new Date().toISOString(),
					answered_at: null,
					bridged_at: null,
					hangup_at: null,
					hangup_cause: null,
					client_state: null
				},
				record_type: 'event'
			},
			meta: {
				attempt: 1,
				delivered_to: request.url
			}
		};

		console.log('🧪 Sending test call webhook:', webhookPayload);

		// Send the webhook to our call-webhook endpoint
		const webhookResponse = await fetch('/api/telnyx/call-webhook', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': 'TelnyxEvent/1.0'
			},
			body: JSON.stringify(webhookPayload)
		});

		const webhookResult = await webhookResponse.json();

		return json({
			success: true,
			message: 'Test call webhook sent successfully',
			testPayload: webhookPayload,
			webhookResponse: {
				status: webhookResponse.status,
				body: webhookResult
			},
			instructions: {
				description: `Simulates an incoming call to ${toNumber}. For IVR: assign this number to your company in Manage Numbers and create an IVR flow with a rule whose schedule includes now.`,
				expectedBehavior: [
					'1. If number is assigned + active IVR rule: call is answered with IVR (greeting → prompts → digit gather)',
					'2. Otherwise: call is added to pending calls'
				]
			}
		});
	} catch (error) {
		console.error('❌ Test call error:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : String(error)
			},
			{ status: 500 }
		);
	}
};

export const GET: RequestHandler = async ({ url, fetch }) => {
	const fromNumber = url.searchParams.get('from') || '+15551234567';
	const toNumber = url.searchParams.get('to') || undefined;
	const mockRequest = {
		json: async () => ({ from: fromNumber, ...(toNumber && { to: toNumber }) }),
		url: url.toString()
	};
	return await POST({
		request: mockRequest as Request,
		fetch
	} as Parameters<RequestHandler>[0]);
};
