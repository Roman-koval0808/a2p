import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildLeadboxScript } from './leadbox-builder';

// leadbox-builder imports styles and icons; ensure they're loadable
vi.mock('./styles', () => ({ leadboxStyles: '/* mock */' }));
vi.mock('./icons', () => ({ icons: { MessageSquare: '<svg></svg>' } }));

describe('buildLeadboxScript', () => {
	it('returns an IIFE string', () => {
		const script = buildLeadboxScript({
			id: 'lb1',
			leadboxData: {},
			companyId: 'c1',
			baseUrl: 'https://app.example.com'
		});
		expect(script).toContain('(function() {');
		expect(script).toContain('})();');
	});

	it('injects companyId and baseUrl', () => {
		const script = buildLeadboxScript({
			id: 'lb2',
			leadboxData: {},
			companyId: 'company-xyz',
			baseUrl: 'https://cdn.test.com'
		});
		expect(script).toContain('company-xyz');
		expect(script).toContain('https://cdn.test.com');
	});

	it('includes leadboxData in script', () => {
		const script = buildLeadboxScript({
			id: 'lb3',
			leadboxData: { textOnly: true },
			companyId: 'c1',
			baseUrl: 'https://app.example.com'
		});
		expect(script).toContain('leadBoxOpen');
		expect(script).toContain('textOnly');
	});
});
