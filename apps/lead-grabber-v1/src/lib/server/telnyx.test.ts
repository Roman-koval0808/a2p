import { describe, it, expect } from 'vitest';
import { generateBillingGroupName } from './telnyx';

describe('generateBillingGroupName', () => {
	it('joins sanitized company name and company id', () => {
		expect(generateBillingGroupName('Acme Corp', 'company-123')).toBe('Acme Corp-company-123');
	});

	it('strips special characters from company name', () => {
		expect(generateBillingGroupName('Test & Co.!', 'c1')).toBe('Test  Co-c1');
	});

	it('trims and limits name to 50 chars', () => {
		const long = 'A'.repeat(60);
		expect(generateBillingGroupName(long, 'c1').length).toBeLessThanOrEqual(50 + 1 + 2); // name + '-' + id
		expect(generateBillingGroupName(long, 'c1')).toMatch(/-c1$/);
	});

	it('allows spaces and hyphens in name', () => {
		expect(generateBillingGroupName('My Company - North', 'c1')).toBe('My Company - North-c1');
	});
});
