import { describe, it, expect } from 'vitest';
import { getFileUrl } from './file-url';

describe('getFileUrl', () => {
	it('returns null for null or undefined', () => {
		expect(getFileUrl(null)).toBe(null);
		expect(getFileUrl(undefined)).toBe(null);
	});

	it('returns path as-is when already http(s)', () => {
		expect(getFileUrl('https://cdn.example.com/file.mp3')).toBe('https://cdn.example.com/file.mp3');
		expect(getFileUrl('http://example.com/path')).toBe('http://example.com/path');
	});

	it('returns path as-is when starting with /', () => {
		expect(getFileUrl('/uploads/ivr/greeting.mp3')).toBe('/uploads/ivr/greeting.mp3');
	});

	it('prepends / when path has no leading slash', () => {
		expect(getFileUrl('uploads/file.mp3')).toBe('/uploads/file.mp3');
	});
});
