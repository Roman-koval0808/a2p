import { describe, it, expect } from 'vitest';
import { decideRouting, isOffHours } from './emergency-routing';
import { extractCallbackNumber } from '$lib/utils/phone';
import { looksLikeActiveEmergency } from './message-intent';

// These exercise the exact functions process_orchestrator now calls (decideRouting / isOffHours),
// plus the callback-number extractor, so the three documented George scenarios are pinned down.
//
// Business hours in the fallback: Mon–Fri 09:00–17:00 (in the clock of the Date passed in).

describe('isOffHours (fallback office-hours test)', () => {
	// Fixed EST-labelled local times (tests run in the CI clock; these are constructed as local).
	const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h, 0, 0);

	it('is OPEN at 10:30 on a Tuesday', () => {
		expect(isOffHours(at(2026, 7, 21, 10))).toBe(false); // Tue 10:00
	});
	it('is OFF-hours at 03:00 on a Tuesday', () => {
		expect(isOffHours(at(2026, 7, 21, 3))).toBe(true); // Tue 03:00
	});
	it('is OFF-hours at 02:00 (George’s emergency hour)', () => {
		expect(isOffHours(at(2026, 7, 21, 2))).toBe(true);
	});
	it('treats 09:00 as OPEN and 17:00 as CLOSED (boundaries)', () => {
		expect(isOffHours(at(2026, 7, 21, 9))).toBe(false); // exactly open
		expect(isOffHours(at(2026, 7, 21, 17))).toBe(true); // exactly close
		expect(isOffHours(at(2026, 7, 21, 16))).toBe(false); // 16:59-ish still open
	});
	it('is always OFF-hours on the weekend, even mid-day', () => {
		// 2026-07-25 is a Saturday, 2026-07-26 a Sunday, 2026-07-24 a Friday.
		expect(isOffHours(at(2026, 7, 24, 12))).toBe(false); // Fri noon — open
		expect(isOffHours(at(2026, 7, 25, 12))).toBe(true); // Sat noon — closed
		expect(isOffHours(at(2026, 7, 26, 12))).toBe(true); // Sun noon — closed
	});
	it('honours custom open/close hours', () => {
		expect(isOffHours(at(2026, 7, 21, 8), { openHour: 8, closeHour: 20 })).toBe(false);
		expect(isOffHours(at(2026, 7, 21, 19), { openHour: 8, closeHour: 20 })).toBe(false);
		expect(isOffHours(at(2026, 7, 21, 20), { openHour: 8, closeHour: 20 })).toBe(true);
	});
});

describe('decideRouting — the three George scenarios', () => {
	it('CASE 1 — emergency at 2 AM: dispatch tech + SLA, NO customer draft', () => {
		const d = decideRouting({ messageCategory: 'emergency', isOffHours: true });
		expect(d).toEqual({
			dispatchToTech: true,
			draftCustomerReply: false,
			deferred: false,
			startSlaClock: true
		});
	});

	it('CASE 1b — emergency during working hours still dispatches, still no draft', () => {
		const d = decideRouting({ messageCategory: 'emergency', isOffHours: false });
		expect(d.dispatchToTech).toBe(true);
		expect(d.startSlaClock).toBe(true);
		expect(d.draftCustomerReply).toBe(false); // never a "Confirm" card for an emergency
	});

	it('CASE 2 — non-emergency at 3 AM: DEFERRED customer draft, tech NOT texted', () => {
		const d = decideRouting({ messageCategory: 'sales', isOffHours: true });
		expect(d).toEqual({
			dispatchToTech: false,
			draftCustomerReply: true,
			deferred: true,
			startSlaClock: false
		});
	});

	it('CASE 3 — non-emergency at 10:30 AM: live customer draft, tech NOT texted', () => {
		const d = decideRouting({ messageCategory: 'support', isOffHours: false });
		expect(d).toEqual({
			dispatchToTech: false,
			draftCustomerReply: true,
			deferred: false,
			startSlaClock: false
		});
	});

	it('never texts the tech for billing/sales/support at any hour', () => {
		for (const cat of ['billing', 'sales', 'support'] as const) {
			for (const off of [true, false]) {
				expect(decideRouting({ messageCategory: cat, isOffHours: off }).dispatchToTech).toBe(false);
			}
		}
	});
});

describe('extractCallbackNumber — the number George leaves', () => {
	it('extracts the spoken number from the burst-pipe voicemail', () => {
		const transcript =
			"Yes, I'm calling Total Trades. I'm looking for a plumber to fix my busted pipe. " +
			"It's an emergency, it's two in the morning. Give me a call, you've got my number, " +
			'705-264-2251. Thank you.';
		expect(extractCallbackNumber(transcript)).toBe('+17052642251');
	});

	it('handles parenthesised, dotted and +1-prefixed forms', () => {
		expect(extractCallbackNumber('call me at (416) 555-0134')).toBe('+14165550134');
		expect(extractCallbackNumber('my cell is 705.264.2251')).toBe('+17052642251');
		expect(extractCallbackNumber('reach me on +1 705 998 5691')).toBe('+17059985691');
	});

	it('returns the LAST number stated (people correct themselves)', () => {
		expect(extractCallbackNumber('old line 705-111-2222, new one 705-333-4444')).toBe(
			'+17053334444'
		);
	});

	it('returns null when no number is present (fall back to their calling line)', () => {
		expect(extractCallbackNumber('please call me back as soon as you can')).toBeNull();
		expect(extractCallbackNumber('')).toBeNull();
		expect(extractCallbackNumber(null)).toBeNull();
	});
});

describe('looksLikeActiveEmergency — deterministic backstop', () => {
	it('catches active emergencies the AI mis-routed as booking/support', () => {
		// Brahma's real transcript — was classified Support/booking, missed the emergency path.
		expect(
			looksLikeActiveEmergency(
				'My roof is leaking after the repair, water is coming into my kitchen, call me right away'
			)
		).toBe(true);
		expect(
			looksLikeActiveEmergency('My basement pipe is pushing water all over the basement')
		).toBe(true);
		expect(looksLikeActiveEmergency('my pipe just burst and there is water everywhere')).toBe(true);
		expect(looksLikeActiveEmergency('I smell gas in the basement')).toBe(true);
		expect(looksLikeActiveEmergency('the sewer is backing up into my tub')).toBe(true);
	});

	it('does NOT trip on non-emergencies (avoids paging the tech for routine work)', () => {
		expect(looksLikeActiveEmergency('can someone come look at my water heater, it is making noise')).toBe(false);
		expect(looksLikeActiveEmergency('I want a quote for a water heater replacement next week')).toBe(false);
		expect(looksLikeActiveEmergency('you fixed my leak last month, just following up')).toBe(false);
		expect(looksLikeActiveEmergency('I want to book an appointment for Monday')).toBe(false);
		expect(looksLikeActiveEmergency('')).toBe(false);
		expect(looksLikeActiveEmergency(null)).toBe(false);
	});
});
