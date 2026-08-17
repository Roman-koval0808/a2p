import { describe, it, expect } from 'vitest';
import {
	parseCallbackPreference,
	decideCallback,
	nextWindowStart,
	nextOpening,
	windowAt,
	isRepOnDuty,
	buildRepRota,
	callbackWhisperText,
	afterHoursAckText,
	DEFAULT_MIDDAY_HOUR
} from './callback-routing';
import type { BusinessHoursConfig } from '$lib/utils/auto-reply';

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

// Local-time constructor — every comparison in callback-routing is local-clock.
const at = (y: number, m: number, d: number, h: number, min = 0) =>
	new Date(y, m - 1, d, h, min, 0, 0);

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
			decideCallback({ preference: 'ASAP', now: MON_MORNING, businessHours: HOURS, config }).action
		).toBe('bridge_now');
	});

	it('after hours: books the next opening and flags the customer auto-reply', () => {
		const d = decideCallback({
			preference: 'ASAP',
			now: MON_AFTER_HOURS,
			businessHours: HOURS,
			config
		});
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(d.afterHours).toBe(true);
		expect(d.callAt.getDay()).toBe(2); // Tuesday
		expect(d.callAt.getHours()).toBe(8);
	});

	it('on a Saturday, books Monday morning rather than a closed day', () => {
		const d = decideCallback({ preference: 'ASAP', now: SAT, businessHours: HOURS, config });
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(d.callAt.getDay()).toBe(1);
		expect(d.afterHours).toBe(true);
	});

	it('asks for a human rather than inventing a time when every day is closed', () => {
		const closed = Object.fromEntries(
			Object.keys(HOURS).map((k) => [k, { isOpen: false, hours: null }])
		) as BusinessHoursConfig;
		expect(
			decideCallback({ preference: 'ASAP', now: MON_MORNING, businessHours: closed, config }).action
		).toBe('manual');
	});
});

describe('the three stated Morning/Afternoon cases', () => {
	it('morning + asks for morning → next day, morning', () => {
		const d = decideCallback({
			preference: 'MORNING',
			now: MON_MORNING,
			businessHours: HOURS,
			config
		});
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(d.callAt.getDate()).toBe(18);
		expect(d.callAt.getHours()).toBe(8);
	});

	it('morning + asks for afternoon → that same afternoon', () => {
		const d = decideCallback({
			preference: 'AFTERNOON',
			now: MON_MORNING,
			businessHours: HOURS,
			config
		});
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(d.callAt.getDate()).toBe(17);
		expect(d.callAt.getHours()).toBe(12);
	});

	it('afternoon + asks for afternoon → next day, afternoon', () => {
		const d = decideCallback({
			preference: 'AFTERNOON',
			now: MON_AFTERNOON,
			businessHours: HOURS,
			config
		});
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(d.callAt.getDate()).toBe(18);
		expect(d.callAt.getHours()).toBe(12);
	});

	it('afternoon + asks for morning → next morning (the case nobody stated)', () => {
		const d = decideCallback({
			preference: 'MORNING',
			now: MON_AFTERNOON,
			businessHours: HOURS,
			config
		});
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(d.callAt.getDate()).toBe(18);
		expect(d.callAt.getHours()).toBe(8);
	});

	it('a named window never counts as after-hours, so no "we are closed" reply goes out', () => {
		const d = decideCallback({
			preference: 'MORNING',
			now: MON_AFTER_HOURS,
			businessHours: HOURS,
			config
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
			config
		});
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(d.callAt.getDay()).toBe(1);
		expect(d.callAt.getDate()).toBe(24);
	});

	it('before opening, asking for morning keeps it today — we are not inside it yet', () => {
		const start = nextWindowStart(at(2026, 8, 17, 6, 0), 'MORNING', HOURS, config);
		expect(start?.getDate()).toBe(17);
		expect(start?.getHours()).toBe(8);
	});
});

describe('window boundaries', () => {
	it('classifies either side of midday', () => {
		expect(windowAt(at(2026, 8, 17, 11, 59), HOURS, config)).toBe('MORNING');
		expect(windowAt(at(2026, 8, 17, 12, 0), HOURS, config)).toBe('AFTERNOON');
	});

	it('is null outside opening hours and on closed days', () => {
		expect(windowAt(at(2026, 8, 17, 7, 0), HOURS, config)).toBeNull();
		expect(windowAt(at(2026, 8, 17, 18, 0), HOURS, config)).toBeNull();
		expect(windowAt(SAT, HOURS, config)).toBeNull();
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
			config
		});
		expect(d.action).toBe('schedule');
		if (d.action !== 'schedule') return;
		expect(d.callAt.getDay()).toBe(1); // rolls past Friday to Monday
	});

	it('nextOpening returns now when we are already open', () => {
		expect(nextOpening(MON_MORNING, HOURS)?.getTime()).toBe(MON_MORNING.getTime());
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
		const rota = buildRepRota({ reps: [joe, ann], at: MON_AFTERNOON });
		expect(rota.map((r) => r.name)).toEqual(['Joe Sales', 'Ann Backup']);
		expect(rota.map((r) => r.rung)).toEqual([1, 2]);
	});

	it('filters out a rep whose shift has not started', () => {
		expect(buildRepRota({ reps: [joe, ann], at: MON_MORNING }).map((r) => r.name)).toEqual([
			'Joe Sales'
		]);
	});

	it('treats a rep with no saved schedule as always available', () => {
		const noSchedule = { id: 'm3', name: 'Unset', phone: '+1555', schedule: {} };
		expect(isRepOnDuty(noSchedule, SAT)).toBe(true);
		expect(isRepOnDuty({ id: 'm4', name: 'Null', phone: '+1555' }, SAT)).toBe(true);
	});

	it('treats a day left blank in the form as a day off', () => {
		const weekdaysOnly = {
			id: 'm5',
			name: 'Weekdays',
			phone: '+1555',
			schedule: { Monday: { start: '08:00', end: '17:00' }, Saturday: { start: '', end: '' } }
		};
		expect(isRepOnDuty(weekdaysOnly, MON_MORNING)).toBe(true);
		expect(isRepOnDuty(weekdaysOnly, SAT)).toBe(false);
	});

	it('tolerates lowercase day keys', () => {
		const lower = {
			id: 'm6',
			name: 'Lower',
			phone: '+1555',
			schedule: { monday: { start: '08:00', end: '17:00' } }
		};
		expect(isRepOnDuty(lower, MON_MORNING)).toBe(true);
	});

	it('returns nobody rather than ringing an off-duty rep — the caller decides', () => {
		expect(buildRepRota({ reps: [joe, ann], at: SAT })).toEqual([]);
	});

	it('skips reps with no phone number', () => {
		const noPhone = { id: 'm7', name: 'No Phone', phone: '' };
		expect(buildRepRota({ reps: [noPhone], at: MON_MORNING })).toEqual([]);
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
		const text = afterHoursAckText({ openAt: at(2026, 8, 18, 8, 0), brand: 'Total Trades' });
		expect(text).toMatch(/Tuesday/);
		expect(text).toContain('Total Trades');
	});

	it('degrades to a generic promise when no opening could be worked out', () => {
		expect(afterHoursAckText({ openAt: null })).toContain('as soon as we open');
	});
});
