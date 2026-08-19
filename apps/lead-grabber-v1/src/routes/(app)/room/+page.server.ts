import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolveCompanyId, getRoomsForCompany, getCompanyRepsIncludeInactive, getCompanyContent } from '$lib/server/viewroom';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(303, '/login');
	}

	const companyId = resolveCompanyId(locals.user);

	try {
		const rooms = companyId ? await getRoomsForCompany(companyId) : [];
		const representatives = companyId ? await getCompanyRepsIncludeInactive(companyId) : [];
		const locations: any[] = [];

		const allContent = companyId ? await getCompanyContent(companyId) : [];
		const hostContent = allContent.filter((c: any) => (c.library_type ?? []).includes('host'));
		const repContent = allContent.filter((c: any) => (c.library_type ?? []).includes('representative'));

		return {
			rooms,
			representatives,
			locations,
			hostContent,
			repContent
		};
	} catch (err) {
		console.error('Error fetching data:', err);
		return {
			rooms: [],
			representatives: [],
			locations: [],
			hostContent: [],
			repContent: []
		};
	}
};