import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getContactsByCompany } from '$lib/utils/contacts';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;

	if (!user) {
		throw redirect(303, '/login');
	}

	const contacts = await getContactsByCompany(user.company.id);

	return {
		contacts
	};
};
