/**
 * Send emails via the Gmail API using OAuth2 (rory.clearskysoftware@gmail.com).
 *
 * Uses raw HTTPS requests — no `googleapis` package needed.
 * Tokens are refreshed automatically when they expire.
 */

import {
	GMAIL_CLIENT_ID,
	GMAIL_CLIENT_SECRET,
	GMAIL_REFRESH_TOKEN,
	GMAIL_FROM_EMAIL
} from '$env/static/private';

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

/** Refresh the Gmail access token using the stored refresh token. */
async function getAccessToken(): Promise<string> {
	if (cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) {
		return cachedAccessToken;
	}

	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: GMAIL_CLIENT_ID,
			client_secret: GMAIL_CLIENT_SECRET,
			refresh_token: GMAIL_REFRESH_TOKEN,
			grant_type: 'refresh_token'
		})
	});

	if (!res.ok) {
		const errText = await res.text();
		throw new Error(`Gmail token refresh failed (${res.status}): ${errText}`);
	}

	const data = await res.json();
	cachedAccessToken = data.access_token;
	tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
	return cachedAccessToken!;
}

/**
 * Build an RFC 2822 email message and base64url-encode it for the Gmail API.
 */
function buildRawEmail(opts: {
	to: string;
	subject: string;
	htmlContent: string;
	fromName?: string;
	fromEmail?: string;
}): string {
	const from = opts.fromEmail || GMAIL_FROM_EMAIL || 'rory.clearskysoftware@gmail.com';
	const fromHeader = opts.fromName ? `"${opts.fromName}" <${from}>` : from;
	const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;

	const raw = [
		`From: ${fromHeader}`,
		`To: ${opts.to}`,
		`Subject: ${opts.subject}`,
		`MIME-Version: 1.0`,
		`Content-Type: multipart/alternative; boundary="${boundary}"`,
		'',
		`--${boundary}`,
		'Content-Type: text/plain; charset="UTF-8"',
		'',
		opts.htmlContent.replace(/<[^>]+>/g, ''), // plain-text fallback
		'',
		`--${boundary}`,
		'Content-Type: text/html; charset="UTF-8"',
		'',
		opts.htmlContent,
		'',
		`--${boundary}--`
	].join('\r\n');

	// Gmail API requires base64url encoding (no padding, URL-safe alphabet)
	return Buffer.from(raw)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

export interface GmailSendParams {
	to: string;
	subject: string;
	htmlContent: string;
	fromName?: string;
}

/**
 * Send an email via the Gmail API (rory.clearskysoftware@gmail.com).
 * Returns the Gmail message ID on success.
 */
export async function sendEmailViaGmail(params: GmailSendParams): Promise<{ messageId: string }> {
	if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
		throw new Error('Gmail OAuth credentials not configured (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN)');
	}

	const accessToken = await getAccessToken();
	const raw = buildRawEmail(params);

	console.log(`[Gmail Send] Sending to ${params.to} — subject: "${params.subject}"`);

	const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ raw })
	});

	if (!res.ok) {
		const errText = await res.text();
		console.error(`[Gmail Send] Failed (${res.status}):`, errText);
		throw new Error(`Gmail send failed (${res.status}): ${errText}`);
	}

	const data = await res.json();
	console.log(`[Gmail Send] ✅ Sent — messageId: ${data.id}`);
	return { messageId: data.id };
}
