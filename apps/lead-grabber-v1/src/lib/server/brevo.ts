import { BREVO_API_KEY } from '$env/static/private';
import { PUBLIC_BASE_URL, PUBLIC_ENV } from '$env/static/public';
import { normalizeUrl } from '$lib/utils';

interface SendEmailParams {
	to: { email: string; name?: string }[];
	subject: string;
	htmlContent: string;
}

export async function sendEmail({ to, subject, htmlContent }: SendEmailParams) {
	if (!BREVO_API_KEY) {
		console.warn('BREVO_API_KEY is not set. Email not sent.');
		return;
	}

	if (PUBLIC_ENV !== 'production') {
		console.log('--- DEV MODE: Email Sent ---');
		console.log(`To: ${JSON.stringify(to)}`);
		console.log(`Subject: ${subject}`);
		console.log(`Content: ${htmlContent}`);
		console.log('---------------------------');
		return { messageId: 'dev-mode-mock-id' };
	}

	console.log(`[Brevo] Sending email to ${JSON.stringify(to)} with subject "${subject}"`);
	const payload = {
		sender: {
			name: 'Lead Grabber',
			email: 'noreply@viewroom.ca'
		},
		to,
		subject,
		htmlContent
	};
	console.log('[Brevo] Payload:', JSON.stringify(payload, null, 2));

	const response = await fetch('https://api.brevo.com/v3/smtp/email', {
		method: 'POST',
		headers: {
			accept: 'application/json',
			'api-key': BREVO_API_KEY,
			'content-type': 'application/json'
		},
		body: JSON.stringify(payload)
	});

	console.log(`[Brevo] Response Status: ${response.status} ${response.statusText}`);

	if (!response.ok) {
		const error = await response.json();
		console.error('[Brevo] API Error:', JSON.stringify(error, null, 2));
		throw new Error(`Brevo API error: ${JSON.stringify(error)}`);
	}

	const result = await response.json();
	console.log('[Brevo] API Success:', JSON.stringify(result, null, 2));
	return result;
}

export async function sendInviteEmail({
	email,
	inviteId,
	companyName,
	invitedByName
}: {
	email: string;
	inviteId: string;
	companyName: string;
	invitedByName: string;
}) {
	const inviteUrl = normalizeUrl(PUBLIC_BASE_URL, `/invite/accept/${inviteId}`);

	const htmlContent = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">You've been invited!</h2>
            <p>Hello,</p>
            <p><strong>${invitedByName}</strong> has invited you to join <strong>${companyName}</strong> on Lead Grabber.</p>
            <div style="margin: 30px 0;">
                <a href="${inviteUrl}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Accept Invitation</a>
            </div>
            <p>If the button above doesn't work, you can also copy and paste this link into your browser:</p>
            <p>${inviteUrl}</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
            <p style="color: #777; font-size: 12px;">This invitation will expire in 7 days.</p>
        </div>
    `;

	return sendEmail({
		to: [{ email }],
		subject: `Join ${companyName} on Lead Grabber`,
		htmlContent
	});
}

const OTP_EXPIRY_MINUTES = 10;

export async function sendOtpEmail(
	to: string,
	code: string,
	purpose: 'login' | 'signup' = 'login'
) {
	const subject =
		purpose === 'signup' ? 'Your Lead Grabber verification code' : 'Your Lead Grabber login code';

	const htmlContent = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2 style="color: #333;">Verification code</h2>
            <p>Use this code to ${purpose === 'signup' ? 'complete your sign up' : 'log in'} to Lead Grabber:</p>
            <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px; margin: 24px 0;">${code}</p>
            <p style="color: #777;">This code expires in ${OTP_EXPIRY_MINUTES} minutes.</p>
            <p style="color: #777; font-size: 12px;">If you didn't request this, you can ignore this email.</p>
        </div>
    `;

	return sendEmail({
		to: [{ email: to }],
		subject,
		htmlContent
	});
}

export async function sendPasswordResetEmail(to: string, token: string, otpId: string) {
	const resetUrl = normalizeUrl(PUBLIC_BASE_URL, `/reset-password?token=${token}&id=${otpId}`);
	const subject = 'Reset your Lead Grabber password';

	const htmlContent = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2 style="color: #333;">Reset your password</h2>
            <p>We received a request to reset your password for your Lead Grabber account.</p>
            <div style="margin: 30px 0;">
                <a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
            </div>
            <p>This link will expire in 1 hour.</p>
            <p style="color: #777; font-size: 12px;">If you didn't request a password reset, you can safely ignore this email.</p>
        </div>
    `;

	return sendEmail({
		to: [{ email: to }],
		subject,
		htmlContent
	});
}
