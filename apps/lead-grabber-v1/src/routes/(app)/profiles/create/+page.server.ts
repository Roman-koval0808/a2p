import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createOrUpdateContact } from '$lib/utils/contacts';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user;
	if (!user) throw redirect(303, '/login');
	if (!user.company) throw redirect(303, '/create-company');

	const phone = url.searchParams.get('phone') || '';
	return { phone };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const user = locals.user;
		if (!user?.company) return fail(401, { error: 'Unauthorized' });

		const data = await request.formData();
		const name = data.get('name')?.toString() ?? '';
		const email = data.get('email')?.toString() ?? '';
		const phone = data.get('phone')?.toString() ?? '';

		if (!name && !email && !phone) {
			return fail(400, { error: 'At least one field (name, email, or phone) is required' });
		}

		try {
			await createOrUpdateContact({
				company_id: user.company.id,
				name: name || undefined,
				email: email || undefined,
				phone: phone || undefined
			});
		} catch (error) {
			console.error('Error creating profile:', error);
			return fail(500, { error: 'Failed to create profile' });
		}

		throw redirect(303, '/profiles');
	}
};
