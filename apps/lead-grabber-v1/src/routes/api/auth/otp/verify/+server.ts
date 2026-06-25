import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { generateToken, createSessionCookie } from '$lib/auth';
import { verifyOtp } from '$lib/server/otp';

export const POST: RequestHandler = async ({ request, cookies }) => {
	try {
		const body = await request.json().catch(() => ({}));
		const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
		const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : '';
		const intent = body.intent === 'signup' ? 'signup' : 'login';

		if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return json({ success: false, error: 'Valid email is required' }, { status: 400 });
		}
		if (code.length !== 5) {
			return json({ success: false, error: 'Enter the 5-digit code' }, { status: 400 });
		}

		if (intent === 'login') {
			const user = await prisma.user.findUnique({
				where: { email },
				include: { company: true }
			});
			if (!user) {
				return json({ success: false, error: 'Invalid or expired code' }, { status: 400 });
			}
			const { valid } = await verifyOtp({
				collectionRef: 'users',
				recordRef: user.id,
				code
			});
			if (!valid) {
				return json({ success: false, error: 'Invalid or expired code' }, { status: 400 });
			}
			const updatedUser = await prisma.user.update({
				where: { id: user.id },
				data: { emailVisibility: true },
				include: { company: true }
			});
			const token = await generateToken(updatedUser);
			cookies.set('app_session', token, {
				path: '/',
				httpOnly: false,
				sameSite: 'lax',
				maxAge: 60 * 60 * 24 * 7
			});
			return json(
				{ success: true, redirect: updatedUser.platformRole === 'CLEARSKY_ADMIN' ? '/clearsky-admin' : '/dashboard' },
				{ headers: { 'Set-Cookie': createSessionCookie(token) } }
			);
		}

		// signup
		const { valid, signupPayload } = await verifyOtp({
			collectionRef: 'signup',
			recordRef: email,
			code
		});
		if (!valid || !signupPayload?.name || !signupPayload?.passwordHash) {
			return json({ success: false, error: 'Invalid or expired code' }, { status: 400 });
		}
		const user = await prisma.user.create({
			data: {
				email,
				name: signupPayload.name,
				password: signupPayload.passwordHash,
				emailVisibility: true,
				verified: true
			},
			include: { company: true }
		});
		const token = await generateToken(user);
		cookies.set('app_session', token, {
			path: '/',
			httpOnly: false,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 7
		});
		return json(
			{ success: true, redirect: '/create-company' },
			{ headers: { 'Set-Cookie': createSessionCookie(token) } }
		);
	} catch (e) {
		console.error('OTP verify error:', e);
		return json({ success: false, error: 'Something went wrong' }, { status: 500 });
	}
};
