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
	// Gmail requires From to be the authenticated account (or a verified send-as alias). When
	// sending via a per-company connection this is that account's own email; otherwise the
	// single-account default.
	const from = opts.fromEmail || 'rory.clearskysoftware@gmail.com';
	// RFC 2047: non-ASCII in a header (e.g. an em-dash "—") must be encoded, or clients render it as
	// mojibake ("Ã¢Â€Â") and spam filters flag it. Pure-ASCII passes through unchanged.
	const encodeHeader = (s: string) =>
		/^[\x00-\x7F]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
	const fromHeader = opts.fromName ? `"${encodeHeader(opts.fromName)}" <${from}>` : from;
	const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;

	const raw = [
		`From: ${fromHeader}`,
		`To: ${opts.to}`,
		`Subject: ${encodeHeader(opts.subject)}`,
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

/**
 * Send an email using the SAME Google account the company connected for Calendar (no separate
 * GMAIL_* credentials needed). The message goes out FROM that connected account.
 *
 * Requires the connection to have been granted the `gmail.send` scope — i.e. the owner must have
 * reconnected Google Calendar AFTER that scope was added. If the token lacks the scope, Gmail
 * returns 403 and we throw a clear "reconnect" error so the caller can fall back.
 */
export async function sendEmailViaConnectedGmail(
	companyId: string,
	params: GmailSendParams
): Promise<{ messageId: string }> {
	const { getConnectionAccessToken } = await import('./google-calendar');
	const auth = await getConnectionAccessToken(companyId);
	if (!auth) {
		throw new Error(`No connected Google account for company ${companyId} (connect it in Settings → Company).`);
	}

	const raw = buildRawEmail({ ...params, fromEmail: auth.email || undefined });
	console.log(
		`[Gmail Send · connected] Sending to ${params.to} from ${auth.email || 'default'} — subject: "${params.subject}"`
	);

	const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
		method: 'POST',
		headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ raw })
	});

	if (!res.ok) {
		const errText = await res.text();
		console.error(`[Gmail Send · connected] Failed (${res.status}):`, errText);
		if (res.status === 403 && /insufficient|scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(errText)) {
			throw new Error(
				'Connected Google account is missing the gmail.send scope — reconnect Google Calendar in Settings → Company to grant it.'
			);
		}
		throw new Error(`Connected Gmail send failed (${res.status}): ${errText}`);
	}

	const data = await res.json();
	console.log(`[Gmail Send · connected] ✅ Sent — messageId: ${data.id}`);
	return { messageId: data.id };
}
