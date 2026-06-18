import { describe, it, expect } from 'vitest';
import { normalizePhoneNumber, formatPhoneNumber, formatPhoneForDialing } from './phone';

describe('normalizePhoneNumber', () => {
	it('returns empty string for empty input', () => {
		expect(normalizePhoneNumber('')).toBe('');
	});

	it('keeps + and strips non-digits for E.164-like input', () => {
		expect(normalizePhoneNumber('+1 (705) 432-3412')).toBe('+17054323412');
		expect(normalizePhoneNumber('+44 20 7123 4567')).toBe('+442071234567');
	});

	it('strips all non-digits when no leading +', () => {
		expect(normalizePhoneNumber('7054323412')).toBe('7054323412');
		expect(normalizePhoneNumber('(705) 432-3412')).toBe('7054323412');
	});

	it('trims whitespace', () => {
		expect(normalizePhoneNumber('  +1 705 432 3412  ')).toBe('+17054323412');
	});
});

describe('formatPhoneNumber', () => {
	it('returns empty string for empty input', () => {
		expect(formatPhoneNumber('')).toBe('');
	});

	it('formats 11-digit US number with leading 1', () => {
		expect(formatPhoneNumber('17054323412')).toBe('+1 (705) 4323 412');
	});

	it('formats 10-digit US number with +1', () => {
		expect(formatPhoneNumber('7054323412')).toBe('+1 (705) 4323 412');
	});

	it('returns input as-is when not 10 or 11 digits', () => {
		expect(formatPhoneNumber('123')).toBe('123');
	});
});

describe('formatPhoneForDialing', () => {
	it('returns empty string for empty input', () => {
		expect(formatPhoneForDialing('')).toBe('');
	});

	it('adds + to 11-digit number starting with 1', () => {
		expect(formatPhoneForDialing('17059800835')).toBe('+17059800835');
	});

	it('adds +1 to 10-digit number', () => {
		expect(formatPhoneForDialing('7059800835')).toBe('+17059800835');
	});

	it('adds + to other digit strings', () => {
		expect(formatPhoneForDialing('447911123456')).toBe('+447911123456');
	});

	it('strips non-digits then formats', () => {
		expect(formatPhoneForDialing('(705) 980-0835')).toBe('+17059800835');
	});
});
