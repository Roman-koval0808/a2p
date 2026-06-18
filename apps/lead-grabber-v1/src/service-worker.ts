/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="es2017" />
/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

import { build, files, version } from '$service-worker';

// Create a unique cache name for this deployment
const CACHE = `cache-${version}`;

const ASSETS = [
	...build, // the app itself
	...files // everything in `static`
];

self.addEventListener('install', (event: ExtendableEvent) => {
	// Create a new cache and add all files to it
	async function addFilesToCache() {
		const cache = await caches.open(CACHE);
		await cache.addAll(ASSETS);
	}

	event.waitUntil(addFilesToCache());
});

self.addEventListener('activate', (event: ExtendableEvent) => {
	// Remove previous cached data from disk
	async function deleteOldCaches() {
		for (const key of await caches.keys()) {
			if (key !== CACHE) await caches.delete(key);
		}
	}

	event.waitUntil(deleteOldCaches());
});

self.addEventListener('fetch', (event: FetchEvent) => {
	// ignore POST requests etc
	if (event.request.method !== 'GET') return;

	const url = new URL(event.request.url);
	// Don't intercept SSE/streaming API — let the browser handle them (avoids SW breaking long-lived connections)
	if (
		url.pathname.includes('/api/') &&
		(url.pathname.includes('/api/events') || url.pathname.includes('/api/ws'))
	) {
		return;
	}

	async function respond() {
		const cache = await caches.open(CACHE);

		// `build`/`files` can always be served from the cache
		if (ASSETS.includes(url.pathname)) {
			const response = await cache.match(url.pathname);
			if (response) {
				return response;
			}
		}

		// for everything else, try the network first, but
		// fall back to the cache if we're offline
		try {
			const response = await fetch(event.request);

			// Only cache successful responses and avoid caching streams
			if (
				response.status === 200 &&
				!response.headers.get('content-type')?.includes('text/event-stream')
			) {
				try {
					cache.put(event.request, response.clone());
				} catch (error) {
					// Ignore cache errors - they're not critical
					console.warn('Cache put failed:', error);
				}
			}

			return response;
		} catch {
			const response = await cache.match(event.request);
			if (response) {
				return response;
			}

			throw new Error(`Service worker could not fetch ${url.pathname}`);
		}
	}

	event.respondWith(respond());
});
