import { describe, it, expect } from 'vitest';
import { DEFAULT_TAXONOMY, subtopicFromCategory } from './subtopic-classifier';

describe('the taxonomy', () => {
	it('is two levels, with children pointing at real parents', () => {
		const keys = new Set(DEFAULT_TAXONOMY.map((t) => t.key));
		for (const entry of DEFAULT_TAXONOMY) {
			if (entry.parent) expect(keys.has(entry.parent)).toBe(true);
		}
	});

	it('carries the same windows as the engagement rules', () => {
		const byKey = Object.fromEntries(DEFAULT_TAXONOMY.map((t) => [t.key, t.inactivityDays]));
		expect(byKey.bathroom).toBe(180);
		expect(byKey.kitchen).toBe(180);
		expect(byKey.drain).toBe(30);
		expect(byKey.emergency).toBe(7);
	});
});

describe('subtopicFromCategory — the free path for calls', () => {
	const t = DEFAULT_TAXONOMY;

	it('matches a tracking category by its label', () => {
		expect(subtopicFromCategory('Drains', t)).toBe('drain');
		expect(subtopicFromCategory('Furnace', t)).toBe('furnace');
	});

	it('matches when the category is worded differently', () => {
		expect(subtopicFromCategory('Drain Cleaning', t)).toBe('drain');
		expect(subtopicFromCategory('water heater', t)).toBe('water_heater');
	});

	it('prefers the more specific label', () => {
		// "Water heater" must not be swallowed by "Heating & cooling"
		expect(subtopicFromCategory('Water heater repair', t)).toBe('water_heater');
	});

	it('returns null rather than guessing', () => {
		expect(subtopicFromCategory('General enquiries', t)).toBeNull();
		expect(subtopicFromCategory('', t)).toBeNull();
		expect(subtopicFromCategory(null, t)).toBeNull();
	});
});
