import { describe, it, expect, vi } from 'vitest';
import { buildLeadformScript } from './leadform-builder';

vi.mock('./styles', () => ({ leadformStyles: '/* mock */' }));

describe('buildLeadformScript', () => {
	it('returns an IIFE string', () => {
		const script = buildLeadformScript({
			id: 'lf1',
			formData: {},
			companyId: 'c1',
			baseUrl: 'https://app.example.com'
		});
		expect(script).toContain('(function() {');
		expect(script).toContain('})();');
	});

	it('injects companyId, baseUrl, formId', () => {
		const script = buildLeadformScript({
			id: 'form-123',
			formData: {},
			companyId: 'company-abc',
			baseUrl: 'https://forms.test.com'
		});
		expect(script).toContain('company-abc');
		expect(script).toContain('https://forms.test.com');
		expect(script).toContain('form-123');
	});

	it('uses default button color when not in formData.settings', () => {
		const script = buildLeadformScript({
			id: 'lf2',
			formData: {},
			companyId: 'c1',
			baseUrl: 'https://app.example.com'
		});
		expect(script).toContain('#3B5BDB');
	});
});
