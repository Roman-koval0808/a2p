import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEmailsIncoming } from '$lib/server/a2p-client';

/** GET /api/a2p/emails/incoming — proxy to A2P email service */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	try {
		const data = await getEmailsIncoming();
		return json(data);
	} catch (err) {
		console.error('A2P emails/incoming error:', err);
		return json({ error: err instanceof Error ? err.message : 'Request failed' }, { status: 502 });
	}
};
