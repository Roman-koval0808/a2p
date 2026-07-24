import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sweepTimers } from '$lib/server/timer/timer-service';

export const POST: RequestHandler = async () => {
	try {
		const result = await sweepTimers();
		return json({ ok: true, result });
	} catch (error: any) {
		console.error('[API /api/a2p/timers/sweep] Error:', error);
		return json({ ok: false, error: error?.message || 'Timer sweep failed' }, { status: 500 });
	}
};
