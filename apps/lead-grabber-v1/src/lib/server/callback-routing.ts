// Leadbox "Request a Call" routing — the pure decision half.
//
// Robert picks ASAP, Morning or Afternoon in the leadbox sub-form. What happens next depends only
// on that choice, the clock, the admin's business hours and the rep schedules — all four are
// arguments, so the matrix is testable without a database, Telnyx, or a particular wall-clock time.
// Same split as emergency-routing.ts, and for the same reason.
//
// Everything that actually rings a phone lives in callback-dispatch.ts.
//
// The rules as stated:
//   ASAP, in hours   → bridge now via the emergency dial ladder.
//   ASAP, after hours → auto-reply "a rep will call when we open", and book the next opening.
//   Morning asked in the morning     → next open day, morning.
//   Afternoon asked in the morning   → that same afternoon.
//   Afternoon asked in the afternoon → next open day, afternoon.
//
// Those three window cases are one rule, not a table: **the next occurrence of the requested window
// that we are not already inside.** Being inside the window you asked for means today's is already
// underway, so it rolls to the next open day; a window still ahead of you today stays today. That
// also settles the case nobody stated (afternoon, asked for morning → tomorrow morning).
//
// TIMEZONE: every wall-clock comparison happens in the BUSINESS's zone, never the server's.
// This is not a nicety — the production host runs at +02:00 while the businesses are North
// American, so reading `at.getHours()` put a 17:31 Toronto request (office open) into the
// after-hours branch and booked the callback for 08:00 server time = 02:00 Toronto. This repo has
// been bitten by exactly this before; see the regression note at the top of calendar.test.ts
// ("a customer was offered a 'Monday at 3:00 AM' furnace slot").
//
// The zone is an argument, defaulted to America/Toronto to match `BUSINESS_TIME_ZONE` in
// google-calendar.ts. It is passed in rather than imported so this module stays free of `$lib/db`
// and remains testable without mocks.

import type { BusinessHoursConfig } from '$lib/utils/auto-reply';
import { zonedNaiveToUtc } from './datetime';

/** Matches `BUSINESS_TIME_ZONE` in google-calendar.ts. Imported by value there; duplicated as a
 *  default here only so this module keeps zero runtime dependencies. */
export const DEFAULT_BUSINESS_TIME_ZONE = 'America/Toronto';

/** Wall-clock fields of an instant, as read in a given zone. */
interface ZonedParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	/** 0 = Sunday, matching Date#getDay. */
	weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
	Sun: 0,
	Mon: 1,
	Tue: 2,
	Wed: 3,
	Thu: 4,
	Fri: 5,
	Sat: 6
};

function partsIn(at: Date, timeZone: string): ZonedParts {
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour12: false,
		weekday: 'short',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit'
	});
	const p: Record<string, string> = {};
	for (const part of dtf.formatToParts(at)) p[part.type] = part.value;
	return {
		year: +p.year,
		month: +p.month,
		day: +p.day,
		// Intl renders midnight as 24 in some ICU versions; normalise.
		hour: +p.hour % 24,
		minute: +p.minute,
		weekday: WEEKDAY_INDEX[p.weekday] ?? 0
	};
}

/** Minutes since midnight, in the business's zone. */
function minutesOfDayIn(at: Date, timeZone: string): number {
	const p = partsIn(at, timeZone);
	return p.hour * 60 + p.minute;
}

/** The instant at which a given wall-clock time occurs on a given business-zone calendar day. */
function instantForWallClock(
	day: ZonedParts,
	minutesOfDay: number,
	timeZone: string
): Date {
	const pad = (n: number) => String(n).padStart(2, '0');
	const naive =
		`${day.year}-${pad(day.month)}-${pad(day.day)}` +
		`T${pad(Math.floor(minutesOfDay / 60))}:${pad(minutesOfDay % 60)}:00`;
	return zonedNaiveToUtc(naive, timeZone);
}

/** The business-zone calendar day `offset` days after the one containing `at`. */
function dayIn(at: Date, offset: number, timeZone: string): ZonedParts {
	// Step in UTC from local noon so a DST transition cannot skip or repeat a day.
	const base = partsIn(at, timeZone);
	const noon = instantForWallClock(base, 12 * 60, timeZone);
	return partsIn(new Date(noon.getTime() + offset * 24 * 3600 * 1000), timeZone);
}

