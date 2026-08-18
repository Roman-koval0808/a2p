import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { verifyPassword, generateToken } from '$lib/auth';
import { prisma } from '$lib/db';
import { safeNext } from '$lib/utils/safe-redirect';

export const actions: Actions = {
	default: async ({ locals, request, cookies, url }) => {
		const data = Object.fromEntries(await request.formData()) as {
			email: string;
			password: string;
		};

		// Where we were headed before the auth redirect — only if it is a safe internal path.
		const next = safeNext(url.searchParams.get('next'));
		let dest = next ?? '/dashboard';

		try {
			// Find user by email
			const user = await prisma.user.findUnique({
				where: { email: data.email },
				include: {
					company: true
				}
			});

			if (!user) {
				return { success: false, message: 'Invalid email or password' };
			}

			// Verify password
			const isValid = await verifyPassword(data.password, user.password);
			if (!isValid) {
				return { success: false, message: 'Invalid email or password' };
			}

			// Update emailVisibility to true
			const updatedUser = await prisma.user.update({
				where: { id: user.id },
				data: { emailVisibility: true },
				include: {
					company: true
				}
			});

			dest = next ?? (updatedUser.platformRole === 'CLEARSKY_ADMIN' ? '/clearsky-admin' : '/dashboard');

			// Generate token and set cookie
			const token = await generateToken(updatedUser);
			cookies.set('app_session', token, {
				path: '/',
				httpOnly: false,
				sameSite: 'lax',
				maxAge: 60 * 60 * 24 * 7 // 7 days
			});

			// Set user in locals for this request
			locals.user = updatedUser as any;
		} catch (err: any) {
			console.error(err);
			return { success: false, message: 'An unexpected error occurred' };
		}

		throw redirect(303, dest);
	}
};
