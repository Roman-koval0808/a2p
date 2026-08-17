import { describe, it, expect } from 'vitest';
import {
	parseCallbackPreference,
	decideCallback,
	nextWindowStart,
	nextOpening,
	isOpenAt,
	windowAt,
	isRepOnDuty,
	buildRepRota,
	callbackWhisperText,
	afterHoursAckText,
	DEFAULT_MIDDAY_HOUR
} from './callback-routing';
import type { BusinessHoursConfig } from '$lib/utils/auto-reply';
import { zonedNaiveToUtc } from './datetime';

// Mon–Fri 8:00–18:00, weekend closed — the default the auto-replies screen ships with.
const HOURS: BusinessHoursConfig = {
	sunday: { isOpen: false, hours: null },
	monday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
	tuesday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
	wednesday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
	thursday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
	friday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
	saturday: { isOpen: false, hours: null }
};

const config = { middayHour: DEFAULT_MIDDAY_HOUR };

// The BUSINESS's zone. Deliberately not the server's: these tests must pass on a CI box in any
// region, and the production bug this guards against was a +02:00 host serving a Toronto business.
const TZ = 'America/Toronto';

/** An instant expressed as a wall-clock time IN THE BUSINESS'S ZONE. */
const at = (y: number, m: number, d: number, h: number, min = 0) =>
	zonedNaiveToUtc(
		`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` +
			`T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`,
		TZ
	);

/** Read an instant back as business-zone wall-clock, for assertions. */
const wall = (d: Date) => ({
	day: +new Intl.DateTimeFormat('en-US', { timeZone: TZ, day: 'numeric' }).format(d),
	hour: +new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false })
		.format(d)
		.replace('24', '0'),
	weekday: new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d)
});

// 2026-08-17 is a Monday.
const MON_MORNING = at(2026, 8, 17, 9, 30);
const MON_AFTERNOON = at(2026, 8, 17, 14, 0);
const MON_AFTER_HOURS = at(2026, 8, 17, 21, 0);
const FRI_AFTERNOON = at(2026, 8, 21, 15, 0);
const SAT = at(2026, 8, 22, 11, 0);

describe('parseCallbackPreference', () => {
	it('reads the three choices out of the widget message', () => {
		expect(parseCallbackPreference('Requested Call back. Preferred Time: ASAP')).toBe('ASAP');
		expect(parseCallbackPreference('Requested Call back. Preferred Time: Morning')).toBe('MORNING');
		expect(parseCallbackPreference('Requested Call back. Preferred Time: Afternoon')).toBe(
			'AFTERNOON'
		);
	});

	it('is not a callback request when the text never says so', () => {
		expect(parseCallbackPreference('Do you service heat pumps?')).toBeNull();
		expect(parseCallbackPreference('')).toBeNull();
		expect(parseCallbackPreference(null)).toBeNull();
	});

	it('prefers a named window over a stray "as soon as"', () => {
		expect(parseCallbackPreference('Call me back as soon as you can, afternoon is best')).toBe(
			'AFTERNOON'
		);
	});

	it('defaults a callback request with no stated window to ASAP', () => {
		expect(parseCallbackPreference('Call me back please')).toBe('ASAP');
	});
});

describe('ASAP', () => {
	it('bridges immediately during business hours', () => {
		expect(
			decideCallback({ preference: 'ASAP', now: MON_MORNING, businessHours: HOURS, config, timeZone: TZ }).action
		).toBe('bridge_now');
	});

	it('after hours: books the next opening and flags the customer auto-reply', () => {
		const d = decideCallback({
			preference: 'ASAP',
			now: MON_AFTER_HOURS,
			businessHours: HOURS,
			config,
			timeZone: TZ
		});
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(d.afterHours).toBe(true);
		expect(wall(d.callAt).weekday).toBe('Tue');
		expect(wall(d.callAt).hour).toBe(8);
	});

	it('on a Saturday, books Monday morning rather than a closed day', () => {
		const d = decideCallback({ preference: 'ASAP', now: SAT, businessHours: HOURS, config, timeZone: TZ });
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(wall(d.callAt).weekday).toBe('Mon');
		expect(d.afterHours).toBe(true);
	});

	it('asks for a human rather than inventing a time when every day is closed', () => {
		const closed = Object.fromEntries(
			Object.keys(HOURS).map((k) => [k, { isOpen: false, hours: null }])
		) as BusinessHoursConfig;
		expect(
			decideCallback({ preference: 'ASAP', now: MON_MORNING, businessHours: closed, config, timeZone: TZ }).action
		).toBe('manual');
	});
});

