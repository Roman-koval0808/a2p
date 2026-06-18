import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { sendPasswordResetEmail } from '$lib/server/brevo';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { email } = await request.json();

		if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return json({ success: false, error: 'Valid email is required' }, { status: 400 });
		}

		const user = await prisma.user.findUnique({
			where: { email: email.toLowerCase() }
		});

		// For security reasons, don't reveal if the user exists or not
		if (!user) {
			return json({ success: true, message: 'If an account exists with this email, you will receive a reset link.' });
		}

		// Generate a secure token
		const token = crypto.randomBytes(32).toString('hex');
		const hashedToken = await bcrypt.hash(token, 10);

		// Store in Otp table
		await prisma.otp.deleteMany({
			where: {
				collectionRef: 'password-reset',
				recordRef: user.id
			}
		});

		const otpRow = await prisma.otp.create({
			data: {
				collectionRef: 'password-reset',
				recordRef: user.id,
				password: hashedToken,
				sentTo: user.email
			}
		});

		// Send email
		await sendPasswordResetEmail(user.email, token, otpRow.id);

		return json({ success: true, message: 'If an account exists with this email, you will receive a reset link.' });
	} catch (error) {
		console.error('Forgot password error:', error);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
