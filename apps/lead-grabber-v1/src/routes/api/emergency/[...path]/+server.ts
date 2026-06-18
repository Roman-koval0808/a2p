import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const PROFILEDB_URL = process.env.PROFILEDB_URL || 'http://localhost:6277';

export const fallback: RequestHandler = async ({ request, params, url }) => {
	const path = params.path;
	const search = url.search;
	const targetUrl = `${PROFILEDB_URL}/api/v1/${path}${search}`;

	try {
		const headers: HeadersInit = {
			'Content-Type': 'application/json'
		};

		const options: RequestInit = {
			method: request.method,
			headers
		};

		if (request.method !== 'GET' && request.method !== 'HEAD') {
			options.body = await request.text();
		}

		const res = await fetch(targetUrl, options);
		const contentType = res.headers.get('content-type') || '';

		if (contentType.includes('application/json')) {
			const data = await res.json();
			return json(data, { status: res.status });
		} else {
			const text = await res.text();
			return new Response(text, { status: res.status, headers: { 'content-type': contentType } });
		}
	} catch (err: any) {
		console.error(`[Emergency Proxy Error] to ${targetUrl}:`, err);
		return json({ error: err?.message || 'Proxy failed' }, { status: 500 });
	}
};
