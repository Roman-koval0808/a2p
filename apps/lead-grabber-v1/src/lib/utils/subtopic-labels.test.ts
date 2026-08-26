import { describe, it, expect } from 'vitest';
import {
	subtopicLabel,
	extractQuoteSubject,
	extractConciseIntent,
	formatDescriptiveIntent
} from './subtopic-labels';

describe('extractQuoteSubject', () => {
	it('extracts quote subject from a customer message', () => {
		expect(
			extractQuoteSubject(
				'Hi there, I am a new customer named John. I would like to get a price estimate or bid for a plumbing pipe renovation project.'
			)
		).toBe('Plumbing pipe renovation project');
	});

	it('extracts quote subject from an AI reason string', () => {
		expect(
			extractQuoteSubject(
				'New prospect asking for a price estimate on a plumbing pipe renovation but provided no scope details.'
			)
		).toBe('Plumbing pipe renovation');
	});

	it('extracts quote subject for AC unit', () => {
		expect(
			extractQuoteSubject(
				'I would like to get a quote on a new air conditioning unit. I am wondering what the cost of central would be.'
			)
		).toBe('New air conditioning unit');
	});

	it('extracts quote subject for kitchen remodel', () => {
		expect(extractQuoteSubject('Looking for a quote for a kitchen remodel')).toBe(
			'Kitchen remodel'
		);
	});
});

describe('formatDescriptiveIntent', () => {
	it('formats a quote request with an extracted subject', () => {
		const comm = {
			subtopic: 'quote',
			summary:
				'New customer John is calling to request a price estimate or bid for a plumbing pipe renovation project.',
			content:
				'Hi there, I am a new customer named John. I would like to get a price estimate or bid for a plumbing pipe renovation project.',
			metadata: {
				intent: 'Sales',
				sub_intent: 'Quote Request',
				ai_intent: {
					reason:
						'New prospect asking for a price estimate on a plumbing pipe renovation but provided no scope details.',
					purpose: 'opportunity'
				}
			}
		};
		expect(formatDescriptiveIntent(comm)).toBe('Quote: Plumbing pipe renovation');
	});

	it('formats a quote request with known subtopic', () => {
		const comm = {
			intentSubtopic: 'bathroom',
			metadata: {
				intent: 'quote'
			}
		};
		expect(formatDescriptiveIntent(comm)).toBe('Quote: Bathroom renovation');
	});

	it('formats a quote request with service_requested in metadata', () => {
		const comm = {
			metadata: {
				service_requested: 'plumbing pipe renovation',
				contains_quote_request: true
			}
		};
		expect(formatDescriptiveIntent(comm)).toBe('Quote: Plumbing pipe renovation');
	});

	it('formats a vehicle purchase / test drive', () => {
		const comm = {
			metadata: {
				sub_intent: 'Vehicle Purchase / Test Drive',
				intent: 'sales',
				ai_intent: { purpose: 'booking' }
			}
		};
		expect(formatDescriptiveIntent(comm)).toBe('Vehicle Purchase / Test Drive');
	});

	it('formats an office hours inquiry', () => {
		const comm = {
			metadata: {
				sub_intent: 'General Inquiry',
				ai_intent: {
					reason:
						'Customer asking a straightforward question about business hours with no service request or appointment.'
				}
			}
		};
		expect(formatDescriptiveIntent(comm)).toBe('Inquiry: Business Hours');
	});

	it('formats emergency calls with emergency_type', () => {
		const comm = {
			intentEmergency: true,
			metadata: {
				emergency_type: 'roof_leak'
			}
		};
		expect(formatDescriptiveIntent(comm)).toBe('Emergency: Roof leak');
	});

	it('formats emergency calls with trade subtopic', () => {
		const comm = {
			intentEmergency: true,
			intentSubtopic: 'drain'
		};
		expect(formatDescriptiveIntent(comm)).toBe('Emergency: Blocked drain');
	});

	it('formats dropped calls and missed calls', () => {
		expect(
			formatDescriptiveIntent({ isDropCall: true, metadata: { duration: 12.4 } })
		).toBe('Dropped Call (12s)');
		expect(formatDescriptiveIntent({ metadata: { drop_call: true } })).toBe('Missed Call');
	});

	it('never outputs a bare single word like "Quote" or "Sales"', () => {
		const res1 = formatDescriptiveIntent({ metadata: { intent: 'quote' } });
		expect(res1).not.toBe('Quote');
		expect(res1).toBe('Quote Request');

		const res2 = formatDescriptiveIntent({ metadata: { message_category: 'sales' } });
		expect(res2).not.toBe('Sales');
		expect(res2).toBe('Sales Opportunity');

		const res3 = formatDescriptiveIntent({ metadata: { intent: 'support' } });
		expect(res3).not.toBe('Support');
		expect(res3).toBe('Support Inquiry');
	});
});