export type CallbackPreference = 'ASAP' | 'MORNING' | 'AFTERNOON';
export type CallbackWindow = 'MORNING' | 'AFTERNOON';

/** Local hour that splits a business day into morning and afternoon. */
export const DEFAULT_MIDDAY_HOUR = 12;

/** How far ahead to look for an open day before giving up. */
const MAX_LOOKAHEAD_DAYS = 14;

const DAY_NAMES = [
	'sunday',
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday'
] as const;

interface HoursRange {
	startMin: number;
	endMin: number;
}

/**
 * Parse the admin's "8:00 AM - 6:00 PM" business-hours string into minutes since midnight.
 *
 * NOTE: `isBusinessHours` in $lib/utils/auto-reply.ts parses the same stored format inline. That
 * one reads `new Date()` internally so it cannot be driven from a supplied time, which is exactly
 * what the window arithmetic below needs. The two must stay in agreement; worth collapsing into one
 * exported parser next time auto-reply.ts is touched.
 */
function parseHoursRange(hours: string | null | undefined): HoursRange | null {
	if (!hours || typeof hours !== 'string') return null;
	const parts = hours.split(' - ');
	if (parts.length !== 2) return null;

	const toMinutes = (time: string): number | null => {
		const [timePart, period] = time.trim().split(' ');
		if (!timePart) return null;
		const [h, m = '0'] = timePart.split(':');
		let hour24 = parseInt(h, 10);
		const minutes = parseInt(m, 10);
		if (Number.isNaN(hour24) || Number.isNaN(minutes)) return null;
		if (period === 'PM' && hour24 !== 12) hour24 += 12;
		else if (period === 'AM' && hour24 === 12) hour24 = 0;
		return hour24 * 60 + minutes;
	};

	const startMin = toMinutes(parts[0]);
	const endMin = toMinutes(parts[1]);
	if (startMin === null || endMin === null || endMin <= startMin) return null;
	return { startMin, endMin };
}

function hoursForDay(day: ZonedParts, businessHours: BusinessHoursConfig): HoursRange | null {
	const cfg = businessHours?.[DAY_NAMES[day.weekday]];
	if (!cfg?.isOpen || !cfg.hours) return null;
	return parseHoursRange(cfg.hours);
}

/**
 * Read the customer's choice back out of the message the widget composes
 * ("Requested Call back. Preferred Time: Morning").
 *
 * The widget is the only writer today, but it arrives as free text through /api/messages, so this
 * parses defensively. Returns null when the message is not a callback request at all, which is what
 * makes it safe to run on every inbound leadbox message.
 */
export function parseCallbackPreference(text: string | null | undefined): CallbackPreference | null {
	if (!text) return null;
	const lower = text.toLowerCase();
	if (!lower.includes('call back') && !lower.includes('callback') && !lower.includes('call me')) {
		return null;
	}
	// Named windows win over ASAP, so "call me back as soon as you can, afternoon is best" is
	// read as the window he actually named.
	if (/\bmorning\b/.test(lower)) return 'MORNING';
	if (/\bafternoon\b/.test(lower)) return 'AFTERNOON';
	return 'ASAP';
}

export interface CallbackWindowConfig {
	middayHour: number;
}

export function windowConfigFrom(settings: unknown): CallbackWindowConfig {
	const raw = (settings as any)?.callbackWindows?.middayHour;
	return {
		middayHour: typeof raw === 'number' && raw >= 1 && raw <= 23 ? raw : DEFAULT_MIDDAY_HOUR
	};
}

export function isOpenAt(
	at: Date,
	businessHours: BusinessHoursConfig,
	timeZone: string = DEFAULT_BUSINESS_TIME_ZONE
): boolean {
	const range = hoursForDay(partsIn(at, timeZone), businessHours);
	if (!range) return false;
	const minutes = minutesOfDayIn(at, timeZone);
	return minutes >= range.startMin && minutes < range.endMin;
}

/** Which half of the business day a moment falls in, or null when the office is shut. */
export function windowAt(
	at: Date,
	businessHours: BusinessHoursConfig,
	config: CallbackWindowConfig,
	timeZone: string = DEFAULT_BUSINESS_TIME_ZONE
): CallbackWindow | null {
	if (!isOpenAt(at, businessHours, timeZone)) return null;
	return minutesOfDayIn(at, timeZone) < config.middayHour * 60 ? 'MORNING' : 'AFTERNOON';
}

