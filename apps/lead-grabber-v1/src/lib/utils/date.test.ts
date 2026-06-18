import { describe, it, expect } from 'vitest';
import { formatDate } from './date';

describe('formatDate', () => {
	it('returns N/A for null or undefined', () => {
		expect(formatDate(null)).toBe('N/A');
		expect(formatDate(undefined)).toBe('N/A');
	});

	it('returns Invalid date for invalid date string', () => {
		expect(formatDate('not-a-date')).toBe('Invalid date');
		expect(formatDate('')).toBe('N/A');
	});

	it('formats valid ISO date string', () => {
		const result = formatDate('2026-01-15T12:00:00Z');
		expect(result).toMatch(/Jan.*15.*2026/);
	});

	it('formats date-only string', () => {
		const result = formatDate('2026-02-16');
		expect(result).toMatch(/Feb.*16.*2026/);
	});
});
