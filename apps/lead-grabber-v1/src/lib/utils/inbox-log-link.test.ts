import { describe, it, expect } from 'vitest';
import { normalizeContactForMatch } from './inbox-log-link';

describe('normalizeContactForMatch', () => {
	it('returns empty string for null, undefined, or empty', () => {
		expect(normalizeContactForMatch(null)).toBe('');
		expect(normalizeContactForMatch(undefined)).toBe('');
		expect(normalizeContactForMatch('')).toBe('');
	});

	it('normalizes phone-like strings (digits only or E.164)', () => {
		expect(normalizeContactForMatch('+1 (705) 432-3412')).toBe('+17054323412');
		expect(normalizeContactForMatch('7054323412')).toBe('7054323412');
	});

	it('lowercases and trims email-like strings', () => {
		expect(normalizeContactForMatch('  User@Example.COM  ')).toBe('user@example.com');
	});

	it('treats string with digits and phone chars as phone', () => {
		expect(normalizeContactForMatch('(705) 432-3412')).toMatch(/^\+?\d+$/);
	});
});
