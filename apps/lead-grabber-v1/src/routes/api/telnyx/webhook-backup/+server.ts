import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Just a simple backup endpoint that logs and acknowledges
export const POST: RequestHandler = async ({ request }) => {
	try {
		const payload = await request.json();
		console.log('BACKUP WEBHOOK received:', payload);
		return json({ success: true });
	} catch (error) {
		console.error('Backup webhook error:', error);
		return json({ success: true }); // Always return success to Telnyx
	}
};

export const GET: RequestHandler = () => json({ success: true });
export const PUT: RequestHandler = async ({ request }) => {
	return await POST({ request } as Parameters<typeof POST>[0]);
};
export const OPTIONS: RequestHandler = () => json({ success: true });
