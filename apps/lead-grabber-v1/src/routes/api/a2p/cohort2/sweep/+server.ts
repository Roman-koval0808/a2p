import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkLostRelationships } from '$lib/server/cohort2-sweep';

/**
 * External-cron alternative to the in-process Section 8 loss sweep (see hooks.server.ts).
 * Mirrors POST /api/a2p/sla/check so the same scheduler can drive both.
 */
export const POST: RequestHandler = async () => {
	try {
		const result = await checkLostRelationships();
		return json({ ok: true, ...result });
	} catch (e: any) {
		console.error('[cohort2 sweep endpoint] failed:', e?.message || e);
		return json({ ok: false, error: e?.message || String(e) }, { status: 500 });
	}
};
