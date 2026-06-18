import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateToken, createSessionCookie } from '$lib/auth';

export const POST: RequestHandler = async ({ locals }) => {
	try {
		if (!locals.user) {
			return json({ success: false, error: 'Unauthorized or token expired' }, { status: 401 });
		}

		// Generate a new token with a fresh 7-day expiration from now
		const token = await generateToken(locals.user);

		return json(
			{
				success: true,
				token,
				user: {
					id: locals.user.id,
					email: locals.user.email,
					name: locals.user.name,
					role: locals.user.role,
					company: locals.user.company,
					emailVisibility: locals.user.emailVisibility,
					verified: locals.user.verified,
					avatar: locals.user.avatar,
					created: locals.user.created,
					updated: locals.user.updated
				}
			},
			{
				headers: {
					'Set-Cookie': createSessionCookie(token)
				}
			}
		);
	} catch (error: any) {
		console.error('Error refreshing token:', error);
		return json({ success: false, error: 'Failed to refresh token' }, { status: 500 });
	}
};
