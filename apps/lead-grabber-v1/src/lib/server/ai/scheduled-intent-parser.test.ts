import { describe, it, expect } from 'vitest';
import {
	normalizeExtraction,
	resolveCalculatedTargetDate,
	daysFromRawTimeframe,
	isSchedulable,
	isVagueTimeframe,
	resolveActorFromText,
	type ScheduledIntentRaw
} from './scheduled-intent-parser';

/** Ray's email, 4 Aug 2026 09:00 local. The case this module exists for. */
const RAY_REFERENCE = new Date('2026-08-04T13:00:00Z');

const ray: ScheduledIntentRaw = {
	hasFutureIntent: true,
	whatHeWants: 'air conditioning',
	rawTimeframe: 'a couple of weeks',
	timeframeDays: 14,
	exactDateIso: null,
	confidence: 'HIGH',
	actor: 'CUSTOMER',
	preferredChannel: null
};

describe('resolveCalculatedTargetDate', () => {
	it('adds the window to the message timestamp ("a couple of weeks" = 14 days)', () => {
		expect(resolveCalculatedTargetDate({ reference: RAY_REFERENCE, ...ray })).toBe(
			'2026-08-18T13:00:00.000Z'
		);
	});

	it('resolves a named weekday from the reference date', () => {
		// Wed 5 Aug 2026 → next Tuesday is 11 Aug.
		const ref = new Date('2026-08-05T12:00:00Z');
		expect(
			resolveCalculatedTargetDate({
				reference: ref,
				rawTimeframe: 'next Tuesday',
				timeframeDays: null,
				exactDateIso: null
			})
		).toBe('2026-08-11T14:00:00.000Z');
	});

	it('"next Tuesday" is never the same day', () => {
		// Tue 4 Aug 2026 → next Tuesday is 11 Aug, not today.
		const ref = new Date('2026-08-04T12:00:00Z');
		const out = resolveCalculatedTargetDate({
			reference: ref,
			rawTimeframe: 'next Tuesday',
			timeframeDays: null,
			exactDateIso: null
		});
		expect(out).toBe('2026-08-11T14:00:00.000Z');
	});

	it('prefers an exact named date over the window', () => {
		expect(
			resolveCalculatedTargetDate({
				reference: RAY_REFERENCE,
				rawTimeframe: 'August 18th',
				timeframeDays: null,
				exactDateIso: '2026-08-18T14:00:00.000Z'
			})
		).toBe('2026-08-18T14:00:00.000Z');
	});

	it('returns null when nothing resolvable — the not-confident path', () => {
		expect(
			resolveCalculatedTargetDate({
				reference: RAY_REFERENCE,
				rawTimeframe: 'sometime',
				timeframeDays: null,
				exactDateIso: null
			})
		).toBeNull();
	});
});

describe('daysFromRawTimeframe', () => {
	it('reads the common windows', () => {
		expect(daysFromRawTimeframe('a couple of weeks')).toBe(14);
		expect(daysFromRawTimeframe('next week')).toBe(7);
		expect(daysFromRawTimeframe('a few days')).toBe(3);
		expect(daysFromRawTimeframe('next month')).toBe(30);
		expect(daysFromRawTimeframe('tomorrow')).toBe(1);
	});

	it('longest match wins — "a couple of weeks" is not "a week"', () => {
		expect(daysFromRawTimeframe('a couple of weeks')).not.toBe(7);
	});

	it('parses an explicit count', () => {
		expect(daysFromRawTimeframe('in 10 days')).toBe(10);
		expect(daysFromRawTimeframe('3 weeks or so')).toBe(21);
	});

	it('returns null for vague phrases', () => {
		expect(daysFromRawTimeframe('sometime')).toBeNull();
		expect(daysFromRawTimeframe('in the spring')).toBeNull();
		expect(daysFromRawTimeframe(null)).toBeNull();
	});
});

