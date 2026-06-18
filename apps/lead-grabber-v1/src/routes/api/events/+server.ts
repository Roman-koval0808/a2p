import { addSSEConnection, removeSSEConnection } from '$lib/utils/sse';
import { requireAuth, unauthorized } from '$lib/api/spec';

export const GET = async ({ locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const companyId = auth.companyId;

	const stream = new ReadableStream({
		start(controller) {
			// Add this connection to our company's set
			addSSEConnection(companyId, controller);

			// Send initial connection message
			controller.enqueue(
				`event: connected\ndata: ${JSON.stringify({ type: 'connected', companyId })}\n\n`
			);

			// Keep connection alive with periodic heartbeat
			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(
						`event: heartbeat\ndata: ${JSON.stringify({ type: 'heartbeat' })}\n\n`
					);
				} catch {
					clearInterval(heartbeat);
					removeSSEConnection(companyId, controller);
				}
			}, 30000);

			// Cleanup when connection is closed
			return () => {
				clearInterval(heartbeat);
				removeSSEConnection(companyId, controller);
			};
		},
		cancel() {
			// Connection was closed by client
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
