import { describe, it, expect } from 'vitest';
import {
	classifyEmergencyFromContent,
	classifyEmergencyFromDeclaration,
	emergencyAdPrior,
	rollUpSessionBucket,
	LIFE_SAFETY_HAZARDS,
	type EmergencyAiRead
} from './emergency-protocol';

const read = (over: Partial<EmergencyAiRead> = {}): EmergencyAiRead => ({
	channel: 'sms',
	event: 'something happened',
	severity: { critical_damaging: false, why: '' },
	urgency: { immediate: false, customer_timeframe: 'unspecified', why: '' },
	life_safety_hazard: null,
	confidence: 'high',
	...over
});

// The protocol's own "Worked results" table, one case per row.
describe('Rung 1 Emergency — worked results (spec table)', () => {
	it('"Burst pipe flooding the basement, come now" → emergency · confirmed', () => {
		const r = classifyEmergencyFromContent(
			read({
				severity: { critical_damaging: true, why: 'active flooding' },
				urgency: { immediate: true, customer_timeframe: 'now', why: 'said come now' }
			})
		);
		expect(r.isEmergency).toBe(true);
		expect(r.bucket).toBe('emergency');
		expect(r.status).toBe('confirmed');
	});

	it('"Busted pipe, book me next month" → NOT emergency (damaging but not urgent)', () => {
		const r = classifyEmergencyFromContent(
			read({
				severity: { critical_damaging: true, why: 'burst pipe' },
				urgency: { immediate: false, customer_timeframe: 'next month', why: 'customer chose' }
			})
		);
		expect(r.isEmergency).toBe(false);
		expect(r.bucket).not.toBe('emergency');
		expect(r.reasons.join(' ')).toContain('next month');
	});

	it('"Promo ends tomorrow, want the deal" → NOT emergency (urgent but not damaging)', () => {
		const r = classifyEmergencyFromContent(
			read({
				severity: { critical_damaging: false, why: 'no damage' },
				urgency: { immediate: true, customer_timeframe: 'tomorrow', why: 'promo ends' }
			})
		);
		expect(r.isEmergency).toBe(false);
		expect(r.reasons.join(' ')).toContain('time-pressured buying');
	});

	it('"I smell gas, book me next week" → emergency (life-safety override beats stated timing)', () => {
		const r = classifyEmergencyFromContent(
			read({
				severity: { critical_damaging: true, why: 'gas' },
				urgency: { immediate: false, customer_timeframe: 'next week', why: 'customer chose' },
				life_safety_hazard: 'gas_leak'
			})
		);
		expect(r.isEmergency).toBe(true);
		expect(r.status).toBe('confirmed');
		expect(r.reasons[0]).toContain('life-safety override');
	});

	it('structured "Emergency service" selection → emergency · confirmed (Route A)', () => {
		const r = classifyEmergencyFromDeclaration({ signal: 'emergency_service_selection' });
		expect(r.isEmergency).toBe(true);
		expect(r.status).toBe('confirmed');
	});

	it('clicking the emergency ad and never calling → NOT emergency, an unconverted source signal', () => {
		const p = emergencyAdPrior(true, false);
		expect(p.setsEmergencyBucket).toBe(false);
		expect(p.emergencyPrior).toBe(true);
		expect(p.unconvertedAdClick).toBe(true);
	});
});

describe('Rung 1 Emergency — the rules behind the table', () => {
	it('saying the word "emergency" is not proof — both conditions still decide', () => {
		// The AI read is what matters; a message that merely says "emergency" but describes
		// neither condition must not classify as one.
		const r = classifyEmergencyFromContent(
			read({ event: 'customer said the word emergency but described a routine quote' })
		);
		expect(r.isEmergency).toBe(false);
	});

	it('a low-confidence read is declared, not confirmed', () => {
		const r = classifyEmergencyFromContent(
			read({
				severity: { critical_damaging: true, why: 'flood' },
				urgency: { immediate: true, customer_timeframe: 'now', why: 'now' },
				confidence: 'low'
			})
		);
		expect(r.isEmergency).toBe(true);
		expect(r.status).toBe('declared');
	});

	it('records WHY something was not an emergency', () => {
		const r = classifyEmergencyFromContent(read());
		expect(r.reasons.join(' ')).toContain('neither critical/damaging nor urgent');
	});

	it('locks the four danger-to-life hazards', () => {
		expect([...LIFE_SAFETY_HAZARDS]).toEqual([
			'gas_leak',
			'fire_or_smoke',
			'electrical_shock',
			'carbon_monoxide'
		]);
	});
});

describe('session rollup — escalate-only, highest wins', () => {
	it('takes the highest bucket across events', () => {
		expect(rollUpSessionBucket(['research', 'comparison'])).toBe('comparison');
		expect(rollUpSessionBucket(['comparison', 'active', 'research'])).toBe('active');
		expect(rollUpSessionBucket(['active', 'emergency'])).toBe('emergency');
	});

	it('floors at research', () => {
		expect(rollUpSessionBucket([])).toBe('research');
	});

	it('never falls back — order of arrival does not matter', () => {
		expect(rollUpSessionBucket(['emergency', 'research'])).toBe('emergency');
	});
});
