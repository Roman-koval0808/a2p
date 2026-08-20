import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolveCompanyId, getCompanyRepsIncludeInactive, getCompanyContent } from '$lib/server/viewroom';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/login');
	}

	const companyId = resolveCompanyId(locals.user);

	try {
		const representatives = companyId ? await getCompanyRepsIncludeInactive(companyId) : [];

		const content = companyId ? await getCompanyContent(companyId) : [];

		return {
			user: locals.user,
			content,
			representatives
		};
	} catch (err) {
		console.error('Error fetching content:', err);
		return {
			user: locals.user,
			content: [],
			representatives: []
		};
	}
};