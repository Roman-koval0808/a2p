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
import { getDayHours, formatDatetime } from './calendar';
import { bookingLinkWith } from '$lib/utils/booking';

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
	scope?: string;
}

const CAL_FULL = 'https://www.googleapis.com/auth/calendar';
const CAL_EVENTS = 'https://www.googleapis.com/auth/calendar.events';
const CAL_READONLY = 'https://www.googleapis.com/auth/calendar.readonly';

/** True only if the granted scopes cover BOTH event creation and free/busy reads. */
function hasCalendarScopes(scope: string | undefined): boolean {
	const g = new Set((scope || '').split(/\s+/).filter(Boolean));
	const canWrite = g.has(CAL_EVENTS) || g.has(CAL_FULL);
	const canReadBusy = g.has(CAL_READONLY) || g.has(CAL_FULL);
	return canWrite && canReadBusy;
}

export type ConnectResult = 'connected' | 'missing_scope' | 'error';

/**
 * If a calendar call fails with a "scopes insufficient" 403, the stored token can never work —
 * clear the connection so the app degrades to "not connected" (and prompts a re-consent) instead
 * of 403ing forever.
 */
async function clearIfScopeError(companyId: string, status: number, bodyText: string): Promise<void> {
	if (
		status === 403 &&
		/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes|insufficientPermissions/i.test(
			bodyText
		)
	) {
		console.error(
			'[google-calendar] token lacks calendar scopes — clearing connection so the user re-consents.'
		);
		await prisma.googleCalendarConnection.deleteMany({ where: { companyId } }).catch(() => {});
	}
}

