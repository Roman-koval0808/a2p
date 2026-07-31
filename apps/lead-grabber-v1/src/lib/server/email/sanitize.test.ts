import { describe, it, expect } from 'vitest';
import { sanitizeEmailBody, isMarketingBlast } from './sanitize';

describe('sanitizeEmailBody', () => {
	it('keeps a plain customer message untouched', () => {
		expect(sanitizeEmailBody('Can I book a meeting on Friday by 1am?')).toBe(
			'Can I book a meeting on Friday by 1am?'
		);
	});

	it('strips Mailtrack/Mailsuite tracking junk from a forwarded message', () => {
		const raw =
			'Can I book a meeting on Friday by 1am?\nOn Sat, Aug 1, 2026 at 2:06 AM Cool Dev <cooldesigner423@gmail.com> wrote:\n> > [image: Mailsuite] Sender notified with Mailtrack · Opt out <https://u.list-preferences.com/xyz>\n> old quoted content';
		const out = sanitizeEmailBody(raw);
		expect(out).toBe('Can I book a meeting on Friday by 1am?');
		expect(out).not.toContain('Mailtrack');
		expect(out).not.toContain('Mailsuite');
		expect(out).not.toContain('list-preferences');
		expect(out).not.toContain('old quoted content');
	});

	it('cuts quoted history at the wrote: marker', () => {
		const raw =
			'Thanks for the call.\n\nOn Jul 30, 2026 at 9:00 AM Jane <jane@x.com> wrote:\n> Let me know what you think\n> More history';
		expect(sanitizeEmailBody(raw)).toBe('Thanks for the call.');
	});

	it('keeps the readable top lines when the quote-cut would gut the message', () => {
		const raw = 'Yes\nOn Jul 30, 2026 at 9:00 AM Jane <jane@x.com> wrote:\n> everything quoted';
		expect(sanitizeEmailBody(raw)).toBe('Yes');
	});

	it('strips unsubscribe and preferences boilerplate', () => {
		const raw =
			'Here is the quote you asked for.\nWant to change how you receive these emails? You can update your preferences (https://mailer.example/prefs) or unsubscribe from this list (https://mailer.example/unsub).';
		const out = sanitizeEmailBody(raw);
		expect(out).toBe('Here is the quote you asked for.');
	});

	it('strips image markers and opt-out lines', () => {
		const raw = 'Hello!\n[image: Logo]\nSender notified with Mailsuite · Opt out <https://x.example/o>\nSee you soon.';
		const out = sanitizeEmailBody(raw);
		expect(out).toBe('Hello!\n\nSee you soon.');
	});

	it('collapses repeated blank lines', () => {
		expect(sanitizeEmailBody('a\n\n\n\n\nb')).toBe('a\n\nb');
	});

	it('returns empty input unchanged', () => {
		expect(sanitizeEmailBody('')).toBe('');
		expect(sanitizeEmailBody(null as any)).toBe(null);
	});
});

describe('isMarketingBlast', () => {
	it('detects newsletters with many URLs', () => {
		const body = Array.from({ length: 12 }, (_, i) => `Headline ${i} (https://news.example/${i})`).join('\n');
		expect(isMarketingBlast(body)).toBe(true);
	});

	it('does not flag a normal customer email', () => {
		expect(isMarketingBlast('Can I book a meeting on Friday by 1am?')).toBe(false);
		expect(isMarketingBlast('Here is the link: https://example.com/page')).toBe(false);
	});

	it('returns false for empty input', () => {
		expect(isMarketingBlast(null)).toBe(false);
		expect(isMarketingBlast('')).toBe(false);
	});
});
