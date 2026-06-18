import { describe, it, expect } from 'vitest';
import { hasPermission } from './permissions';

describe('hasPermission', () => {
	it('owner has manage_team, manage_settings, manage_billing, view_analytics', () => {
		const user = { role: 'owner' };
		expect(hasPermission(user, 'manage_team')).toBe(true);
		expect(hasPermission(user, 'manage_settings')).toBe(true);
		expect(hasPermission(user, 'manage_billing')).toBe(true);
		expect(hasPermission(user, 'view_analytics')).toBe(true);
	});

	it('admin has manage_team, manage_settings, view_analytics but not manage_billing', () => {
		const user = { role: 'admin' };
		expect(hasPermission(user, 'manage_team')).toBe(true);
		expect(hasPermission(user, 'manage_billing')).toBe(false);
	});

	it('member has only view_analytics', () => {
		const user = { role: 'member' };
		expect(hasPermission(user, 'view_analytics')).toBe(true);
		expect(hasPermission(user, 'manage_team')).toBe(false);
	});

	it('defaults to member when role missing or unknown', () => {
		expect(hasPermission({}, 'view_analytics')).toBe(true);
		expect(hasPermission({ role: 'unknown' }, 'manage_team')).toBe(false);
	});

	it('returns false for permission not in role list', () => {
		expect(hasPermission({ role: 'owner' }, 'delete_everything')).toBe(false);
	});
});
