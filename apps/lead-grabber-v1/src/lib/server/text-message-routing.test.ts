import { describe, it, expect } from 'vitest';
import { decideTextMessage, officeClosedReply } from './text-message-routing';
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

const TZ = 'America/Toronto';

/** An instant expressed as a wall-clock time IN THE BUSINESS'S ZONE. */
const at = (y: number, m: number, d: number, h: number, min = 0) =>
	zonedNaiveToUtc(
		`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` +
			`T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`,
		TZ
	);

// 2026-08-17 is a Monday.
const MON_MORNING = at(2026, 8, 17, 9, 30);
const MON_AFTER_HOURS = at(2026, 8, 17, 21, 0);
const SAT = at(2026, 8, 22, 11, 0);

describe('decideTextMessage', () => {
	it('routes to the rep during business hours', () => {
		const d = decideTextMessage({ now: MON_MORNING, businessHours: HOURS, timeZone: TZ });
		expect(d.action).toBe('route_to_rep');
	});

	it('after hours: flags the office-closed reply and gives the next opening', () => {
		const d = decideTextMessage({ now: MON_AFTER_HOURS, businessHours: HOURS, timeZone: TZ });
		expect(d.action).toBe('after_hours');
		if (d.action !== 'after_hours') return;
		expect(d.openAt).not.toBeNull();
		// Next opening is Tuesday 8 AM, local.
		expect(d.openAt!.toISOString()).toBe('2026-08-18T12:00:00.000Z');
	});

	it('on a Saturday, points at Monday morning rather than a closed day', () => {
		const d = decideTextMessage({ now: SAT, businessHours: HOURS, timeZone: TZ });
		expect(d.action).toBe('after_hours');
		if (d.action !== 'after_hours') return;
		const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(
			d.openAt!
		);
		expect(weekday).toBe('Mon');
	});

	it('never returns an opening on an all-closed week', () => {
		const closed = Object.fromEntries(
			Object.keys(HOURS).map((k) => [k, { isOpen: false, hours: null }])
		) as BusinessHoursConfig;
		const d = decideTextMessage({ now: MON_MORNING, businessHours: closed, timeZone: TZ });
		expect(d.action).toBe('after_hours');
		if (d.action !== 'after_hours') return;
		expect(d.openAt).toBeNull();
	});

	it('the business zone decides, never the server zone', () => {
		// 2026-08-17 21:31 UTC = 17:31 Toronto (open) = 23:31 Berlin (shut).
		const theMoment = new Date('2026-08-17T21:31:00Z');
		expect(decideTextMessage({ now: theMoment, businessHours: HOURS, timeZone: 'America/Toronto' }).action).toBe(
			'route_to_rep'
		);
		expect(decideTextMessage({ now: theMoment, businessHours: HOURS, timeZone: 'Europe/Berlin' }).action).toBe(
			'after_hours'
		);
	});
});

describe('officeClosedReply', () => {
	it('substitutes {date} with the next opening, in the business zone', () => {
		const reply = officeClosedReply({
			template: 'We are closed and will get back to you by {date}.',
			openAt: at(2026, 8, 18, 8, 0),
			timeZone: TZ
		});
		expect(reply).toContain('Tuesday');
		expect(reply).not.toContain('{date}');
	});

	it('keeps a template with no placeholder as-is', () => {
		expect(
			officeClosedReply({ template: 'The office is closed.', openAt: at(2026, 8, 18, 8, 0), timeZone: TZ })
		).toBe('The office is closed.');
	});

	it('degrades to a generic promise when no opening could be worked out', () => {
		expect(officeClosedReply({ template: 'We will reply by {date}.', openAt: null, timeZone: TZ })).toBe(
			'We will reply by the next business day.'
		);
	});

	it('falls back to a sensible message when the admin never configured one', () => {
		expect(officeClosedReply({ openAt: null })).toContain('office is closed');
	});
});
