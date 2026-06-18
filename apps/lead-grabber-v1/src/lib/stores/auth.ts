import { writable } from 'svelte/store';
import type { User } from '@prisma/client';

interface AuthStore {
	user: (User & { company: { id: string; name: string | null } | null }) | null;
	token: string | null;
}

function createAuthStore() {
	const { subscribe, set, update } = writable<AuthStore>({
		user: null,
		token: null
	});

	// Load from cookie on client side
	if (typeof window !== 'undefined') {
		const cookies = document.cookie.split(';').map((c) => c.trim());
		const sessionCookie = cookies.find((c) => c.startsWith('app_session='));
		if (sessionCookie) {
			const token = sessionCookie.split('=')[1];
			// Token will be validated server-side, we just store it here
			update((store) => ({ ...store, token }));
		}
	}

	return {
		subscribe,
		setUser: (
			user: (User & { company: { id: string; name: string | null } | null }) | null,
			token: string | null = null
		) => {
			set({ user, token });
		},
		logout: async () => {
			// Clear cookie
			if (typeof window !== 'undefined') {
				document.cookie = 'app_session=; Path=/; HttpOnly=false; SameSite=Lax; Max-Age=0';
			}
			set({ user: null, token: null });
		}
	};
}

export const authStore = createAuthStore();
