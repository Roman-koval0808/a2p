import { describe, it, expect } from 'vitest';
import { toE164 } from './company-numbers';

describe('toE164', () => {
	it('returns empty string for empty input', () => {
		expect(toE164('')).toBe('');
	});

	it('normalizes and adds + when missing', () => {
		expect(toE164('7054323412')).toBe('+7054323412');
		expect(toE164('(705) 432-3412')).toBe('+7054323412');
	});

	it('keeps + when already present', () => {
		expect(toE164('+17054323412')).toBe('+17054323412');
		expect(toE164('+1 (705) 432-3412')).toBe('+17054323412');
	});
});
