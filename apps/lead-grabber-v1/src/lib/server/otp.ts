import bcrypt from 'bcryptjs';
import { prisma } from '$lib/db';
import { sendOtpEmail } from './brevo';

const OTP_LENGTH = 5;
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 min

function generateCode(): string {
	let code = '';
	for (let i = 0; i < OTP_LENGTH; i++) {
		code += Math.floor(Math.random() * 10).toString();
	}
	return code;
}

export async function createAndSendOtp(params: {
	collectionRef: string;
	recordRef: string;
	sentTo: string;
	signupPayload?: { name: string; passwordHash: string };
}): Promise<{ success: boolean; error?: string }> {
	const { collectionRef, recordRef, sentTo, signupPayload } = params;

	// Invalidate any existing OTP for this ref
	await prisma.otp.deleteMany({
		where: { collectionRef, recordRef }
	});

	const code = generateCode();
	const hashed = await bcrypt.hash(code, 10);

	await prisma.otp.create({
		data: {
			collectionRef,
			recordRef,
			password: hashed,
			sentTo,
			signupPayload: signupPayload ?? undefined
		}
	});

	try {
		await sendOtpEmail(sentTo, code, signupPayload ? 'signup' : 'login');
	} catch (e) {
		console.error('Send OTP failed:', e);
		await prisma.otp.deleteMany({ where: { collectionRef, recordRef } });
		return { success: false, error: 'Failed to send verification email' };
	}

	return { success: true };
}

export async function verifyOtp(params: {
	collectionRef: string;
	recordRef: string;
	code: string;
}): Promise<{ valid: boolean; signupPayload?: { name: string; passwordHash: string } }> {
	const { collectionRef, recordRef, code } = params;

	const row = await prisma.otp.findFirst({
		where: { collectionRef, recordRef },
		orderBy: { created: 'desc' }
	});

	if (!row) return { valid: false };
	if (Date.now() - row.created.getTime() > OTP_EXPIRY_MS) {
		await prisma.otp.deleteMany({ where: { id: row.id } });
		return { valid: false };
	}

	const valid = await bcrypt.compare(code, row.password);
	if (!valid) return { valid: false };

	await prisma.otp.deleteMany({ where: { id: row.id } });
	return {
		valid: true,
		signupPayload: (row.signupPayload as { name: string; passwordHash: string } | null) ?? undefined
	};
}
