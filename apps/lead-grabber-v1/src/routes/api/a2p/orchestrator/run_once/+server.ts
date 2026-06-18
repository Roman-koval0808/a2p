import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runOrchestratorOnce } from '$lib/server/a2p-client';

/** POST /api/a2p/orchestrator/run_once — trigger A2P email orchestrator. Body: { limit?: number } */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	try {
		let limit: number | undefined;
		try {
			const body = await request.json().catch(() => ({}));
			if (typeof body?.limit === 'number') limit = body.limit;
		} catch {
			// no body
		}
		const data = await runOrchestratorOnce(limit);
		return json(data);
	} catch (err) {
		console.error('A2P orchestrator/run_once error:', err);
		return json({ error: err instanceof Error ? err.message : 'Request failed' }, { status: 502 });
	}
};