describe('normalizeExtraction — the Ray walkthrough', () => {
	it("I'll call you back in a couple of weeks → CUSTOMER, 14 days out, schedulable", () => {
		const out = normalizeExtraction(ray, { reference: RAY_REFERENCE });
		expect(out.actor).toBe('CUSTOMER');
		expect(out.calculatedTargetDate).toBe('2026-08-18T13:00:00.000Z');
		expect(out.schedulable).toBe(true);
	});

	it('"Call me next Tuesday" → BUSINESS, schedulable', () => {
		const out = normalizeExtraction(
			{
				hasFutureIntent: true,
				whatHeWants: 'a quote for the furnace',
				rawTimeframe: 'next Tuesday',
				timeframeDays: null,
				exactDateIso: null,
				confidence: 'HIGH',
				actor: 'BUSINESS',
				preferredChannel: 'call'
			},
			{ reference: new Date('2026-08-05T12:00:00Z') }
		);
		expect(out.actor).toBe('BUSINESS');
		expect(out.calculatedTargetDate).toBe('2026-08-11T14:00:00.000Z');
		expect(out.schedulable).toBe(true);
	});

	it('"Maybe sometime in the spring" → LOW, not auto-schedulable (Marcus path)', () => {
		const out = normalizeExtraction(
			{
				hasFutureIntent: true,
				whatHeWants: 'a new furnace',
				rawTimeframe: 'sometime in the spring',
				timeframeDays: null,
				exactDateIso: null,
				confidence: 'LOW',
				actor: null,
				preferredChannel: null
			},
			{ reference: RAY_REFERENCE }
		);
		expect(out.calculatedTargetDate).toBeNull();
		expect(out.schedulable).toBe(false);
	});

	it('no future intent → never schedulable', () => {
		const out = normalizeExtraction(
			{
				hasFutureIntent: false,
				whatHeWants: '',
				rawTimeframe: null,
				timeframeDays: null,
				exactDateIso: null,
				confidence: 'HIGH',
				actor: null,
				preferredChannel: null
			},
			{ reference: RAY_REFERENCE }
		);
		expect(out.schedulable).toBe(false);
	});

	it('backstops the actor from the message text when the model could not tell', () => {
		const out = normalizeExtraction(
			{ ...ray, actor: null },
			{ reference: RAY_REFERENCE, messageText: "I'll give you a call when I'm back" }
		);
		expect(out.actor).toBe('CUSTOMER');
	});
});

describe('isVagueTimeframe', () => {
	it('flags season and "sometime" phrasing', () => {
		expect(isVagueTimeframe('in the spring')).toBe(true);
		expect(isVagueTimeframe('sometime')).toBe(true);
		expect(isVagueTimeframe('eventually')).toBe(true);
	});

	it('does not flag real windows', () => {
		expect(isVagueTimeframe('a couple of weeks')).toBe(false);
		expect(isVagueTimeframe('next Tuesday')).toBe(false);
		expect(isVagueTimeframe(null)).toBe(false);
	});
});

describe('resolveActorFromText', () => {
	it('customer acts: "I\'ll call you when I get back"', () => {
		expect(resolveActorFromText("I'll call you when I get back")).toBe('CUSTOMER');
		expect(resolveActorFromText('I will be in touch')).toBe('CUSTOMER');
	});

	it('business acts: "call me next Tuesday"', () => {
		expect(resolveActorFromText('Call me next Tuesday')).toBe('BUSINESS');
		expect(resolveActorFromText('Can you email me about it?')).toBe('BUSINESS');
	});

	it('no commitment → null', () => {
		expect(resolveActorFromText('My basement is flooding')).toBeNull();
		expect(resolveActorFromText(null)).toBeNull();
	});
});

describe('isSchedulable', () => {
	it('a confident, dated plan is schedulable', () => {
		expect(isSchedulable({ ...ray, calculatedTargetDate: '2026-08-18T13:00:00.000Z' })).toBe(true);
	});

	it('LOW confidence is never schedulable', () => {
		expect(
			isSchedulable({
				...ray,
				confidence: 'LOW',
				calculatedTargetDate: '2026-08-18T13:00:00.000Z'
			})
		).toBe(false);
	});

	it('a vague phrase is never schedulable even with HIGH confidence', () => {
		expect(
			isSchedulable({
				...ray,
				rawTimeframe: 'in the spring',
				calculatedTargetDate: '2026-08-18T13:00:00.000Z'
			})
		).toBe(false);
	});

	it('no resolvable date is never schedulable', () => {
		expect(isSchedulable({ ...ray, calculatedTargetDate: null })).toBe(false);
	});
});