/** Start of a window on a given day, clamped inside that day's opening hours. */
function windowStartOn(
	day: ZonedParts,
	window: CallbackWindow,
	businessHours: BusinessHoursConfig,
	config: CallbackWindowConfig,
	timeZone: string
): Date | null {
	const range = hoursForDay(day, businessHours);
	if (!range) return null;

	const middayMin = config.middayHour * 60;
	// A day that shuts before midday has no afternoon; one that opens after it has no morning.
	const start = window === 'MORNING' ? range.startMin : Math.max(range.startMin, middayMin);
	const end = window === 'MORNING' ? Math.min(range.endMin, middayMin) : range.endMin;
	if (start >= end) return null;

	return instantForWallClock(day, start, timeZone);
}

/** The next time the office is open; the current moment when we are open right now. */
export function nextOpening(
	now: Date,
	businessHours: BusinessHoursConfig,
	timeZone: string = DEFAULT_BUSINESS_TIME_ZONE
): Date | null {
	if (isOpenAt(now, businessHours, timeZone)) return new Date(now);
	for (let i = 0; i <= MAX_LOOKAHEAD_DAYS; i++) {
		const day = dayIn(now, i, timeZone);
		const range = hoursForDay(day, businessHours);
		if (!range) continue;
		const openAt = instantForWallClock(day, range.startMin, timeZone);
		if (openAt > now) return openAt;
	}
	return null;
}

/**
 * The next occurrence of `window` that we are not already inside — the one rule behind all three
 * stated cases. Closed days are skipped, so a Friday-afternoon request lands on Monday.
 */
export function nextWindowStart(
	now: Date,
	window: CallbackWindow,
	businessHours: BusinessHoursConfig,
	config: CallbackWindowConfig,
	timeZone: string = DEFAULT_BUSINESS_TIME_ZONE
): Date | null {
	const insideRequestedWindow = windowAt(now, businessHours, config, timeZone) === window;

	for (let i = 0; i <= MAX_LOOKAHEAD_DAYS; i++) {
		const day = dayIn(now, i, timeZone);
		const start = windowStartOn(day, window, businessHours, config, timeZone);
		if (!start) continue;
		if (i === 0) {
			if (insideRequestedWindow) continue; // already in it → today is spoken for
			if (start <= now) continue; // already past it
		}
		return start;
	}
	return null;
}

export type CallbackDecision =
	| { action: 'bridge_now'; reason: string }
	| {
			action: 'schedule';
			callAt: Date;
			window: CallbackWindow | null;
			/** Office was shut — this is what triggers the auto-reply to the customer. */
			afterHours: boolean;
			reason: string;
	  }
	| { action: 'manual'; reason: string };

/**
 * The whole matrix in one call.
 *
 * `manual` when no slot exists inside the lookahead (an all-closed week, or a midday hour outside
 * every opening). Someone has to look at it; we never invent a time.
 */
export function decideCallback(input: {
	preference: CallbackPreference;
	now: Date;
	businessHours: BusinessHoursConfig;
	config?: CallbackWindowConfig;
	/** The BUSINESS's zone, not the server's. See the timezone note at the top of this file. */
	timeZone?: string;
}): CallbackDecision {
	const config = input.config ?? { middayHour: DEFAULT_MIDDAY_HOUR };
	const timeZone = input.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE;
	const { preference, now, businessHours } = input;

	if (preference === 'ASAP') {
		if (isOpenAt(now, businessHours, timeZone)) {
			return { action: 'bridge_now', reason: 'asap_during_business_hours' };
		}
		const openAt = nextOpening(now, businessHours, timeZone);
		if (!openAt) return { action: 'manual', reason: 'no_opening_found' };
		return {
			action: 'schedule',
			callAt: openAt,
			window: windowAt(openAt, businessHours, config, timeZone),
			afterHours: true,
			reason: 'asap_after_hours'
		};
	}

	const callAt = nextWindowStart(now, preference, businessHours, config, timeZone);
	if (!callAt) return { action: 'manual', reason: `no_${preference.toLowerCase()}_slot_found` };

	return {
		action: 'schedule',
		callAt,
		window: preference,
		// He named a time, so there is nothing to apologise for — a window request made out of
		// hours does not earn a "we're closed" reply.
		afterHours: false,
		reason: `requested_${preference.toLowerCase()}`
	};
}

