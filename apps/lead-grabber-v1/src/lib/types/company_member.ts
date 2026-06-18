export type MemberRole = 'owner' | 'admin' | 'member';

export interface Permission {
	create: boolean;
	read: boolean;
	update: boolean;
	delete: boolean;
}

export interface Permissions {
	leads: Permission;
	members: Permission;
	settings: Permission;
	billing: Permission;
	reports: Permission;
}

export interface CompanyMember {
	id: string;
	user: string;
	company: string;
	role: MemberRole;
	permissions: Permissions;
	created: string;
	updated: string;
}

export const DEFAULT_PERMISSIONS: Record<MemberRole, Permissions> = {
	owner: {
		leads: { create: true, read: true, update: true, delete: true },
		members: { create: true, read: true, update: true, delete: true },
		settings: { create: true, read: true, update: true, delete: true },
		billing: { create: true, read: true, update: true, delete: true },
		reports: { create: true, read: true, update: true, delete: true }
	},
	admin: {
		leads: { create: true, read: true, update: true, delete: true },
		members: { create: true, read: true, update: true, delete: false },
		settings: { create: false, read: true, update: true, delete: false },
		billing: { create: false, read: true, update: false, delete: false },
		reports: { create: true, read: true, update: true, delete: true }
	},
	member: {
		leads: { create: true, read: true, update: true, delete: false },
		members: { create: false, read: true, update: false, delete: false },
		settings: { create: false, read: true, update: false, delete: false },
		billing: { create: false, read: false, update: false, delete: false },
		reports: { create: false, read: true, update: false, delete: false }
	}
};