/** Exchange the auth code for tokens and persist the connection for a company. */
export async function exchangeCodeAndSave(code: string, companyId: string): Promise<ConnectResult> {
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
			return 'error';
		}
		const tok = (await res.json()) as TokenResponse;

		// The user must have granted the calendar permissions. If they un-checked them on the
		// consent screen (or the scopes aren't in the Cloud config), the token can't touch the
		// calendar — refuse the connection rather than saving a broken "connected" state.
		if (!hasCalendarScopes(tok.scope)) {
			console.error('[google-calendar] connect rejected — calendar scopes not granted:', tok.scope);
			await prisma.googleCalendarConnection.deleteMany({ where: { companyId } }).catch(() => {});
			return 'missing_scope';
		}

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
		return 'connected';
	} catch (e) {
		console.error('[google-calendar] exchangeCodeAndSave error:', e);
		return 'error';
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

/**
 * The business operates on Eastern Time. Use the IANA zone, NOT the literal "EST": "EST" is a
 * fixed -05:00 that never observes daylight saving, so every summer booking would land an hour
 * early. "America/Toronto" switches EST/EDT automatically.
 *
 * Our appointment times are naive wall-clock ("2026-07-25T10:00:00") and Google rejects those
 * unless a timeZone accompanies them — this is that zone.
 */
export const BUSINESS_TIME_ZONE = 'America/Toronto';

const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Resolve a NAIVE wall-clock string ("2026-07-25T10:00:00") to the absolute instant it refers to
 * IN `timeZone` — independent of whatever zone the server happens to run in.
 *
 * Without this, `new Date("2026-07-25T10:00:00")` silently means "10am wherever the server is",
 * so a Europe-hosted box books an Ontario customer six hours off.
 */
export function zonedNaiveToUtc(naive: string, timeZone = BUSINESS_TIME_ZONE): Date {
	const asIfUtc = new Date(`${naive}Z`);
	if (isNaN(asIfUtc.getTime())) return new Date(naive); // unparseable → best effort
	// Sampling the offset at `asIfUtc` is only an approximation: on a DST-transition day that
	// instant can sit on the far side of the switch, landing the result an hour off. Re-sampling
	// at the corrected instant converges (standard two-pass zone resolution).
	const first = offsetMsAt(asIfUtc, timeZone);
	const refined = offsetMsAt(new Date(asIfUtc.getTime() - first), timeZone);
	return new Date(asIfUtc.getTime() - refined);
}

/** The zone's UTC offset, in ms, at a given absolute instant. */
function offsetMsAt(instant: Date, timeZone: string): number {
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
	const p: Record<string, string> = {};
	for (const part of dtf.formatToParts(instant)) p[part.type] = part.value;
	const rendered = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
	return rendered - instant.getTime();
}

/** Absolute instant for a datetime that may be naive (business zone) or already offset-bearing. */
export function toUtcInstant(iso: string, timeZone = BUSINESS_TIME_ZONE): Date {
	return HAS_OFFSET.test(iso) ? new Date(iso) : zonedNaiveToUtc(iso, timeZone);
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
		// freeBusy demands real RFC3339 instants. Callers pass naive wall-clock times, which Google
		// rejects outright (400 Bad Request) — resolve them in the business zone first so we both
		// stop erroring AND check the window the customer actually meant.
		const res = await fetch(`${CAL_API}/freeBusy`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				timeMin: toUtcInstant(startISO).toISOString(),
				timeMax: toUtcInstant(endISO).toISOString(),
				items: [{ id: auth.calendarId }]
			})
		});
		if (!res.ok) {
			const body = await res.text();
			console.error('[google-calendar] freeBusy failed:', body);
			await clearIfScopeError(companyId, res.status, body);
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
		// Google REQUIRES a timezone whenever dateTime carries no UTC offset, and our appointment
		// times are naive wall-clock. Eastern Time keeps the event at the wall-clock time the
		// customer asked for instead of shifting it by the server's zone.
		const timeZone = opts.timeZone || BUSINESS_TIME_ZONE;
		const body: any = {
			summary: opts.summary,
			description: opts.description || undefined,
			start: { dateTime: opts.startISO, timeZone },
			end: { dateTime: opts.endISO, timeZone }
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
			const body = await res.text();
			console.error('[google-calendar] createEvent failed:', body);
			await clearIfScopeError(companyId, res.status, body);
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
	id: string;
	startISO: string;
	title: string;
	isPast: boolean;
}

/** Cancel/delete a specific event by id. Used for reschedules (deletes ONLY the given event). */
export async function deleteEvent(companyId: string, eventId: string): Promise<boolean> {
	const auth = await getAccessToken(companyId);
	if (!auth || !eventId) return false;
	try {
		const res = await fetch(
			`${CAL_API}/calendars/${encodeURIComponent(auth.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
			{ method: 'DELETE', headers: { Authorization: `Bearer ${auth.token}` } }
		);
		// 200/204 = deleted; 410 = already gone (treat as success).
		return res.ok || res.status === 410;
	} catch (e) {
		console.error('[google-calendar] deleteEvent error:', e);
		return false;
	}
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
			return {
				id: e.id,
				startISO,
				title: e.summary || 'Appointment',
				isPast: new Date(startISO).getTime() < now
			};
		})
		.sort((a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime());
}

/**
 * Pick which upcoming appointment a reschedule request refers to — SAFELY:
 *  - exactly one upcoming → that one;
 *  - the message names a day/date that matches exactly one → that one;
 *  - otherwise → null (ambiguous; the caller must ASK, never guess).
 */
function pickRescheduleTarget(message: string, upcoming: AppointmentRecord[]): AppointmentRecord | null {
	if (upcoming.length === 0) return null;
	if (upcoming.length === 1) return upcoming[0];
	const lower = (message || '').toLowerCase();
	const matched = upcoming.filter((a) => {
		const d = new Date(a.startISO);
		const weekday = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase(); // "friday"
		const monthDay = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }).toLowerCase(); // "july 4"
		const dayNum = d.getDate();
		return (
			lower.includes(weekday) ||
			lower.includes(monthDay) ||
			new RegExp(`\\b${dayNum}(st|nd|rd|th)?\\b`).test(lower)
		);
	});
	return matched.length === 1 ? matched[0] : null;
}

export interface RescheduleResult {
	mode: 'link' | 'ask' | 'none';
	link?: string;
	targetLabel?: string;
	options?: string[];
}

/**
 * Resolve a reschedule request into an action. Matches the customer's UPCOMING appointments by
 * phone (reliable), then decides the exact target. Returns a deep-link carrying the EXACT event id
 * to cancel (mode 'link'), or asks which one when ambiguous (mode 'ask'), or 'none' if they have no
 * upcoming appointment. Never targets "the latest" — so it can't move the wrong appointment.
 */
export async function resolveReschedule(
	companyId: string,
	opts: { message: string; phone?: string | null; name?: string | null; email?: string | null }
): Promise<RescheduleResult> {
	const appts = await getCustomerAppointments(companyId, {
		phone: opts.phone,
		email: opts.email,
		name: opts.name
	});
	const upcoming = appts.filter((a) => !a.isPast);
	if (upcoming.length === 0) return { mode: 'none' };

	const target = pickRescheduleTarget(opts.message, upcoming);
	if (!target) {
		return { mode: 'ask', options: upcoming.map((a) => formatDatetime(a.startISO)) };
	}
	const link = bookingLinkWith(getBookingPageUrl(companyId), {
		name: opts.name,
		phone: opts.phone,
		reschedule: target.id
	});
	return { mode: 'link', link, targetLabel: formatDatetime(target.startISO) };
}

export interface CancelResult {
	mode: 'cancelled' | 'ask' | 'none' | 'error';
	cancelledLabel?: string;
	options?: string[];
}

/**
 * Resolve a cancellation request and, when the target is unambiguous, actually cancel it on the
 * calendar (Google sends the cancellation notice via `sendUpdates=all`). Matches the customer's
 * UPCOMING appointments by phone (reliable), then decides the exact target with the SAME safe
 * disambiguation used for reschedules: cancels only when there's exactly one upcoming appointment,
 * or the message names a day/date that matches exactly one — otherwise asks which one. Never cancels
 * "the latest", so it can't cancel the wrong appointment.
 */
export async function resolveCancel(
	companyId: string,
	opts: { message: string; phone?: string | null; name?: string | null; email?: string | null }
): Promise<CancelResult> {
	const appts = await getCustomerAppointments(companyId, {
		phone: opts.phone,
		email: opts.email,
		name: opts.name
	});
	const upcoming = appts.filter((a) => !a.isPast);
	if (upcoming.length === 0) return { mode: 'none' };

	const target = pickRescheduleTarget(opts.message, upcoming);
	if (!target) {
		return { mode: 'ask', options: upcoming.map((a) => formatDatetime(a.startISO)) };
	}
	const ok = await deleteEvent(companyId, target.id);
	const label = formatDatetime(target.startISO);
	return ok ? { mode: 'cancelled', cancelledLabel: label } : { mode: 'error', cancelledLabel: label };
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
	let freeBusyOk = false;
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
			freeBusyOk = true;
		} else {
			console.error(`[google-calendar] getAvailableSlots freeBusy HTTP ${res.status}`);
		}
	} catch (e) {
		console.error('[google-calendar] getAvailableSlots freeBusy error:', e);
	}
	// If we couldn't actually read the calendar's busy times, DON'T return every business-hour
	// candidate as "open" — that would advertise slots that may already be booked. Return nothing
	// so callers fall back to a safe business-hours answer instead.
	if (!freeBusyOk) return [];
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
