import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { prisma } from '$lib/db';
import { resolveCompanyId } from '$lib/server/viewroom';

/**
 * AI assistants list, ported from the standalone viewroom app.
 * The viewroom filtered rooms by `owner_company = user.id`, conflating the user with their company;
 * here both assistants and rooms are scoped by the resolved company id.
 *
 * The two queries are deliberately independent. They were originally one `Promise.all` inside a
 * single try/catch, which meant a failure in either returned BOTH as empty — so before the
 * `ai_assistants` migration was applied, `prisma.aiAssistant` threw "table does not exist" and the
 * symptom was an empty *ViewRoom* picker, pointing at entirely the wrong thing. Each query now
 * fails on its own and says so.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');

	const companyId = resolveCompanyId(locals.user);
	if (!companyId) throw redirect(303, '/create-company');

	const aiAssistants = await prisma.aiAssistant
		.findMany({ where: { companyId }, orderBy: { created: 'desc' } })
		.catch((err: any) => {
			// P2021 = the table is missing, i.e. the migration has not been applied yet.
			if (err?.code === 'P2021') {
				console.error(
					'[ai-assistants] the ai_assistants table does not exist — run the ' +
						'20260821000000_add_ai_assistants migration'
				);
			} else {
				console.error('[ai-assistants] could not load assistants:', err?.message || err);
			}
			return [];
		});

	const viewrooms = await prisma.viewRoom
		.findMany({
			where: { ownerCompanyId: companyId },
			select: { id: true, title: true },
			orderBy: { title: 'asc' }
		})
		.catch((err: any) => {
			console.error('[ai-assistants] could not load viewrooms:', err?.message || err);
			return [] as { id: string; title: string }[];
		});

	if (!viewrooms.length) {
		console.warn(`[ai-assistants] no viewrooms found for company ${companyId}`);
	}

	return { aiAssistants, viewrooms };
};
