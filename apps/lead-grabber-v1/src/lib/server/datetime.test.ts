import { describe, it, expect } from 'vitest';
import { resolveRelativeDate } from './datetime';

describe('Datetime Resolution Unit Tests (Infrastructure Part 1.7)', () => {
	it('1-2: Detects weekday/date consistency mismatch ("Tuesday August 5th" when Aug 5 is Wednesday)', () => {
		// August 5th 2026 is a Wednesday!
		const refTime = new Date('2026-08-01T12:00:00Z');
		const result = resolveRelativeDate(refTime, 'Tuesday', 'August 5th', 10, 0);

		expect(result.hasConflict).toBe(true);
		expect(result.dateConfidence).toBe('conflict');
		expect(result.conflictReason).toContain('does not match date');
	});

	it('4-2: Resolves bare weekday ("Tuesday at 10") to next occurrence and marks dateConfidence: inferred', () => {
		// Ref time is Friday Aug 1st 2026
		const refTime = new Date('2026-08-01T12:00:00Z');
		const result = resolveRelativeDate(refTime, 'Tuesday', null, 10, 0);

		expect(result.hasConflict).toBe(false);
		expect(result.dateConfidence).toBe('inferred');
		// Next Tuesday is August 4th 2026
		expect(result.resolvedDate.getFullYear()).toBe(2026);
		expect(result.resolvedDate.getMonth()).toBe(7); // August
		expect(result.resolvedDate.getDate()).toBe(4);
		expect(result.resolvedDate.getUTCHours()).toBe(10);
		expect(result.formattedExplicitText).toContain('Tuesday');
		expect(result.formattedExplicitText).toContain('August 4');
	});
});
