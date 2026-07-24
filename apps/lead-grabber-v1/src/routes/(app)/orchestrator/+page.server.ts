import { prisma } from '$lib/db';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;

	if (!user) {
		throw redirect(303, '/login');
	}
	if (!user.company) {
		throw redirect(303, '/create-company');
	}

	const companyId = user.company.id;

	// Load Orchestrator State
	const containers = await prisma.commContainer.findMany({
		where: { companyId },
		orderBy: { lastActivityAt: 'desc' },
		include: {
			entries: { orderBy: { occurredAt: 'desc' } },
			timers: { orderBy: { fireAt: 'asc' } },
			commTasks: { orderBy: { due: 'asc' } },
			holds: { orderBy: { startTime: 'desc' } },
			approvals: { orderBy: { createdAt: 'desc' } },
			refAliases: true,
			customerProfile: true
		}
	});

	// For system auditing, fetch reassignment logs that point to these containers
	const containerIds = containers.map(c => c.id);
	const reassignments = await prisma.threadReassignmentLog.findMany({
		where: { toCommId: { in: containerIds } },
		orderBy: { createdAt: 'desc' }
	});

	return {
		user,
		containers,
		reassignments
	};
};
