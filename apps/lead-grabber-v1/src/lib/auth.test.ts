import { describe, it, expect } from 'vitest';
import { createSessionCookie, parseSessionCookie } from './auth';

describe('createSessionCookie', () => {
	it('returns cookie string with app_session and token', () => {
		const token = 'jwt-token-xyz';
		const cookie = createSessionCookie(token);
		expect(cookie).toContain('app_session=jwt-token-xyz');
		expect(cookie).toContain('Path=/');
		expect(cookie).toContain('SameSite=Lax');
		expect(cookie).toContain('Max-Age=');
	});
});

describe('parseSessionCookie', () => {
	it('returns null for null or empty header', () => {
		expect(parseSessionCookie(null)).toBe(null);
		expect(parseSessionCookie('')).toBe(null);
	});

	it('extracts token from Cookie header', () => {
		expect(parseSessionCookie('app_session=abc123; other=value')).toBe('abc123');
	});

	it('returns null when app_session not present', () => {
		expect(parseSessionCookie('other=value; foo=bar')).toBe(null);
	});

	it('handles single cookie', () => {
		expect(parseSessionCookie('app_session=only-token')).toBe('only-token');
	});
});
