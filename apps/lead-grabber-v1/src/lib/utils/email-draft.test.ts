import { describe, it, expect } from 'vitest';
import { splitDraftSubject, draftBodyToHtml } from './email-draft';

describe('splitDraftSubject', () => {
	it('reads a markdown-wrapped subject — the case that reached a customer', () => {
		const draft =
			"**Subject: Re: Furnace Noise - We'll Follow Up Tomorrow**\n\nHi Sam,\n\nThanks for letting us know.\n\nBest regards,\nTotal Trade Solutions";
		const { subject, body } = splitDraftSubject(draft);
		expect(subject).toBe("Re: Furnace Noise - We'll Follow Up Tomorrow");
		expect(body.startsWith('Hi Sam,')).toBe(true);
		expect(body).not.toMatch(/subject/i);
	});

	it('reads a bare subject line', () => {
		const { subject, body } = splitDraftSubject('Subject: Re: Your quote\n\nHi Rory,\n\nThanks.');
		expect(subject).toBe('Re: Your quote');
		expect(body).toBe('Hi Rory,\n\nThanks.');
	});

	it('handles the bold-label variant', () => {
		expect(splitDraftSubject('**Subject:** Re: Your quote\n\nHi.').subject).toBe('Re: Your quote');
	});

	it('strips surrounding quotes', () => {
		expect(splitDraftSubject('Subject: "Re: Your quote"\n\nHi.').subject).toBe('Re: Your quote');
	});

	it('skips leading blank lines', () => {
		expect(splitDraftSubject('\n\nSubject: Hello\n\nHi.').subject).toBe('Hello');
	});

	it('leaves a draft with no subject line untouched', () => {
		const draft = 'Hi Sam,\n\nThanks for reaching out.';
		expect(splitDraftSubject(draft)).toEqual({ subject: null, body: draft });
	});

	it('does not treat a quoted subject deep in the body as the draft subject', () => {
		const draft =
			'Hi Sam,\n\nYou wrote:\n\n> Subject: my old email\n\nWe will look into it.\n\nRegards';
		const { subject, body } = splitDraftSubject(draft);
		expect(subject).toBeNull();
		expect(body).toBe(draft);
	});

	it('survives empty input', () => {
		expect(splitDraftSubject('')).toEqual({ subject: null, body: '' });
		expect(splitDraftSubject(null)).toEqual({ subject: null, body: '' });
	});
});

describe('draftBodyToHtml', () => {
	it('keeps paragraphs apart instead of running them together', () => {
		const html = draftBodyToHtml('Hi Sam,\n\nThanks for reaching out.\n\nBest regards,\nTotal Trade');
		expect(html).toContain('<p>Hi Sam,</p>');
		expect(html).toContain('<p>Thanks for reaching out.</p>');
		// The sign-off is one paragraph with a line break, not two paragraphs.
		expect(html).toContain('<p>Best regards,<br>Total Trade</p>');
	});

	it('renders bold rather than printing asterisks', () => {
		expect(draftBodyToHtml('We are **open** tomorrow.')).toContain('<strong>open</strong>');
	});

	it('escapes HTML in customer-supplied text', () => {
		const html = draftBodyToHtml('Quote for <script>alert(1)</script> & sons');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('&amp; sons');
		expect(html).not.toContain('<script>');
	});

	it('passes existing HTML through untouched', () => {
		const html = '<p>Already formatted</p>';
		expect(draftBodyToHtml(html)).toBe(html);
	});

	it('survives empty input', () => {
		expect(draftBodyToHtml('')).toBe('');
		expect(draftBodyToHtml(null)).toBe('');
	});
});
