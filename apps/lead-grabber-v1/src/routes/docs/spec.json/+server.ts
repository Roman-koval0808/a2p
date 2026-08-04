import spec from '$lib/api/openapi-spec.generated.js';
import type { RequestHandler } from './$types';

/**
 * GET /docs/spec.json — returns the merged OpenAPI spec.
 *
 * The spec is compiled into the server bundle at build time
 * (scripts/gen-openapi.mjs → src/lib/api/openapi-spec.generated.js),
 * so no spec file is ever served from `static/`. This route is gated
 * by the docs access code in hooks.server.ts.
 */
export const GET: RequestHandler = async () =>
	new Response(JSON.stringify(spec, null, 2), {
		headers: { 'content-type': 'application/json; charset=utf-8' }
	});
