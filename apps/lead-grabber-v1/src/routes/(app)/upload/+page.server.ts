import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolveCompanyId, getCompanyReps } from '$lib/server/viewroom';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, 'Unauthorized');
	}
	const companyId = resolveCompanyId(locals.user);
	try {
		const representatives = companyId ? await getCompanyReps(companyId) : [];
		return {
			user: locals.user,
			representatives
		};
	} catch (err) {
		console.error('Error fetching representatives:', err);
		return {
			user: locals.user,
			representatives: []
		};
	}
};