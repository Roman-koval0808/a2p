import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { verifyPassword, generateToken } from '$lib/auth';
import { prisma } from '$lib/db';

export const actions: Actions = {
	default: async ({ locals, request, cookies }) => {
		const data = Object.fromEntries(await request.formData()) as {
			email: string;
			password: string;
		};

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

			// Check if email is verified (if you implement email verification)
			// if (!user.verified) {
			//   return { success: false, message: 'Email not verified' }
			// }

			// Update emailVisibility to true
			const updatedUser = await prisma.user.update({
				where: { id: user.id },
				data: { emailVisibility: true },
				include: {
					company: true
				}
			});

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

		const dest = updatedUser.platformRole === 'CLEARSKY_ADMIN' ? '/clearsky-admin' : '/dashboard';
		throw redirect(303, dest);
	}
};
