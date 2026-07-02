import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProfileDetails } from '$lib/server/profiledb/profiles';

export const GET: RequestHandler = async ({ params }) => {
	const result = await getProfileDetails(params.tenantSlug, params.id);
	return json(result.body, { status: result.status });
};
