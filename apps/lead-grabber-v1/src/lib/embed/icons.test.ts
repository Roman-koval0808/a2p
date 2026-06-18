import { describe, it, expect } from 'vitest';
import { icons, getIcon } from './icons';

describe('icons', () => {
	it('has expected keys', () => {
		expect(icons.MessageSquare).toBeDefined();
		expect(icons.Phone).toBeDefined();
		expect(icons.Play).toBeDefined();
		expect(Object.keys(icons).length).toBeGreaterThan(5);
	});

	it('values are SVG strings', () => {
		expect(icons.MessageSquare).toContain('<svg');
		expect(icons.Phone).toContain('<svg');
	});
});

describe('getIcon', () => {
	it('returns icon SVG for known name', () => {
		expect(getIcon('MessageSquare')).toBe(icons.MessageSquare);
		expect(getIcon('Phone')).toContain('<svg');
	});

	it('returns empty string for unknown name', () => {
		expect(getIcon('NonExistent')).toBe('');
		expect(getIcon('')).toBe('');
	});
});
