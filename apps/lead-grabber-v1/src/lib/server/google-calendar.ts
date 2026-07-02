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
import { getDayHours } from './calendar';

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
		/** Tag the event with the customer's phone/email for reliable later lookup (not name). */
		phone?: string | null;
		email?: string | null;
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
		// Stable identity tags for exact later lookup (phone is the reliable key, not the name).
		const priv: Record<string, string> = {};
		const pk = phoneKey(opts.phone);
		if (pk) priv.customerPhone = pk;
		const em = (opts.email || opts.attendeeEmail || '').trim().toLowerCase();
		if (em) priv.customerEmail = em;
		if (Object.keys(priv).length) body.extendedProperties = { private: priv };
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
	opts: {
		summary: string;
		description?: string;
		attendeeEmail?: string | null;
		durationMin?: number;
		phone?: string | null;
	}
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
		phone: opts.phone,
		addMeet: true
	});
	if (!ev) return { status: 'failed', meetLink: null, htmlLink: null };
	return { status: 'booked', meetLink: ev.meetLink, htmlLink: ev.htmlLink };
}

export interface AppointmentRecord {
	startISO: string;
	title: string;
	isPast: boolean;
}

/**
 * A customer's appointments on the connected calendar. Matched RELIABLY by phone (the exact
 * `customerPhone` tag we set when booking) and email, with the name only as a fuzzy fallback —
 * so a customer giving a slightly different name still resolves. Returns past + upcoming within
 * the window, oldest-first, de-duplicated. Empty if not connected or no identifiers.
 */
export async function getCustomerAppointments(
	companyId: string,
	opts: {
		phone?: string | null;
		email?: string | null;
		name?: string | null;
		pastDays?: number;
		futureDays?: number;
		max?: number;
	}
): Promise<AppointmentRecord[]> {
	const auth = await getAccessToken(companyId);
	if (!auth) return [];
	const now = Date.now();
	const timeMin = new Date(now - (opts.pastDays ?? 365) * 86400000).toISOString();
	const timeMax = new Date(now + (opts.futureDays ?? 90) * 86400000).toISOString();
	const base = {
		timeMin,
		timeMax,
		singleEvents: 'true',
		orderBy: 'startTime',
		maxResults: String(opts.max ?? 25)
	};

	const fetchEvents = async (extra: Record<string, string>): Promise<any[]> => {
		try {
			const params = new URLSearchParams({ ...base, ...extra });
			const res = await fetch(
				`${CAL_API}/calendars/${encodeURIComponent(auth.calendarId)}/events?${params.toString()}`,
				{ headers: { Authorization: `Bearer ${auth.token}` } }
			);
			if (!res.ok) {
				console.error('[google-calendar] getCustomerAppointments failed:', await res.text());
				return [];
			}
			return (await res.json())?.items || [];
		} catch (e) {
			console.error('[google-calendar] getCustomerAppointments error:', e);
			return [];
		}
	};

	// Reliable exact-match queries first (phone tag, then email), then name as a fuzzy fallback.
	const queries: Record<string, string>[] = [];
	const pk = phoneKey(opts.phone);
	if (pk) queries.push({ privateExtendedProperty: `customerPhone=${pk}` });
	const em = (opts.email || '').trim().toLowerCase();
	if (em) queries.push({ privateExtendedProperty: `customerEmail=${em}` });
	const name = (opts.name || '').trim();
	if (name) queries.push({ q: name });
	if (queries.length === 0) return [];

	const byId = new Map<string, any>();
	for (const q of queries) {
		for (const ev of await fetchEvents(q)) {
			if (ev?.id && ev.status !== 'cancelled' && (ev.start?.dateTime || ev.start?.date)) {
				byId.set(ev.id, ev);
			}
		}
	}

	return Array.from(byId.values())
		.map((e: any) => {
			const startISO = e.start.dateTime || e.start.date;
			return { startISO, title: e.summary || 'Appointment', isPast: new Date(startISO).getTime() < now };
		})
		.sort((a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime());
}

/** Public URL of the self-service booking page for a company. */
export function getBookingPageUrl(companyId: string): string {
	return `${(PUBLIC_BASE_URL || '').replace(/\/$/, '')}/book/${companyId}`;
}

/** The self-service booking-page URL if Google Calendar is connected for this company, else null. */
export async function getBookingLinkIfConnected(companyId: string): Promise<string | null> {
	const conn = await getConnectionInfo(companyId);
	return conn.connected ? getBookingPageUrl(companyId) : null;
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}
/** Format-agnostic phone key (last 10 digits) used to tag + match events by phone. */
function phoneKey(phone: string | null | undefined): string {
	return (phone || '').replace(/\D/g, '').slice(-10);
}
function localNaive(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

export interface DaySlots {
	date: string;
	label: string;
	slots: { value: string; label: string }[];
}

/**
 * Open appointment slots for the next `days` days: the company's business hours MINUS anything
 * already busy on the connected Google Calendar. Empty array if not connected.
 */
export async function getAvailableSlots(
	companyId: string,
	opts: { days?: number; durationMin?: number; locations?: any[] } = {}
): Promise<DaySlots[]> {
	const auth = await getAccessToken(companyId);
	if (!auth) return [];
	const days = opts.days ?? 14;
	const dur = opts.durationMin ?? 60;
	const now = new Date();

	// Candidate slots within business hours across the window.
	const candidates: { start: Date; end: Date }[] = [];
	for (let d = 0; d < days; d++) {
		const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
		const hours = getDayHours(opts.locations || [], base.getDay());
		if (!hours) continue;
		for (let h = hours.startH; h + dur / 60 <= hours.endH; h += dur / 60) {
			const hh = Math.floor(h);
			const mm = Math.round((h - hh) * 60);
			const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mm, 0, 0);
			if (start.getTime() <= now.getTime() + 60 * 60 * 1000) continue; // at least 1h out
			candidates.push({ start, end: new Date(start.getTime() + dur * 60000) });
		}
	}
	if (candidates.length === 0) return [];

	// One free/busy query for the whole window.
	let busy: { start: string; end: string }[] = [];
	try {
		const res = await fetch(`${CAL_API}/freeBusy`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				timeMin: candidates[0].start.toISOString(),
				timeMax: candidates[candidates.length - 1].end.toISOString(),
				items: [{ id: auth.calendarId }]
			})
		});
		if (res.ok) {
			const data = await res.json();
			busy = data?.calendars?.[auth.calendarId]?.busy ?? [];
		}
	} catch (e) {
		console.error('[google-calendar] getAvailableSlots freeBusy error:', e);
	}
	const busyRanges = busy.map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()] as [number, number]);

	const groups = new Map<string, { label: string; slots: { value: string; label: string }[] }>();
	for (const c of candidates) {
		const s = c.start.getTime();
		const e = c.end.getTime();
		if (busyRanges.some(([bs, be]) => s < be && e > bs)) continue; // overlaps a busy block
		const dateKey = c.start.toDateString();
		if (!groups.has(dateKey)) {
			groups.set(dateKey, {
				label: c.start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
				slots: []
			});
		}
		groups.get(dateKey)!.slots.push({
			value: localNaive(c.start),
			label: c.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
		});
	}
	return Array.from(groups.entries()).map(([date, g]) => ({ date, label: g.label, slots: g.slots }));
}
