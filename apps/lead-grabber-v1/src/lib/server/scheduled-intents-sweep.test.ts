import { describe, it, expect } from 'vitest';
import { isAutomatedRow } from './scheduled-intents-sweep';

describe('isAutomatedRow (§5) — our own rows never count as the customer getting in touch', () => {
	it('the automated ack we sent does not count as contact', () => {
		expect(isAutomatedRow({ scheduled_intent_ack: true })).toBe(true);
	});

	it('the CRM note we wrote does not count as contact', () => {
		expect(isAutomatedRow({ scheduled_intent_note: true, intentId: 'x' })).toBe(true);
	});

	it('a real inbound message counts', () => {
		expect(isAutomatedRow({ thread_id: 't1', subject: 'Re: estimate' })).toBe(false);
	});

	it('null metadata counts as contact (there is nothing of ours in it)', () => {
		expect(isAutomatedRow(null)).toBe(false);
		expect(isAutomatedRow(undefined)).toBe(false);
	});
});
