import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';
import { PUBLIC_BASE_URL } from '$env/static/public';

/**
 * Server-side dial architecture (§1.6.1)
 * POST /api/orchestrator/dial
 * Body: { comm_id, to_number, from_number, whisper_text? }
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const { comm_id, to_number, from_number, whisper_text } = await request.json();

		if (!to_number || !from_number || !comm_id) {
			return json({ error: 'Missing required fields' }, { status: 400 });
		}

		// Per spec, we originate the call and pass comm_id in client_state.
		const clientState = Buffer.from(
			JSON.stringify({
				comm_id,
				isOutboundOrigination: true,
				whisper_text: whisper_text || null
			})
		).toString('base64');

		console.log(`📡 Originating outbound call to ${to_number} (comm: ${comm_id})`);

		const res = await fetch('https://api.telnyx.com/v2/calls', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${TELNYX_API_KEY}`
			},
			body: JSON.stringify({
				to: to_number,
				from: from_number,
				connection_id: process.env.TELNYX_CONNECTION_ID || process.env.TELNYX_APP_ID, // ensure an app id or connection id is set
				client_state: clientState,
                // Webhook will go back to our standard call-webhook
                webhook_url: `${PUBLIC_BASE_URL}/api/telnyx/call-webhook`,
				webhook_url_method: 'POST'
			})
		});

		const data = await res.json();
		if (!res.ok) {
			console.error('❌ Failed to originate call:', data);
			return json({ error: 'Failed to originate call', details: data }, { status: 500 });
		}

		return json({ success: true, call_control_id: data.data.call_control_id });
	} catch (err: any) {
		console.error('❌ Dial error:', err);
		return json({ error: err.message }, { status: 500 });
	}
};