describe('the three stated Morning/Afternoon cases', () => {
	it('morning + asks for morning → next day, morning', () => {
		const d = decideCallback({
			preference: 'MORNING',
			now: MON_MORNING,
			businessHours: HOURS,
			config,
			timeZone: TZ
		});
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(wall(d.callAt).day).toBe(18);
		expect(wall(d.callAt).hour).toBe(8);
	});

	it('morning + asks for afternoon → that same afternoon', () => {
		const d = decideCallback({
			preference: 'AFTERNOON',
			now: MON_MORNING,
			businessHours: HOURS,
			config,
			timeZone: TZ
		});
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(wall(d.callAt).day).toBe(17);
		expect(wall(d.callAt).hour).toBe(12);
	});

	it('afternoon + asks for afternoon → next day, afternoon', () => {
		const d = decideCallback({
			preference: 'AFTERNOON',
			now: MON_AFTERNOON,
			businessHours: HOURS,
			config,
			timeZone: TZ
		});
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(wall(d.callAt).day).toBe(18);
		expect(wall(d.callAt).hour).toBe(12);
	});

	it('afternoon + asks for morning → next morning (the case nobody stated)', () => {
		const d = decideCallback({
			preference: 'MORNING',
			now: MON_AFTERNOON,
			businessHours: HOURS,
			config,
			timeZone: TZ
		});
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(wall(d.callAt).day).toBe(18);
		expect(wall(d.callAt).hour).toBe(8);
	});

	it('a named window never counts as after-hours, so no "we are closed" reply goes out', () => {
		const d = decideCallback({
			preference: 'MORNING',
			now: MON_AFTER_HOURS,
			businessHours: HOURS,
			config,
			timeZone: TZ
		});
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(d.afterHours).toBe(false);
	});

	it('skips the weekend: Friday afternoon asking for afternoon lands on Monday', () => {
		const d = decideCallback({
			preference: 'AFTERNOON',
			now: FRI_AFTERNOON,
			businessHours: HOURS,
			config,
			timeZone: TZ
		});
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(wall(d.callAt).weekday).toBe('Mon');
		expect(wall(d.callAt).day).toBe(24);
	});

	it('before opening, asking for morning keeps it today — we are not inside it yet', () => {
		const start = nextWindowStart(at(2026, 8, 17, 6, 0), 'MORNING', HOURS, config, TZ);
		expect(wall(start!).day).toBe(17);
		expect(wall(start!).hour).toBe(8);
	});
});

describe('window boundaries', () => {
	it('classifies either side of midday', () => {
		expect(windowAt(at(2026, 8, 17, 11, 59), HOURS, config, TZ)).toBe('MORNING');
		expect(windowAt(at(2026, 8, 17, 12, 0), HOURS, config, TZ)).toBe('AFTERNOON');
	});

	it('is null outside opening hours and on closed days', () => {
		expect(windowAt(at(2026, 8, 17, 7, 0), HOURS, config, TZ)).toBeNull();
		expect(windowAt(at(2026, 8, 17, 18, 0), HOURS, config, TZ)).toBeNull();
		expect(windowAt(SAT, HOURS, config, TZ)).toBeNull();
	});

	it('a day that shuts before midday has no afternoon slot', () => {
		const shortFriday: BusinessHoursConfig = {
			...HOURS,
			friday: { isOpen: true, hours: '8:00 AM - 11:00 AM' }
		};
		const d = decideCallback({
			preference: 'AFTERNOON',
			now: at(2026, 8, 20, 15, 0), // Thursday afternoon
			businessHours: shortFriday,
			config,
			timeZone: TZ
		});
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(wall(d.callAt).weekday).toBe('Mon'); // rolls past Friday to Monday
	});

	it('nextOpening returns now when we are already open', () => {
		expect(nextOpening(MON_MORNING, HOURS, TZ)?.getTime()).toBe(MON_MORNING.getTime());
	});
});

