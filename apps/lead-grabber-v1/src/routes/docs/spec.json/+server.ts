import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * GET /docs/spec.json — returns the merged OpenAPI spec.
 *
 * - Production build: `vite.config.ts` writes `static/openapi.json` (read from disk).
 * - Development: the sveltekit-openapi-generator middleware serves `/openapi-spec.json`.
 *
 * A Postman/Insomnia/OpenAPI client can import this URL directly.
 */
export const GET: RequestHandler = async ({ url }) => {
	// 1. Prefer the static build artifact (present after `vite build`).
	const filePath = join(process.cwd(), 'static', 'openapi.json');
	try {
		if (existsSync(filePath)) {
			return new Response(readFileSync(filePath, 'utf8'), {
				headers: { 'content-type': 'application/json; charset=utf-8' }
			});
		}
	} catch (e) {
		console.error('[docs/spec.json] Could not read static/openapi.json:', e);
	}

	// 2. Fall back to the dev middleware.
	try {
		const res = await fetch(url.origin + '/openapi-spec.json');
		if (res.ok) {
			return new Response(res.body, {
				headers: { 'content-type': 'application/json; charset=utf-8' }
			});
		}
	} catch (e) {
		console.error('[docs/spec.json] Dev middleware fetch failed:', e);
	}

	return json(
		{
			error:
				'OpenAPI spec not available. Run `node scripts/gen-openapi.mjs`, then `pnpm dev` ' +
				'(dev middleware) or `pnpm build` (writes static/openapi.json).'
		},
		{ status: 404 }
	);
};