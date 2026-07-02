import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProfileHistory } from '$lib/server/profiledb/profiles';

export const GET: RequestHandler = async ({ params }) => {
	const result = await getProfileHistory(params.tenantSlug, params.id);
	return json(result.body, { status: result.status });
};
