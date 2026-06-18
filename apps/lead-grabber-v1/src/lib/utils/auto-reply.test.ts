import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	getDefaultAutoReplySettings,
	getAutoReplyMessage,
	isBusinessHours,
	getNextBusinessDay
} from './auto-reply';
import type { AutoReplySettings, BusinessHoursConfig } from './auto-reply';

describe('getDefaultAutoReplySettings', () => {
	it('returns default structure with businessHours and messages', () => {
		const settings = getDefaultAutoReplySettings();
		expect(settings.textAutoReply).toBe(false);
		expect(settings.businessHoursMessage).toBeDefined();
		expect(settings.afterHoursMessage).toContain('{date}');
		expect(settings.businessHours.monday?.isOpen).toBe(true);
		expect(settings.businessHours.sunday?.isOpen).toBe(false);
	});
});

describe('getAutoReplyMessage', () => {
	it('returns null when textAutoReply is false', () => {
		const settings = getDefaultAutoReplySettings();
		settings.textAutoReply = false;
		expect(getAutoReplyMessage('sms', settings, 14)).toBe(null);
	});

	it('returns null when businessHours is missing', () => {
		const settings = getDefaultAutoReplySettings();
		settings.textAutoReply = true;
		(settings as AutoReplySettings & { businessHours?: BusinessHoursConfig }).businessHours =
			undefined as unknown as BusinessHoursConfig;
		expect(getAutoReplyMessage('sms', settings, 14)).toBe(null);
	});

	it('replaces {date} placeholder with next business day', () => {
		// Fix "today" so we get predictable next business day
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-02-14T20:00:00Z')); // Saturday 8pm
		const settings = getDefaultAutoReplySettings();
		settings.textAutoReply = true;
		settings.afterHoursMessage = 'We will reply by {date}.';
		const msg = getAutoReplyMessage('sms', settings, 20);
		vi.useRealTimers();
		expect(msg).toBeDefined();
		expect(msg).toContain('Monday'); // next business day after Saturday
		expect(msg).not.toContain('{date}');
	});

	it('returns leadform message when source is leadform', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-02-16T14:00:00Z')); // Monday 2pm – business hours
		const settings = getDefaultAutoReplySettings();
		settings.textAutoReply = true;
		settings.leadformBusinessHoursMessage = 'Thanks for the form!';
		const msg = getAutoReplyMessage('leadform', settings, 14);
		vi.useRealTimers();
		expect(msg).toBe('Thanks for the form!');
	});
});

describe('isBusinessHours', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns isClosed when day is not open', () => {
		vi.setSystemTime(new Date('2026-02-15T14:00:00Z')); // Sunday
		const hours: BusinessHoursConfig = {
			sunday: { isOpen: false, hours: null },
			monday: { isOpen: true, hours: '9:00 AM - 5:00 PM' }
		};
		const result = isBusinessHours(14, hours);
		expect(result.isClosed).toBe(true);
		expect(result.isOpen).toBe(false);
	});

	it('returns isOpen when within hours on open day', () => {
		vi.setSystemTime(new Date('2026-02-16T14:00:00Z')); // Monday 2pm UTC
		const hours: BusinessHoursConfig = {
			monday: { isOpen: true, hours: '8:00 AM - 6:00 PM' }
		};
		const result = isBusinessHours(14, hours);
		expect(result.isOpen).toBe(true);
		expect(result.isClosed).toBe(false);
	});
});

describe('getNextBusinessDay', () => {
	it('returns string (next business day or fallback)', () => {
		const hours = getDefaultAutoReplySettings().businessHours;
		const result = getNextBusinessDay(hours);
		expect(typeof result).toBe('string');
		expect(result.length).toBeGreaterThan(0);
	});
});
