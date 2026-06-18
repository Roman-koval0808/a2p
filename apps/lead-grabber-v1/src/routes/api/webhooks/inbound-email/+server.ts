import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { processInboundEmail, type InboundEmailPayload } from '$lib/server/email/bridge';

/**
 * Handle POST request from inbound email gateway.
 * This matches the "Inbound Webhook Orchestration" from the roadmap.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const payload = await request.json();

		// Map common gateway fields (e.g., Postmark) to our internal payload interface
		// In a real scenario, you'd want to add validation and potentially support multiple providers.
		const mappedPayload: InboundEmailPayload = {
			from: payload.From || payload.from,
			fromName: payload.FromName || payload.fromName,
			to: payload.To || payload.to,
			subject: payload.Subject || payload.subject,
			textBody: payload.TextBody || payload.textBody,
			htmlBody: payload.HtmlBody || payload.htmlBody,
			messageId: payload.MessageID || payload.messageId || crypto.randomUUID(),
			timestamp: payload.Date || payload.timestamp || new Date().toISOString(),
			attachments: payload.Attachments || payload.attachments || []
		};

		if (!mappedPayload.to || !mappedPayload.from) {
			return json(
				{ success: false, error: 'Invalid payload: "to" and "from" fields are required' },
				{ status: 400 }
			);
		}

		const result = await processInboundEmail(mappedPayload);

		if (result.success) {
			return json(
				{ success: true, message: 'Email processed successfully', id: result.messageId },
				{ status: 201 }
			);
		} else {
			// We return 200/202 even on "Tenant not found" to avoid retries from the gateway
			// if it's a permanent error like "unknown user".
			return json({ success: false, error: result.error }, { status: 202 });
		}
	} catch (error) {
		console.error('Inbound Email Webhook Error:', error);
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};
