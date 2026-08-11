import { describe, it, expect } from 'vitest';
import { outcomeFor, type RecontactAnalysis } from './recontact-analysis';

const base: RecontactAnalysis = {
	relatedToOriginal: true,
	relatednessConfidence: 0.9,
	wants: 'nothing',
	informationRequested: null,
	when: null,
	rawTimingPhrase: null,
	conditions: [],
	lostInterest: false,
	postponedTo: null,
	postponedPhrase: null,
	summary: 'Joe got back in touch about the furnace.'
};

describe('outcomeFor — one task per closure, and never a silent drop', () => {
	it('a booking request becomes a call-back task', () => {
		const out = outcomeFor({ ...base, wants: 'appointment' }, 'Joe');
		expect(out.title).toContain('Joe');
		expect(out.title).toMatch(/book|call/i);
		expect(out.continueAutomation).toBe(true);
	});

	it('an information request names what was asked for', () => {
		const out = outcomeFor(
			{ ...base, wants: 'information', informationRequested: 'furnace sizing' },
			'Joe'
		);
		expect(out.title).toContain('furnace sizing');
	});

	it('losing interest still tells someone, but stops the automation', () => {
		const out = outcomeFor({ ...base, lostInterest: true }, 'Joe');
		expect(out.title).toMatch(/no longer interested/i);
		expect(out.continueAutomation).toBe(false);
		expect(out.rescheduleTo).toBeNull();
	});

	it('an undatable postponement still surfaces, it just cannot be scheduled', () => {
		// The model returned "middle of September" once; new Date() made that Invalid Date and
		// Prisma rejected the row, losing the commitment entirely.
		const out = outcomeFor(
			{ ...base, postponedTo: null, postponedPhrase: 'middle of September' },
			'Joe'
		);
		expect(out.title).toContain('middle of September');
		expect(out.rescheduleTo).toBeNull();
		expect(out.continueAutomation).toBe(true);
	});

	it('a postponement schedules the new date — otherwise he falls out of the pipeline', () => {
		const out = outcomeFor({ ...base, postponedTo: '2026-09-15' }, 'Joe');
		expect(out.rescheduleTo).toBe('2026-09-15');
		expect(out.title).toContain('2026-09-15');
	});

	it('postponement beats a "wants nothing" reading — he has not gone away', () => {
		const out = outcomeFor({ ...base, wants: 'nothing', postponedTo: '2026-09-15' }, 'Joe');
		expect(out.rescheduleTo).toBe('2026-09-15');
	});

	it('losing interest beats a postponement — a cancellation is not a delay', () => {
		const out = outcomeFor({ ...base, lostInterest: true, postponedTo: '2026-09-15' }, 'Joe');
		expect(out.continueAutomation).toBe(false);
		expect(out.rescheduleTo).toBeNull();
	});

	it('no reading at all still surfaces it to a human', () => {
		// The AI being down must never look like "nothing to do".
		const out = outcomeFor(null, 'Joe');
		expect(out.title).toMatch(/review/i);
		expect(out.continueAutomation).toBe(true);
	});

	it('falls back to a neutral label when we have no name', () => {
		const out = outcomeFor(base, '');
		expect(out.title).toMatch(/^Customer/);
	});
});
