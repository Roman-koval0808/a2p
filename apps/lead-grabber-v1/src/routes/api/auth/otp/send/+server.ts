import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { hashPassword } from '$lib/auth';
import { createAndSendOtp } from '$lib/server/otp';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json().catch(() => ({}));
		const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
		const intent = body.intent === 'signup' ? 'signup' : 'login';

		if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return json({ success: false, error: 'Valid email is required' }, { status: 400 });
		}

		if (intent === 'login') {
			const user = await prisma.user.findUnique({
				where: { email }
			});
			if (!user) {
				return json({ success: false, error: 'No account found with this email' }, { status: 404 });
			}
			const result = await createAndSendOtp({
				collectionRef: 'users',
				recordRef: user.id,
				sentTo: email
			});
			if (!result.success) {
				return json(
					{ success: false, error: result.error ?? 'Failed to send code' },
					{ status: 500 }
				);
			}
			return json({ success: true, message: 'Verification code sent to your email' });
		}

		// signup
		const name = typeof body.name === 'string' ? body.name.trim() : '';
		const password = typeof body.password === 'string' ? body.password : '';
		if (!name || !password || password.length < 8) {
			return json(
				{ success: false, error: 'Name and password (min 8 characters) are required for sign up' },
				{ status: 400 }
			);
		}
		const existing = await prisma.user.findUnique({ where: { email } });
		if (existing) {
			return json(
				{ success: false, error: 'An account with this email already exists' },
				{ status: 400 }
			);
		}
		const passwordHash = await hashPassword(password);
		const result = await createAndSendOtp({
			collectionRef: 'signup',
			recordRef: email,
			sentTo: email,
			signupPayload: { name, passwordHash }
		});
		if (!result.success) {
			return json(
				{ success: false, error: result.error ?? 'Failed to send code' },
				{ status: 500 }
			);
		}
		return json({ success: true, message: 'Verification code sent to your email' });
	} catch (e) {
		console.error('OTP send error:', e);
		return json({ success: false, error: 'Something went wrong' }, { status: 500 });
	}
};
