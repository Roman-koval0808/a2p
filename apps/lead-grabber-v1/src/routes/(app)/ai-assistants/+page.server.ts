import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { prisma } from '$lib/db';
import { resolveCompanyId } from '$lib/server/viewroom';

/**
 * AI assistants list, ported from the standalone viewroom app.
 * The viewroom filtered rooms by `owner_company = user.id`, conflating the user with their company;
 * here both assistants and rooms are scoped by the resolved company id.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');

	const companyId = resolveCompanyId(locals.user);
	if (!companyId) throw redirect(303, '/create-company');

	try {
		const [aiAssistants, viewrooms] = await Promise.all([
			prisma.aiAssistant.findMany({
				where: { companyId },
				orderBy: { created: 'desc' }
			}),
			prisma.viewRoom.findMany({
				where: { ownerCompanyId: companyId },
				select: { id: true, title: true },
				orderBy: { title: 'asc' }
			})
		]);

		return { aiAssistants, viewrooms };
	} catch (err) {
		console.error('Error loading AI assistants:', err);
		return { aiAssistants: [], viewrooms: [] };
	}
};
