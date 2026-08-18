import { describe, it, expect } from 'vitest';
import { toE164 } from './phone';

/**
 * §4.4. Identity keys are hashed, and a hash of two spellings of one number is two people. This is
 * the first thing to check when a duplicate turns up.
 */
describe('toE164 — the identity key', () => {
	it('gives every spelling of one number the same key', () => {
		const canonical = '+17052642251';
		for (const spelling of [
			'7052642251',
			'705-264-2251',
			'(705) 264-2251',
			'705.264.2251',
			'17052642251',
			'+1 705 264 2251',
			'  +17052642251  ',
			'1 (705) 264-2251'
		]) {
			expect(toE164(spelling)).toBe(canonical);
		}
	});

	it('is the fix for the duplicate: bare and prefixed forms used to differ', () => {
		expect(toE164('7052642251')).toBe(toE164('+17052642251'));
	});

	it('keeps an explicit country code rather than re-guessing it', () => {
		expect(toE164('+447700900123')).toBe('+447700900123');
	});

	it('assumes no country code for a long unprefixed number, rather than forcing +1', () => {
		expect(toE164('447700900123')).toBe('+447700900123');
	});

	it('refuses fragments instead of minting a key that can never match', () => {
		expect(toE164('1234')).toBe('');
		expect(toE164('ext. 42')).toBe('');
		expect(toE164('')).toBe('');
		expect(toE164(null)).toBe('');
		expect(toE164(undefined)).toBe('');
	});
});