// ---------------------------------------------------------------------------
// Rep rota — from the existing /representatives schedules
// ---------------------------------------------------------------------------

/** As `CompanyMember.profileData` already stores it: { Monday: { start: '08:00', end: '17:00' } }. */
export type RepDaySchedule = Record<string, { start?: string; end?: string } | undefined>;

export interface RepRecord {
	id: string;
	userId?: string | null;
	name: string;
	phone: string;
	schedule?: RepDaySchedule | null;
}

export interface RepRotaItem {
	userId: string;
	name: string;
	phone: string;
	rung: number;
}

function hhmmToMinutes(value: string | undefined): number | null {
	if (!value || typeof value !== 'string') return null;
	const [h, m = '0'] = value.split(':');
	const hour = parseInt(h, 10);
	const min = parseInt(m, 10);
	if (Number.isNaN(hour) || Number.isNaN(min)) return null;
	return hour * 60 + min;
}

/** Is this rep rostered on at `at`, per their /representatives schedule? */
export function isRepOnDuty(
	rep: RepRecord,
	at: Date,
	timeZone: string = DEFAULT_BUSINESS_TIME_ZONE
): boolean {
	const schedule = rep.schedule;
	// No schedule saved at all → always available. Every rep predating this feature is in that
	// state, and defaulting them to "never" would silently switch callbacks off for everyone.
	if (!schedule || Object.keys(schedule).length === 0) return true;

	// A rep's shift is their local working day, so it is read in the business's zone too.
	const dayName = at.toLocaleDateString('en-US', { weekday: 'long', timeZone });
	// The edit form stores capitalised day names ('Monday'); tolerate either casing.
	const day = schedule[dayName] ?? schedule[dayName.toLowerCase()];
	if (!day) return false;

	const start = hhmmToMinutes(day.start);
	const end = hhmmToMinutes(day.end);
	// A day left blank in the form is a day off.
	if (start === null || end === null || end <= start) return false;

	const minutes = minutesOfDayIn(at, timeZone);
	return minutes >= start && minutes < end;
}

/**
 * Who to ring, in order, for a callback at `at`.
 *
 * Returns [] when every rep is off duty. The caller decides what that means; this never falls back
 * to ringing someone whose schedule says they are not working.
 */
export function buildRepRota(input: {
	reps: RepRecord[];
	at: Date;
	timeZone?: string;
}): RepRotaItem[] {
	const timeZone = input.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE;
	return input.reps
		.filter((r) => !!r.phone && isRepOnDuty(r, input.at, timeZone))
		.map((r, i) => ({
			userId: r.userId || r.id,
			name: r.name,
			phone: r.phone,
			rung: i + 1
		}));
}

/**
 * What the rep hears when they pick up: who wants the call, what they said, and the keypad
 * contract the webhook already implements (1 bridges, anything else falls to the next rung).
 */
export function callbackWhisperText(input: {
	customerName?: string | null;
	message?: string | null;
	preference: CallbackPreference;
}): string {
	const who = input.customerName?.trim() || 'A customer';
	const when =
		input.preference === 'ASAP' ? 'as soon as possible' : `this ${input.preference.toLowerCase()}`;
	const note = input.message?.trim();
	return (
		`Callback request. ${who} asked for a call back ${when}.` +
		(note ? ` Their message: ${note}.` : '') +
		` Press 1 to accept, press 2 to decline.`
	);
}

/** The after-hours reply when he asked for ASAP and we were shut. */
export function afterHoursAckText(input: {
	openAt: Date | null;
	brand?: string | null;
	timeZone?: string;
}): string {
	const sign = input.brand?.trim() ? ` — ${input.brand.trim()}` : '';
	if (!input.openAt) {
		return `Thanks for your callback request. Our office is closed right now — a representative will call you as soon as we open.${sign}`;
	}
	// Rendered in the business's zone — telling a customer "we open at 2:00 AM" because the server
	// sits in another country is the same class of bug this file's timezone note describes.
	const when = input.openAt.toLocaleString('en-US', {
		weekday: 'long',
		hour: 'numeric',
		minute: '2-digit',
		timeZone: input.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE
	});
	return `Thanks for your callback request. Our office is closed right now — a representative will call you when we open on ${when}.${sign}`;
}
