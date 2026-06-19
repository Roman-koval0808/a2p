import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getContactsByCompany } from '$lib/utils/contacts';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;

	if (!user) {
		throw redirect(303, '/login');
	}

	const [contacts, phoneNumbers] = await Promise.all([
		getContactsByCompany(user.company.id),
		locals.prisma.companyPhoneNumber.findMany({
			where: { companyId: user.company.id }
		})
	]);

	return {
		contacts,
		phoneNumbers
	};
};
