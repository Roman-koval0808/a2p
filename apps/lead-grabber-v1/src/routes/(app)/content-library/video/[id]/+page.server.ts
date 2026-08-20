import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { prisma } from '$lib/db';
import { resolveCompanyId, getContentById, getCompanyReps } from '$lib/server/viewroom';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) {
		throw error(401, 'Unauthorized');
	}

	const companyId = resolveCompanyId(locals.user);

	try {
		const video = await getContentById(params.id);
		if (!video) {
			throw error(404, 'Video not found');
		}

		if (video.owner_company !== companyId && !video.shared_with?.includes(companyId)) {
			throw error(403, 'You do not have access to this video');
		}

		let representatives: any[] = [];
		if (video.owner_company === companyId) {
			representatives = companyId ? await getCompanyReps(companyId) : [];
		}

		return {
			video,
			representatives
		};
	} catch (err) {
		console.error('Error fetching video:', err);
		throw error(404, 'Video not found');
	}
};

export const actions: Actions = {
	shareVideo: async ({ request, locals, params }) => {
		if (!locals.user) {
			throw error(401, 'Unauthorized');
		}

		const companyId = resolveCompanyId(locals.user);

		try {
			const video = await prisma.contentLibraryItem.findUnique({ where: { id: params.id } });
			if (!video || video.ownerCompanyId !== companyId) {
				throw error(403, 'Only the owner can share this video');
			}

			const data = await request.json();
			const { representatives } = data;

			await prisma.contentLibraryItem.update({
				where: { id: params.id },
				data: { sharedWith: Array.isArray(representatives) ? representatives : [] }
			});

			return { type: 'success' };
		} catch (err) {
			console.error('Error sharing video:', err);
			return fail(400, { type: 'error', message: 'Failed to share video' });
		}
	}
};