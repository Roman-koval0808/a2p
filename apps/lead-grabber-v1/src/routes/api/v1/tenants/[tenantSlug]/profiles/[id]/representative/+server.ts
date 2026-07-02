import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assignRepresentative } from '$lib/server/profiledb/profiles';

export const PUT: RequestHandler = async ({ params, request }) => {
	const body = await request.json().catch(() => ({}));
	const result = await assignRepresentative(params.tenantSlug, params.id, body?.representativeId);
	return json(result.body, { status: result.status });
};
