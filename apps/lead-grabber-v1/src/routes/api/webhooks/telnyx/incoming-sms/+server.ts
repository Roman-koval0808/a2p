/**
 * ClearSky spec alias: Telnyx can point messaging webhook here.
 * Forwards to existing /api/telnyx/webhook.
 */
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const origin = new URL(request.url).origin;
	const body = await request.text();
	const headers = new Headers(request.headers);
	headers.set('content-type', 'application/json');
	const res = await fetch(`${origin}/api/telnyx/webhook`, {
		method: 'POST',
		body,
		headers
	});
	const data = await res.text();
	return new Response(data, {
		status: res.status,
		headers: { 'Content-Type': 'application/json' }
	});
};
