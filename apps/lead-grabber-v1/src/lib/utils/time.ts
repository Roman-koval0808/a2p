// Time helpers for the custom TimePicker and the rep schedule.
//
// The schedule stores times as 24-hour "HH:MM" strings ('' means "day off"). These helpers are the
// single source of truth for validating and converting that format, so the picker cannot produce a
// value the rest of the app would reject.

export interface TimeParts {
	hour: number;
	minute: number;
}

const TIME24_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True only for a canonical 24-hour "HH:MM" string (00:00–23:59). */
export function isValidTime24(value: string | null | undefined): boolean {
	if (!value || typeof value !== 'string') return false;
	return TIME24_RE.test(value.trim());
}

/** Parse "HH:MM" into parts; null when not a valid time. */
export function parseTime24(value: string | null | undefined): TimeParts | null {
	const v = (value ?? '').trim();
	if (!isValidTime24(v)) return null;
	const [hour, minute] = v.split(':').map(Number);
	return { hour, minute };
}

/** Build "HH:MM" from 12-hour parts. 12 AM → 00:xx, 12 PM → 12:xx. */
export function toTime24(hour12: number, minute: number, period: 'AM' | 'PM'): string {
	let h = hour12 % 12; // 12 → 0
	if (period === 'PM') h += 12;
	return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** "08:00" → "8:00 AM"; null for empty/invalid. */
export function formatTime12(value: string | null | undefined): string | null {
	const p = parseTime24(value);
	if (!p) return null;
	const period = p.hour >= 12 ? 'PM' : 'AM';
	const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
	return `${h12}:${String(p.minute).padStart(2, '0')} ${period}`;
}

/** "8:00 AM" → { hour: 8, minute: 0 }; null when malformed. */
export function parseTime12(value: string | null | undefined): TimeParts | null {
	const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((value ?? '').trim());
	if (!m) return null;
	const hour = parseInt(m[1], 10);
	const minute = parseInt(m[2], 10);
	const period = m[3].toUpperCase();
	if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
	let h = hour;
	if (period === 'AM' && h === 12) h = 0;
	if (period === 'PM' && h !== 12) h += 12;
	return { hour: h, minute };
}

/** "8:00 AM - 6:00 PM" → { start: "08:00", end: "18:00" }; null when malformed or empty. */
export function parseRange12(
	range: string | null | undefined
): { start: string; end: string } | null {
	if (!range) return null;
	const parts = range.split(' - ');
	if (parts.length !== 2) return null;
	const s = parseTime12(parts[0]);
	const e = parseTime12(parts[1]);
	if (!s || !e) return null;
	const pad = (n: number) => String(n).padStart(2, '0');
	return { start: `${pad(s.hour)}:${pad(s.minute)}`, end: `${pad(e.hour)}:${pad(e.minute)}` };
}

/** { start: "08:00", end: "18:00" } → "8:00 AM - 6:00 PM"; "" when either is invalid. */
export function formatRange12(start: string, end: string): string {
	const s = formatTime12(start);
	const e = formatTime12(end);
	if (!s || !e) return '';
	return `${s} - ${e}`;
}

/** Compare two valid "HH:MM" strings; negative when `a` is earlier than `b`. */
export function compareTimes(a: string, b: string): number {
	const pa = parseTime24(a);
	const pb = parseTime24(b);
	if (!pa || !pb) return 0;
	return pa.hour * 60 + pa.minute - (pb.hour * 60 + pb.minute);
}

/**
 * Which days of a schedule are not proper, and therefore must not be saved.
 *
 * A day is valid only as one of two states: fully empty (a day off) or a complete, well-formed
 * range whose end is after its start. Anything else — a malformed time, one bound without the
 * other, or end before/equal start — is flagged.
 */
export function invalidScheduleDays(
	schedule: Record<string, { start?: string; end?: string } | null | undefined>
): string[] {
	const invalid: string[] = [];
	for (const [day, shift] of Object.entries(schedule)) {
		if (!shift) continue;
		const start = (shift.start ?? '').trim();
		const end = (shift.end ?? '').trim();
		if (!start && !end) continue; // day off — valid
		if (!start || !end) {
			invalid.push(day); // incomplete shift
			continue;
		}
		if (!isValidTime24(start) || !isValidTime24(end)) {
			invalid.push(day);
			continue;
		}
		if (compareTimes(start, end) >= 0) invalid.push(day);
	}
	return invalid;
}
