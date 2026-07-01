// Google Calendar OAuth + booking integration.
//
// Flow: the business owner clicks "Connect Google Calendar" (→ /api/google/calendar/connect),
// consents, and we store a refresh token (GoogleCalendarConnection table). Thereafter, when the
// AI agrees an appointment time over SMS, we check the calendar's free/busy and create the event
// (with a Google Meet link) on the business's calendar. No booking page to maintain — Google owns
// availability, reminders and cancellation.
//
// Uses raw fetch (no googleapis dep). Every DB read is wrapped so a missing table / not-connected
// company degrades to "not connected" instead of throwing.

import { prisma } from '$lib/db';
import { env } from '$env/dynamic/private';
import { PUBLIC_BASE_URL } from '$env/static/public';

// Dynamic env so an unconfigured deployment still builds (feature simply stays off).
const GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET || '';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';
const CAL_API = 'https://www.googleapis.com/calendar/v3';

const SCOPES = [
	'openid',
	'email',
	'https://www.googleapis.com/auth/calendar.events',
	'https://www.googleapis.com/auth/calendar.readonly'
].join(' ');

export function isGoogleConfigured(): boolean {
	return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

export function getRedirectUri(): string {
	return `${(PUBLIC_BASE_URL || '').replace(/\/$/, '')}/api/google/calendar/callback`;
}

/** Build the Google consent URL. `state` carries the companyId back to the callback. */
export function getAuthUrl(companyId: string): string {
	const params = new URLSearchParams({
		client_id: GOOGLE_CLIENT_ID,
		redirect_uri: getRedirectUri(),
		response_type: 'code',
		scope: SCOPES,
		access_type: 'offline',
		include_granted_scopes: 'true',
		prompt: 'consent', // force a refresh_token every time
		state: companyId
	});
	return `${AUTH_ENDPOINT}?${params.toString()}`;
}

interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in: number;
	id_token?: string;
}

/** Exchange the auth code for tokens and persist the connection for a company. */
export async function exchangeCodeAndSave(code: string, companyId: string): Promise<boolean> {
	try {
		const res = await fetch(TOKEN_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				code,
				client_id: GOOGLE_CLIENT_ID,
				client_secret: GOOGLE_CLIENT_SECRET,
				redirect_uri: getRedirectUri(),
				grant_type: 'authorization_code'
			})
		});
		if (!res.ok) {
			console.error('[google-calendar] token exchange failed:', await res.text());
			return false;
		}
		const tok = (await res.json()) as TokenResponse;

		// Fetch the connected account's email (nice to show in settings).
		let email: string | null = null;
		try {
			const ui = await fetch(USERINFO_ENDPOINT, {
				headers: { Authorization: `Bearer ${tok.access_token}` }
			});
			if (ui.ok) email = (await ui.json())?.email ?? null;
		} catch {
			/* email is best-effort */
		}

		const expiresAt = new Date(Date.now() + (tok.expires_in || 3600) * 1000);
		await prisma.googleCalendarConnection.upsert({
			where: { companyId },
			create: {
				companyId,
				email,
				accessToken: tok.access_token,
				refreshToken: tok.refresh_token || null,
				expiresAt,
				calendarId: 'primary'
			},
			// On re-connect Google may omit refresh_token — keep the existing one if so.
			update: {
				email,
				accessToken: tok.access_token,
				...(tok.refresh_token ? { refreshToken: tok.refresh_token } : {}),
				expiresAt
			}
		});
		return true;
	} catch (e) {
		console.error('[google-calendar] exchangeCodeAndSave error:', e);
		return false;
	}
}

export interface GoogleConnectionInfo {
	connected: boolean;
	email: string | null;
}

/** Lightweight status for the settings UI. Never returns tokens. */
export async function getConnectionInfo(companyId: string): Promise<GoogleConnectionInfo> {
	try {
		const c = await prisma.googleCalendarConnection.findUnique({
			where: { companyId },
			select: { email: true, refreshToken: true }
		});
		return { connected: !!c?.refreshToken, email: c?.email ?? null };
	} catch {
		return { connected: false, email: null };
	}
}

export async function disconnect(companyId: string): Promise<void> {
	try {
		await prisma.googleCalendarConnection.deleteMany({ where: { companyId } });
	} catch (e) {
		console.error('[google-calendar] disconnect error:', e);
	}
}

