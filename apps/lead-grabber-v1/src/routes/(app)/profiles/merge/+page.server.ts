import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listMergeCandidates } from '$lib/server/identity/merge-service';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) throw redirect(303, '/login');
	if (!user.company) throw redirect(303, '/create-company');

	const [pending, resolved] = await Promise.all([
		listMergeCandidates(user.company.id, 'pending'),
		listMergeCandidates(user.company.id, 'merged')
	]);

	return {
		candidates: JSON.parse(JSON.stringify(pending)),
		recentlyMerged: JSON.parse(JSON.stringify(resolved)).slice(0, 10)
	};
};