describe('rep rota, from the /representatives schedules', () => {
	const joe = {
		id: 'm1',
		name: 'Joe Sales',
		phone: '+15550000001',
		schedule: {
			Monday: { start: '08:00', end: '17:00' },
			Tuesday: { start: '08:00', end: '17:00' }
		}
	};
	const ann = {
		id: 'm2',
		name: 'Ann Backup',
		phone: '+15550000002',
		schedule: { Monday: { start: '12:00', end: '20:00' } }
	};

	it('rings on-duty reps in list order, as rungs for the dial ladder', () => {
		const rota = buildRepRota({ reps: [joe, ann], at: MON_AFTERNOON, timeZone: TZ });
		expect(rota.map((r) => r.name)).toEqual(['Joe Sales', 'Ann Backup']);
		expect(rota.map((r) => r.rung)).toEqual([1, 2]);
	});

	it('filters out a rep whose shift has not started', () => {
		expect(buildRepRota({ reps: [joe, ann], at: MON_MORNING, timeZone: TZ }).map((r) => r.name)).toEqual([
			'Joe Sales'
		]);
	});

	it('treats a rep with no saved schedule as always available', () => {
		const noSchedule = { id: 'm3', name: 'Unset', phone: '+1555', schedule: {} };
		expect(isRepOnDuty(noSchedule, SAT, TZ)).toBe(true);
		expect(isRepOnDuty({ id: 'm4', name: 'Null', phone: '+1555' }, SAT, TZ)).toBe(true);
	});

	it('treats a day left blank in the form as a day off', () => {
		const weekdaysOnly = {
			id: 'm5',
			name: 'Weekdays',
			phone: '+1555',
			schedule: { Monday: { start: '08:00', end: '17:00' }, Saturday: { start: '', end: '' } }
		};
		expect(isRepOnDuty(weekdaysOnly, MON_MORNING, TZ)).toBe(true);
		expect(isRepOnDuty(weekdaysOnly, SAT, TZ)).toBe(false);
	});

	it('tolerates lowercase day keys', () => {
		const lower = {
			id: 'm6',
			name: 'Lower',
			phone: '+1555',
			schedule: { monday: { start: '08:00', end: '17:00' } }
		};
		expect(isRepOnDuty(lower, MON_MORNING, TZ)).toBe(true);
	});

	it('returns nobody rather than ringing an off-duty rep — the caller decides', () => {
		expect(buildRepRota({ reps: [joe, ann], at: SAT, timeZone: TZ })).toEqual([]);
	});

	it('skips reps with no phone number', () => {
		const noPhone = { id: 'm7', name: 'No Phone', phone: '' };
		expect(buildRepRota({ reps: [noPhone], at: MON_MORNING, timeZone: TZ })).toEqual([]);
	});
});

describe('what the rep and the customer hear', () => {
	it('reads the message out and states the keypad contract', () => {
		const text = callbackWhisperText({
			customerName: 'Robert Betts',
			message: 'Requested Call back. Preferred Time: ASAP',
			preference: 'ASAP'
		});
		expect(text).toContain('Robert Betts');
		expect(text).toContain('as soon as possible');
		expect(text).toContain('Requested Call back');
		expect(text).toContain('Press 1 to accept, press 2 to decline.');
	});

	it('still works with no name and no message', () => {
		const text = callbackWhisperText({ preference: 'MORNING' });
		expect(text).toContain('A customer');
		expect(text).toContain('Press 1 to accept');
	});

	it('tells the customer when we open', () => {
		const text = afterHoursAckText({ openAt: at(2026, 8, 18, 8, 0), brand: 'Total Trades', timeZone: TZ });
		expect(text).toMatch(/Tuesday/);
		expect(text).toContain('Total Trades');
	});

	it('degrades to a generic promise when no opening could be worked out', () => {
		expect(afterHoursAckText({ openAt: null })).toContain('as soon as we open');
	});
});

