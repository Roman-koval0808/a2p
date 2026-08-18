import { describe, it, expect } from 'vitest';
import { toE164 } from './company-numbers';

describe('toE164', () => {
	it('returns empty string for empty input', () => {
		expect(toE164('')).toBe('');
	});

	/**
	 * This previously expected "+7054323412" — the digits with a "+" glued on. That is a +7
	 * (Russia) number, not the Ontario one that was dialled, and it meant the same person reached
	 * us under two different keys depending on whether the country code happened to be present.
	 * A NANP number missing its country code is a +1 number.
	 */
	it('adds the country code a bare NANP number is missing', () => {
		expect(toE164('7054323412')).toBe('+17054323412');
		expect(toE164('(705) 432-3412')).toBe('+17054323412');
	});

	it('keeps + when already present', () => {
		expect(toE164('+17054323412')).toBe('+17054323412');
		expect(toE164('+1 (705) 432-3412')).toBe('+17054323412');
	});

	it('gives every spelling of one number the same key', () => {
		const canonical = '+17054323412';
		for (const spelling of ['7054323412', '(705) 432-3412', '1 705 432 3412', '+17054323412']) {
			expect(toE164(spelling)).toBe(canonical);
		}
	});
});
