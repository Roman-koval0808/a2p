import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ingestTelemetryEvent } from '$lib/server/profiledb/telemetry';

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const body = await request.json().catch(() => ({}));
	const headers: Record<string, string> = {};
	request.headers.forEach((v, k) => (headers[k] = v));
	let ip: string | null = null;
	try {
		ip = getClientAddress();
	} catch {
		ip = null;
	}
	const result = await ingestTelemetryEvent({ body, headers, ip });
	return json(result.body, { status: result.status });
};