// ---------------------------------------------------------------------------
// The production bug, 2026-08-17
// ---------------------------------------------------------------------------
//
// The host runs at +02:00; the business is America/Toronto. A real ASAP request at 23:31 +02:00
// was 17:31 in Toronto — inside 8:00–18:00, so it should have BRIDGED. Reading the server clock
// instead sent it to the after-hours branch and booked 08:00 server time, which is 02:00 Toronto.
// The rep would have been rung in the middle of the night.
//
// Same failure the calendar code already carries a regression note for ("a customer was offered a
// 'Monday at 3:00 AM' furnace slot" — calendar.test.ts).
describe('the business zone decides, never the server zone', () => {
	// 2026-08-17 21:31 UTC = 23:31 in Berlin (+02:00) = 17:31 in Toronto (-04:00).
	const THE_MOMENT = new Date('2026-08-17T21:31:00Z');

	it('is OPEN in Toronto at that instant, even though the server clock reads 23:31', () => {
		expect(isOpenAt(THE_MOMENT, HOURS, 'America/Toronto')).toBe(true);
		expect(isOpenAt(THE_MOMENT, HOURS, 'Europe/Berlin')).toBe(false);
	});

	it('bridges instead of scheduling — the actual production defect', () => {
		const d = decideCallback({
			preference: 'ASAP',
			now: THE_MOMENT,
			businessHours: HOURS,
			config,
			timeZone: 'America/Toronto'
		});
		expect(d.action).toBe('bridge_now');
	});

	it('never books a slot in the middle of the business night', () => {
		// Genuinely after hours in Toronto: 03:00 UTC = 23:00 the previous evening.
		const lateInToronto = new Date('2026-08-18T03:00:00Z');
		const d = decideCallback({
			preference: 'ASAP',
			now: lateInToronto,
			businessHours: HOURS,
			config,
			timeZone: 'America/Toronto'
		});
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(wall(d.callAt).hour).toBe(8); // 8 AM in Toronto, not 8 AM on the server
		expect(d.callAt.toISOString()).toBe('2026-08-18T12:00:00.000Z');
	});

	it('the same instant yields different, each-correct answers per business zone', () => {
		const vancouver = decideCallback({
			preference: 'ASAP',
			now: THE_MOMENT, // 14:31 in Vancouver — open
			businessHours: HOURS,
			config,
			timeZone: 'America/Vancouver'
		});
		const berlin = decideCallback({
			preference: 'ASAP',
			now: THE_MOMENT, // 23:31 in Berlin — shut
			businessHours: HOURS,
			config,
			timeZone: 'Europe/Berlin'
		});
		expect(vancouver.action).toBe('bridge_now');
		expect(berlin.action).toBe('schedule');
	});

	it('a rep shift is read in the business zone too', () => {
		const carter = {
			id: 'm1',
			name: 'Carter Adams',
			phone: '+18046082154',
			schedule: { Monday: { start: '08:00', end: '18:00' } }
		};
		// 17:31 Monday in Toronto — on duty. 23:31 Monday in Berlin — off.
		expect(isRepOnDuty(carter, THE_MOMENT, 'America/Toronto')).toBe(true);
		expect(isRepOnDuty(carter, THE_MOMENT, 'Europe/Berlin')).toBe(false);
	});

	it('survives a DST transition without skipping or repeating a day', () => {
		// US DST ends Sun 2026-11-01. Friday before → Monday after, asking for the morning.
		const friAfternoon = zonedNaiveToUtc('2026-10-30T15:00:00', TZ);
		const d = decideCallback({
			preference: 'MORNING',
			now: friAfternoon,
			businessHours: HOURS,
			config,
			timeZone: TZ
		});
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(wall(d.callAt).weekday).toBe('Mon');
		expect(wall(d.callAt).day).toBe(2); // Nov 2
		expect(wall(d.callAt).hour).toBe(8); // still 8 AM local, not 7 or 9
	});
});
