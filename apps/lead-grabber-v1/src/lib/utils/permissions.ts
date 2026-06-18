export function hasPermission(user: any, permission: string): boolean {
	const rolePermissions = {
		owner: ['manage_team', 'manage_settings', 'manage_billing', 'view_analytics'],
		admin: ['manage_team', 'manage_settings', 'view_analytics'],
		member: ['view_analytics']
	};

	const userRole = user?.role || 'member';
	return rolePermissions[userRole]?.includes(permission) || false;
}
