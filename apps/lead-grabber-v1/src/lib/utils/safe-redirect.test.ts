import { describe, it, expect } from 'vitest';
import { safeNext } from './safe-redirect';

describe('safeNext', () => {
	it('accepts a root-relative internal path', () => {
		expect(safeNext('/dashboard')).toBe('/dashboard');
		expect(safeNext('/tasks?status=todo')).toBe('/tasks?status=todo');
	});

	it('rejects nothing and non-path values', () => {
		expect(safeNext(null)).toBeNull();
		expect(safeNext(undefined)).toBeNull();
		expect(safeNext('')).toBeNull();
		expect(safeNext('dashboard')).toBeNull(); // not root-relative
		expect(safeNext('https://evil.example')).toBeNull();
	});

	it('rejects protocol-relative URLs (open redirect)', () => {
		expect(safeNext('//evil.example')).toBeNull();
	});

	it('rejects auth pages so the login redirect cannot loop', () => {
		expect(safeNext('/login')).toBeNull();
		expect(safeNext('/logout')).toBeNull();
		expect(safeNext('/signup')).toBeNull();
	});
});
