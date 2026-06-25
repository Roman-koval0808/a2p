import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user?.platformRole === 'CLEARSKY_ADMIN') {
		throw redirect(303, '/clearsky-admin');
	}
	throw redirect(303, '/dashboard');
};
