import { describe, it, expect } from 'vitest';
import {
	isValidTime24,
	parseTime24,
	toTime24,
	formatTime12,
	compareTimes,
	invalidScheduleDays,
	parseTime12,
	parseRange12,
	formatRange12
} from './time';

describe('isValidTime24', () => {
	it('accepts canonical times', () => {
		expect(isValidTime24('00:00')).toBe(true);
		expect(isValidTime24('08:00')).toBe(true);
		expect(isValidTime24('23:59')).toBe(true);
	});

	it('rejects out-of-range and malformed values', () => {
		expect(isValidTime24('24:00')).toBe(false);
		expect(isValidTime24('08:60')).toBe(false);
		expect(isValidTime24('8:00')).toBe(false);
		expect(isValidTime24('0800')).toBe(false);
		expect(isValidTime24('')).toBe(false);
		expect(isValidTime24(null)).toBe(false);
		expect(isValidTime24(undefined)).toBe(false);
	});
});

describe('parseTime24', () => {
	it('round-trips valid values and nulls the rest', () => {
		expect(parseTime24('17:30')).toEqual({ hour: 17, minute: 30 });
		expect(parseTime24('bad')).toBeNull();
		expect(parseTime24('')).toBeNull();
	});
});

describe('toTime24', () => {
	it('handles the 12/24 boundaries', () => {
		expect(toTime24(12, 0, 'AM')).toBe('00:00');
		expect(toTime24(12, 30, 'PM')).toBe('12:30');
		expect(toTime24(8, 0, 'AM')).toBe('08:00');
		expect(toTime24(5, 30, 'PM')).toBe('17:30');
	});
});

describe('formatTime12', () => {
	it('formats for display', () => {
		expect(formatTime12('08:00')).toBe('8:00 AM');
		expect(formatTime12('17:30')).toBe('5:30 PM');
		expect(formatTime12('00:00')).toBe('12:00 AM');
		expect(formatTime12('')).toBeNull();
		expect(formatTime12('nope')).toBeNull();
	});
});

describe('compareTimes', () => {
	it('orders times', () => {
		expect(compareTimes('08:00', '17:00')).toBeLessThan(0);
		expect(compareTimes('17:00', '08:00')).toBeGreaterThan(0);
		expect(compareTimes('09:00', '09:00')).toBe(0);
	});
});

describe('invalidScheduleDays', () => {
	it('accepts a full week of proper shifts and days off', () => {
		expect(
			invalidScheduleDays({
				Monday: { start: '08:00', end: '17:00' },
				Sunday: { start: '', end: '' }
			})
		).toEqual([]);
	});

	it('flags end before or equal to start', () => {
		expect(invalidScheduleDays({ Monday: { start: '17:00', end: '08:00' } })).toEqual(['Monday']);
		expect(invalidScheduleDays({ Monday: { start: '09:00', end: '09:00' } })).toEqual(['Monday']);
	});

	it('flags malformed times', () => {
		expect(invalidScheduleDays({ Monday: { start: '25:00', end: '17:00' } })).toEqual(['Monday']);
		expect(invalidScheduleDays({ Monday: { start: '08:00', end: 'nope' } })).toEqual(['Monday']);
	});

	it('flags a half-filled day but not a fully empty one', () => {
		expect(invalidScheduleDays({ Monday: { start: '08:00', end: '' } })).toEqual(['Monday']);
		expect(invalidScheduleDays({ Monday: { start: '', end: '17:00' } })).toEqual(['Monday']);
		expect(invalidScheduleDays({ Monday: { start: '', end: '' } })).toEqual([]);
	});
});

describe('parseRange12 / formatRange12', () => {
	it('round-trips the auto-reply "8:00 AM - 6:00 PM" format', () => {
		expect(parseRange12('8:00 AM - 6:00 PM')).toEqual({ start: '08:00', end: '18:00' });
		expect(parseRange12('12:00 AM - 12:00 PM')).toEqual({ start: '00:00', end: '12:00' });
		expect(formatRange12('08:00', '18:00')).toBe('8:00 AM - 6:00 PM');
	});

	it('rejects malformed ranges', () => {
		expect(parseRange12(null)).toBeNull();
		expect(parseRange12('')).toBeNull();
		expect(parseRange12('8:00 AM')).toBeNull();
		expect(formatRange12('bad', '18:00')).toBe('');
	});

	it('parses a single 12-hour time', () => {
		expect(parseTime12('12:00 AM')).toEqual({ hour: 0, minute: 0 });
		expect(parseTime12('12:00 PM')).toEqual({ hour: 12, minute: 0 });
		expect(parseTime12('5:30 PM')).toEqual({ hour: 17, minute: 30 });
		expect(parseTime12('13:00 PM')).toBeNull();
	});
});
