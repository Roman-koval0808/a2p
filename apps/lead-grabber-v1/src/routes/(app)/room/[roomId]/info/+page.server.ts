import { redirect } from '@sveltejs/kit';
import { getRoomFull, getRepById, getCompanyReps, getCompanyContent, resolveCompanyId } from '$lib/server/viewroom';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) {
		throw redirect(303, '/login');
	}

	const companyId = resolveCompanyId(locals.user);

	try {
		const room = await getRoomFull(params.roomId);
		if (!room) {
			throw new Error('Room not found');
		}

		const representatives = companyId ? await getCompanyReps(companyId) : [];
		const locations: any[] = [];

		const allContent = companyId ? await getCompanyContent(companyId) : [];
		const hostContent = allContent.filter((c: any) => (c.library_type ?? []).includes('host'));
		const representativeContent = allContent.filter((c: any) => (c.library_type ?? []).includes('representative'));

		return { room, representatives, locations, hostContent, representativeContent };
	} catch (err) {
		console.error('Error fetching data:', err);
		return { room: null, representatives: [], locations: [], hostContent: [], representativeContent: [] };
	}
};