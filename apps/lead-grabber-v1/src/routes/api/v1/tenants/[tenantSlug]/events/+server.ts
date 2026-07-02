import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTenantEvents } from '$lib/server/profiledb/telemetry';

export const GET: RequestHandler = async ({ params, url }) => {
	const result = await getTenantEvents({
		tenantSlug: params.tenantSlug,
		page: url.searchParams.get('page') ?? undefined,
		limit: url.searchParams.get('limit') ?? undefined,
		eventType: url.searchParams.get('eventType') ?? undefined,
		sessionId: url.searchParams.get('sessionId') ?? undefined
	});
	return json(result.body, { status: result.status });
};
