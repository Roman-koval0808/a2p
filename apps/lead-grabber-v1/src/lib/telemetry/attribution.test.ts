import { describe, expect, it } from 'vitest';
import { resolveAttribution } from './attribution';

describe('resolveAttribution', () => {
	it('keeps Bing organic separate from Bing paid', () => {
		const result = resolveAttribution(
			'https://www.bing.com/search?q=drains',
			'https://example.com/services/drains?utm_source=bing&utm_medium=organic',
			'?utm_source=bing&utm_medium=organic'
		);
		expect(result.channel).toBe('organic_bing');
	});

	it('requires paid evidence for paid search', () => {
		const result = resolveAttribution(
			'https://www.bing.com/search?q=drains',
			'https://example.com/services/drains?utm_source=bing&utm_medium=cpc',
			'?utm_source=bing&utm_medium=cpc'
		);
		expect(result.channel).toBe('bing_paid');
	});
});
