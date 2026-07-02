import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearTenantTelemetry } from '$lib/server/profiledb/telemetry';

export const POST: RequestHandler = async ({ params }) => {
	const result = await clearTenantTelemetry({ tenantSlug: params.tenantSlug });
	return json(result.body, { status: result.status });
};
