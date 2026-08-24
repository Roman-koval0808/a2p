import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ingestSignalBatch } from '$lib/server/telemetry/intake';

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
	'Access-Control-Max-Age': '86400'
};

export const OPTIONS: RequestHandler = async () => {
	return new Response(null, { status: 204, headers: CORS_HEADERS });
};

// Deterministic signal intake. Accepts a batched payload from the browser tracker and
// stores it in the lead-grabber pipeline tables. No AI is invoked here.
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const result = await ingestSignalBatch(body ?? {});
	return json(result.body, { status: result.status, headers: CORS_HEADERS });
};
