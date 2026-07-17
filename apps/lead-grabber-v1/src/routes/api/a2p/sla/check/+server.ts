import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { checkSlaBreaches } from '$lib/server/sla-monitor';

/**
 * Cron entrypoint for the SLA-breach detector (T3.4). Call on a short interval
 * (e.g. every minute) from an external scheduler. If CRON_SECRET is set, requests
 * must send it as `Authorization: Bearer <secret>` or `?token=<secret>`.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	const secret = env.CRON_SECRET;
	if (secret) {
		const auth = request.headers.get('authorization') || '';
		const token = auth.replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';
		if (token !== secret) {
			return json({ ok: false, error: 'unauthorized' }, { status: 401 });
		}
	}

	const result = await checkSlaBreaches();
	return json({ ok: true, ...result });
};
