import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { hashPassword, generateToken, createSessionCookie } from '$lib/auth';
import { prisma } from '$lib/db';

export const actions: Actions = {
	default: async ({ locals, request, cookies }) => {
		const data = Object.fromEntries(await request.formData()) as {
			name: string;
			email: string;
			password: string;
			passwordConfirm: string;
		};

		// Validate passwords match
		if (data.password !== data.passwordConfirm) {
			return {
				type: 'failure',
				data: {
					message: 'Passwords do not match'
				}
			};
		}

		try {
			// Check if user already exists
			const existingUser = await prisma.user.findUnique({
				where: { email: data.email }
			});

			if (existingUser) {
				return {
					type: 'failure',
					data: {
						message: 'Email already exists'
					}
				};
			}

			// Hash password
			const hashedPassword = await hashPassword(data.password);

			// Create user
			const user = await prisma.user.create({
				data: {
					email: data.email,
					password: hashedPassword,
					name: data.name,
					emailVisibility: true,
					verified: false // You can implement email verification later
				},
				include: {
					company: true
				}
			});

			// Generate token and set cookie
			const token = await generateToken(user);
			cookies.set('app_session', token, {
				path: '/',
				httpOnly: false,
				sameSite: 'lax',
				maxAge: 60 * 60 * 24 * 7 // 7 days
			});

			// Set user in locals for this request
			locals.user = user as any;
		} catch (e: any) {
			console.error(e);
			return {
				type: 'failure',
				data: {
					message: e.message || 'Failed to create account'
				}
			};
		}

		throw redirect(303, '/create-company');
	}
};
