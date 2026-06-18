import { describe, it, expect } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
	it('merges class names', () => {
		expect(cn('a', 'b')).toBe('a b');
	});

	it('handles conditional classes', () => {
		expect(cn('base', false && 'hidden', true && 'block')).toBe('base block');
	});

	it('merges tailwind classes correctly (later overrides)', () => {
		// twMerge: conflicting utilities, last wins
		expect(cn('p-4', 'p-2')).toBe('p-2');
	});

	it('handles undefined and null', () => {
		expect(cn('a', undefined, null, 'b')).toBe('a b');
	});
});
