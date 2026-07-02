import { prisma } from '$lib/db';
import { getUserFromToken, parseSessionCookie, createSessionCookie } from '$lib/auth';
import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';

// Cache for auth refresh timestamps to avoid refreshing too frequently
const authRefreshCache = new Map<string, number>();
const AUTH_REFRESH_CACHE_MS = 60000; // Cache auth refresh for 60 seconds

export const handle: Handle = async ({ event, resolve }) => {
	const publicRoutes = [
		'/login',
		'/signup',
		'/api',
		'/book',
		'/embed',
		'/embed/leadform/[id]',
		'/invite/accept/[id]',
		'/embed/leadbox/[id]',
		'/api/telnyx/webhook',
		'/api/telnyx/call-webhook',
		'/api/webhooks/telnyx/incoming-call',
		'/api/webhooks/telnyx/incoming-sms'
	];

	// Skip auth refresh for API routes (they're stateless)
	const isApiRoute = event.url.pathname.startsWith('/api/');
	const isPublicRoute = publicRoutes.some((route) => {
		if (route.includes('[')) {
			// Handle dynamic routes
			const pattern = route.replace(/\[.*?\]/g, '[^/]+');
			return new RegExp(`^${pattern}$`).test(event.url.pathname);
		}
		return event.url.pathname.startsWith(route);
	});

	// Get user from session cookie using SvelteKit's native cookies
	const token = event.cookies.get('app_session');
	let user = null;

	if (token) {
		try {
			user = await getUserFromToken(token);

			// Only refresh auth for non-API, non-public routes and cache it to avoid too frequent refreshes
			if (!isApiRoute && !isPublicRoute && user) {
				const userId = user.id;
				const lastRefresh = authRefreshCache.get(userId) || 0;
				const now = Date.now();

				// Only refresh if cache expired (60 seconds)
				// Note: getUserFromToken already includes company, so we don't need to refetch
				// Just update the cache timestamp
				if (now - lastRefresh > AUTH_REFRESH_CACHE_MS) {
					authRefreshCache.set(userId, now);

					// Clean up old cache entries periodically (keep only last 1000)
					if (authRefreshCache.size > 1000) {
						const entries = Array.from(authRefreshCache.entries());
						const toKeep = entries.slice(-500); // Keep most recent 500
						authRefreshCache.clear();
						toKeep.forEach(([key, value]) => authRefreshCache.set(key, value));
					}
				}
			}
		} catch (error) {
			console.error('Error getting user from token:', error);
			user = null;
		}
	}

	// Clear invalid session proactively before resolving
	if (!user && token) {
		console.log(`[Auth] Clearing session for ${event.url.pathname} - user is null but token exists`);
		event.cookies.delete('app_session', { path: '/' });
	}

	event.locals.user = user;
	event.locals.prisma = prisma;

	const response = await resolve(event);
	return response;
};