/** Return a valid access token for the company, refreshing if needed. null = not connected. */
async function getAccessToken(companyId: string): Promise<{ token: string; calendarId: string } | null> {
	let conn;
	try {
		conn = await prisma.googleCalendarConnection.findUnique({ where: { companyId } });
	} catch {
		return null;
	}
	if (!conn?.refreshToken) return null;

	const stillValid = conn.accessToken && conn.expiresAt && conn.expiresAt.getTime() - Date.now() > 60_000;
	if (stillValid) return { token: conn.accessToken as string, calendarId: conn.calendarId };

	try {
		const res = await fetch(TOKEN_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: GOOGLE_CLIENT_ID,
				client_secret: GOOGLE_CLIENT_SECRET,
				refresh_token: conn.refreshToken,
				grant_type: 'refresh_token'
			})
		});
		if (!res.ok) {
			console.error('[google-calendar] token refresh failed:', await res.text());
			return null;
		}
		const tok = (await res.json()) as TokenResponse;
		const expiresAt = new Date(Date.now() + (tok.expires_in || 3600) * 1000);
		await prisma.googleCalendarConnection.update({
			where: { companyId },
			data: { accessToken: tok.access_token, expiresAt }
		});
		return { token: tok.access_token, calendarId: conn.calendarId };
	} catch (e) {
		console.error('[google-calendar] refresh error:', e);
		return null;
	}
}

/** True if the calendar has no conflicting event for [startISO, endISO). null = can't tell / not connected. */
export async function isTimeFree(
	companyId: string,
	startISO: string,
	endISO: string
): Promise<boolean | null> {
	const auth = await getAccessToken(companyId);
	if (!auth) return null;
	try {
		const res = await fetch(`${CAL_API}/freeBusy`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ timeMin: startISO, timeMax: endISO, items: [{ id: auth.calendarId }] })
		});
		if (!res.ok) {
			console.error('[google-calendar] freeBusy failed:', await res.text());
			return null;
		}
		const data = await res.json();
		const busy = data?.calendars?.[auth.calendarId]?.busy ?? [];
		return busy.length === 0;
	} catch (e) {
		console.error('[google-calendar] freeBusy error:', e);
		return null;
	}
}

export interface CreatedEvent {
	eventId: string;
	htmlLink: string | null;
	meetLink: string | null;
}

/** Create an event on the business calendar (optionally with a Meet link + customer invite). */
export async function createEvent(
	companyId: string,
	opts: {
		summary: string;
		description?: string;
		startISO: string;
		endISO: string;
		attendeeEmail?: string | null;
		addMeet?: boolean;
		timeZone?: string;
	}
): Promise<CreatedEvent | null> {
	const auth = await getAccessToken(companyId);
	if (!auth) return null;
	try {
		const body: any = {
			summary: opts.summary,
			description: opts.description || undefined,
			start: { dateTime: opts.startISO, ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) },
			end: { dateTime: opts.endISO, ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) }
		};
		if (opts.attendeeEmail) body.attendees = [{ email: opts.attendeeEmail }];
		if (opts.addMeet) {
			body.conferenceData = {
				createRequest: {
					requestId: `a2p-${companyId}-${Date.now()}`,
					conferenceSolutionKey: { type: 'hangoutsMeet' }
				}
			};
		}
		const qs = new URLSearchParams({ sendUpdates: 'all' });
		if (opts.addMeet) qs.set('conferenceDataVersion', '1');
		const res = await fetch(
			`${CAL_API}/calendars/${encodeURIComponent(auth.calendarId)}/events?${qs.toString()}`,
			{
				method: 'POST',
				headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			}
		);
		if (!res.ok) {
			console.error('[google-calendar] createEvent failed:', await res.text());
			return null;
		}
		const ev = await res.json();
		const meetLink =
			ev?.hangoutLink ||
			ev?.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri ||
			null;
		return { eventId: ev.id, htmlLink: ev.htmlLink ?? null, meetLink };
	} catch (e) {
		console.error('[google-calendar] createEvent error:', e);
		return null;
	}
}

export interface BookResult {
	status: 'booked' | 'busy' | 'failed';
	meetLink: string | null;
	htmlLink: string | null;
}

/**
 * High-level: check the calendar is free for the given (naive, business-local) datetime and book
 * it with a Meet link. The naive time is interpreted in the server's timezone — for a single
 * business deployment the server should run in that business's timezone.
 */
export async function bookAppointment(
	companyId: string,
	datetimeNaive: string,
	opts: { summary: string; description?: string; attendeeEmail?: string | null; durationMin?: number }
): Promise<BookResult> {
	const start = new Date(datetimeNaive);
	if (isNaN(start.getTime())) return { status: 'failed', meetLink: null, htmlLink: null };
	const startISO = start.toISOString();
	const endISO = new Date(start.getTime() + (opts.durationMin || 60) * 60_000).toISOString();

	const free = await isTimeFree(companyId, startISO, endISO);
	if (free === false) return { status: 'busy', meetLink: null, htmlLink: null };

	const ev = await createEvent(companyId, {
		summary: opts.summary,
		description: opts.description,
		startISO,
		endISO,
		attendeeEmail: opts.attendeeEmail,
		addMeet: true
	});
	if (!ev) return { status: 'failed', meetLink: null, htmlLink: null };
	return { status: 'booked', meetLink: ev.meetLink, htmlLink: ev.htmlLink };
}
