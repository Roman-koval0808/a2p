import { describe, it, expect, vi } from 'vitest';

// execution-engine pulls in $lib/db and $env at import time; neither is needed
// for the pure text builder under test.
vi.mock('$lib/db', () => ({ prisma: {} }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

const { buildOwnerAlertText } = await import('./execution-engine');

describe('buildOwnerAlertText', () => {
	const base = { customerName: 'Sam', aiSummary: 'Furnace is making a noise.' };

	it('takes severity from the AI urgency, not the signal priority', () => {
		// CRITICAL_CHURN_RISK is priority 1, but the customer just has a noise.
		const text = buildOwnerAlertText({ ...base, urgencyLevel: 'medium', priorityLevel: 1 });
		expect(text).toContain('[ClearSky MEDIUM ALERT]');
		expect(text).not.toContain('CRITICAL');
	});

	it('keeps the siren for genuinely urgent alerts', () => {
		expect(buildOwnerAlertText({ ...base, urgencyLevel: 'critical' })).toContain(
			'[ClearSky CRITICAL ALERT] 🚨'
		);
		expect(buildOwnerAlertText({ ...base, urgencyLevel: 'high' })).toContain('HIGH ALERT] 🚨');
	});

	it('drops the siren for routine alerts', () => {
		expect(buildOwnerAlertText({ ...base, urgencyLevel: 'low' })).not.toContain('🚨');
		expect(buildOwnerAlertText({ ...base, urgencyLevel: 'medium' })).not.toContain('🚨');
	});

	it('falls back to the signal priority when there is no urgency reading', () => {
		expect(buildOwnerAlertText({ ...base, priorityLevel: 1 })).toContain('CRITICAL');
		expect(buildOwnerAlertText({ ...base, priorityLevel: 4 })).toContain('LOW');
	});

	it('defaults to MEDIUM when it knows neither', () => {
		expect(buildOwnerAlertText(base)).toContain('MEDIUM');
	});

	it('names the customer and the issue', () => {
		const text = buildOwnerAlertText({ ...base, urgencyLevel: 'low' });
		expect(text).toContain('Customer: Sam');
		expect(text).toContain('Issue: Furnace is making a noise.');
	});
});
