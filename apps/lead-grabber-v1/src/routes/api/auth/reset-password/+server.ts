import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import bcrypt from 'bcryptjs';
import { hashPassword } from '$lib/auth';
import crypto from 'crypto';

const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { token, id, newPassword } = await request.json();

		if (!token || !id || !newPassword || newPassword.length < 8) {
			return json({ success: false, error: 'Token, id, and a new password (min 8 chars) are required' }, { status: 400 });
		}

		// Find the reset token in the Otp table
		const otpRow = await prisma.otp.findUnique({
			where: { id }
		});

		if (!otpRow || otpRow.collectionRef !== 'password-reset') {
			return json({ success: false, error: 'Invalid or expired reset link' }, { status: 400 });
		}

		// Check expiry
		if (Date.now() - otpRow.created.getTime() > TOKEN_EXPIRY_MS) {
			await prisma.otp.delete({ where: { id: otpRow.id } });
			return json({ success: false, error: 'Reset link has expired' }, { status: 400 });
		}

		// Verify token
		const isValid = await bcrypt.compare(token, otpRow.password);
		if (!isValid) {
			return json({ success: false, error: 'Invalid or expired reset link' }, { status: 400 });
		}

		// Get the user
		const user = await prisma.user.findUnique({
			where: { id: otpRow.recordRef }
		});

		if (!user) {
			return json({ success: false, error: 'User not found' }, { status: 404 });
		}

		// Update password and invalidate existing sessions by rotating tokenKey
		const passwordHash = await hashPassword(newPassword);
		await prisma.user.update({
			where: { id: user.id },
			data: {
				password: passwordHash,
				tokenKey: crypto.randomUUID() // Rotate tokenKey to invalidate all existing sessions
			}
		});

		// Delete the reset token
		await prisma.otp.delete({ where: { id: otpRow.id } });

		return json({ success: true, message: 'Your password has been reset successfully.' });
	} catch (error) {
		console.error('Reset password error:', error);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
