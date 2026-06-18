import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isA2pDbEnabled, queryContacts } from '$lib/server/a2p-db';

/** GET /api/a2p/contacts — list contacts from A2P DB (read-only). Query: limit */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	if (!isA2pDbEnabled()) {
		return json({ error: 'A2P DB not configured' }, { status: 503 });
	}
	try {
		const limit = Math.min(
			200,
			Math.max(1, parseInt(url.searchParams.get('limit') ?? '100', 10) || 100)
		);
		const contacts = await queryContacts(limit);
		return json({ contacts });
	} catch (err) {
		console.error('A2P contacts error:', err);
		return json({ error: err instanceof Error ? err.message : 'Query failed' }, { status: 500 });
	}
};
