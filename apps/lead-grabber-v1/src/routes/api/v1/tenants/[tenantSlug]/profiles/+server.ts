import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTenantProfiles } from '$lib/server/profiledb/profiles';

export const GET: RequestHandler = async ({ params, url }) => {
	const query = Object.fromEntries(url.searchParams) as Record<string, string>;
	const result = await getTenantProfiles(params.tenantSlug, query);
	return json(result.body, { status: result.status });
};
