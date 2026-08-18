import type { Actions } from './$types';
import { env } from '$env/dynamic/private';
import { fail, redirect } from '@sveltejs/kit';

const COOKIE = 'docs_access';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const data = await request.formData();
		const code = String(data.get('code') ?? '').trim();
		const expected = env.DOCS_ACCESS_CODE ?? null;

		if (!expected) {
			return fail(500, { error: 'Docs access is not configured on this server.' });
		}
		if (!code || code !== expected) {
			return fail(401, { error: 'Incorrect access code.' });
		}

		cookies.set(COOKIE, expected, {
			path: '/',
			httpOnly: true,
			sameSite: 'strict',
			secure: url.protocol === 'https:',
			maxAge: MAX_AGE
		});

		const next = String(data.get('next') ?? '/docs');
		throw redirect(303, next.startsWith('/') ? next : '/docs');
	}
};
