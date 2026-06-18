import type { User } from '@prisma/client';
import { getContext, setContext } from 'svelte';
import type { Writable } from 'svelte/store';

type UserWithCompany = User & { company: { id: string; name: string | null } | null };

const userKey = Symbol('user');

export function setUserContext(user: Writable<UserWithCompany | null>) {
	setContext(userKey, user);
}

export function getUserContext() {
	return getContext<Writable<UserWithCompany | null>>(userKey);
}
