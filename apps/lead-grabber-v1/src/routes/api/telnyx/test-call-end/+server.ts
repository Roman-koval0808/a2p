import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, fetch }) => {
	try {
		const body = await request.json();
		const callControlId = body.callId || `test-call-${Date.now()}`;

		// Create a realistic Telnyx webhook payload for call hangup
		const webhookPayload = {
			data: {
				event_type: 'call.hangup',
				id: `test-event-${Date.now()}`,
				occurred_at: new Date().toISOString(),
				payload: {
					call_control_id: callControlId,
					call_leg_id: `test-leg-${Date.now()}`,
					call_session_id: `test-session-${Date.now()}`,
					direction: 'incoming',
					from: '+15551234567',
					to: '+17059986143',
					state: 'hangup',
					hangup_cause: 'normal_clearing',
					hangup_source: 'caller',
					created_at: new Date(Date.now() - 30000).toISOString(), // 30 seconds ago
					answered_at: new Date(Date.now() - 25000).toISOString(), // 25 seconds ago
					bridged_at: null,
					hangup_at: new Date().toISOString(),
					client_state: null
				},
				record_type: 'event'
			},
			meta: {
				attempt: 1,
				delivered_to: request.url
			}
		};

		console.log('🧪 Sending test call hangup webhook:', webhookPayload);

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
			message: 'Test call hangup webhook sent successfully',
			testPayload: webhookPayload,
			webhookResponse: {
				status: webhookResponse.status,
				body: webhookResult
			},
			instructions: {
				description: 'This simulates a call ending/hangup',
				expectedBehavior: [
					'1. Call dialog should close',
					'2. Call event should be logged to database',
					'3. SSE call_ended event should be broadcasted'
				]
			}
		});
	} catch (error) {
		console.error('❌ Test call hangup error:', error);
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
	const callControlId = url.searchParams.get('callId') || `test-call-${Date.now()}`;

	const mockRequest = {
		json: async () => ({ callId: callControlId }),
		url: url.toString()
	};

	return await POST({
		request: mockRequest as Request,
		fetch
	} as Parameters<RequestHandler>[0]);
};
