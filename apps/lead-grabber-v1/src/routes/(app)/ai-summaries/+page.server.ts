import { prisma } from '$lib/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.user.company) {
		return { logs: [] };
	}

	const companyId = locals.user.company.id;

	try {
		// Fetch only voice communication logs with summaries
		const dbLogs = await prisma.communicationLog.findMany({
			where: {
				companyId,
				type: 'voice',
				summary: { not: null }
			},
			include: {
				customer: true
			},
			orderBy: { created: 'desc' },
			take: 50
		});

		const logs = dbLogs.map((log) => {
			const meta = (log.metadata as any) || {};
			return {
				id: log.id,
				created: log.created.toISOString(),
				source: log.source || 'Unknown',
				destination: log.destination || 'Company Line',
				summary: log.summary || '',
				content: log.content || '',
				customerName: log.customer?.name || null,
				ivrIntent: meta.ivr_intent || null,
				urgency: meta.urgency || meta.urgency_gpt || 'medium',
				sentiment: meta.sentiment || 'Neutral',
				intent: meta.intent || meta.category_gpt || 'General',
				estimatedPrice: meta.estimatedPrice || null,
				actionItems: meta.actionItems || meta.tasks || []
			};
		});

		return { logs };
	} catch (err) {
		console.error('Error loading AI summaries:', err);
		return { logs: [] };
	}
};
