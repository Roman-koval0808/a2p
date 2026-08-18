import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/static/public', () => ({
	PUBLIC_BASE_URL: 'https://example.com'
}));

vi.mock('./tracking', () => ({
	mintCsToken: vi.fn().mockResolvedValue('mock_cs_token_123')
}));

import { injectEmailTracking } from './tracking-inject';

describe('injectEmailTracking', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('appends tracking pixel to plain HTML', async () => {
		const result = await injectEmailTracking('<p>Hello</p>', 'contact_1', 'company_1');
		expect(result.csToken).toBe('mock_cs_token_123');
		expect(result.htmlContent).toContain('/api/track/open?t=mock_cs_token_123');
		expect(result.htmlContent).toContain('<p>Hello</p>');
	});

	it('wraps <a> hrefs through click-tracking redirect', async () => {
		const result = await injectEmailTracking(
			'<a href="https://example.com/offer">Click here</a>',
			'c1', 'comp1'
		);
		expect(result.htmlContent).toContain('/api/track/click?t=mock_cs_token_123&url=');
		expect(result.htmlContent).toContain(encodeURIComponent('https://example.com/offer'));
		expect(result.htmlContent).toContain('>Click here</a>');
	});

	it('injects pixel before </body> when present', async () => {
		const result = await injectEmailTracking(
			'<html><body><p>Hi</p></body></html>', 'c1', 'comp1'
		);
		expect(result.htmlContent).toMatch(/img.*track\/open.*<\/body>/s);
	});

	it('handles multiple links', async () => {
		const result = await injectEmailTracking(
			'<a href="https://a.com">A</a> <a href="https://b.com">B</a>',
			'c1', 'comp1'
		);
		const matches = result.htmlContent.match(/\/api\/track\/click\?t=/g);
		expect(matches).toHaveLength(2);
	});

	it('uses custom baseUrl when provided', async () => {
		const result = await injectEmailTracking('<p>Test</p>', 'c1', 'comp1', 'https://my.site');
		expect(result.htmlContent).toContain('https://my.site/api/track/open?t=');
	});

	it('preserves non-href attributes on <a> tags', async () => {
		const result = await injectEmailTracking(
			'<a class="btn" style="color:red" href="https://x.com">X</a>',
			'c1', 'comp1'
		);
		expect(result.htmlContent).toContain('class="btn"');
		expect(result.htmlContent).toContain('style="color:red"');
	});
});
