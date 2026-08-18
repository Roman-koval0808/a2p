import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkDueScheduledIntents } from '$lib/server/scheduled-intents-sweep';

/**
 * External-cron alternative to the in-process scheduled-intents sweep (see hooks.server.ts).
 * Mirrors POST /api/a2p/cohort2/sweep so the same scheduler can drive both.
 */
export const POST: RequestHandler = async () => {
	try {
		const result = await checkDueScheduledIntents();
		return json({ ok: true, ...result });
	} catch (e: any) {
		console.error('[scheduled-intents sweep endpoint] failed:', e?.message || e);
		return json({ ok: false, error: e?.message || String(e) }, { status: 500 });
	}
};
