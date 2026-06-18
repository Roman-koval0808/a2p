import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const log = await prisma.communicationLog.findFirst({
		where: { id: params.id, companyId: auth.companyId },
		include: { assignedMembers: true }
	});
	if (!log) {
		return json(
			{ success: false, error: 'Communication log not found', code: 404 },
			{ status: 404 }
		);
	}

	const body = await request.json().catch(() => ({}));
	const status = body.status; // unassigned | assigned_to_dept | assigned_to_agent
	const department = body.department ?? null;
	const assignedAgent = body.assignedAgent ?? null;

	if (!['unassigned', 'assigned_to_dept', 'assigned_to_agent'].includes(status)) {
		return json({ success: false, error: 'Invalid status', code: 400 }, { status: 400 });
	}

	const metadata = (log.metadata as Record<string, unknown>) ?? {};
	metadata.assignmentStatus = status;
	metadata.department = department;
	metadata.assignedAgent = assignedAgent;

	// If assigned_to_agent, resolve user by name and add to assignedMembers
	if (status === 'assigned_to_agent' && assignedAgent) {
		const user = await prisma.user.findFirst({
			where: {
				companyId: auth.companyId,
				OR: [
					{ name: { equals: assignedAgent, mode: 'insensitive' } },
					{ email: { equals: assignedAgent, mode: 'insensitive' } }
				]
			}
		});
		if (user) {
			await prisma.communicationLogAssignedMember.deleteMany({
				where: { communicationLogId: log.id }
			});
			await prisma.communicationLogAssignedMember.create({
				data: { communicationLogId: log.id, userId: user.id }
			});
		}
	} else if (status === 'unassigned') {
		await prisma.communicationLogAssignedMember.deleteMany({
			where: { communicationLogId: log.id }
		});
	}

	await prisma.communicationLog.update({
		where: { id: params.id },
		data: { metadata, updated: new Date() }
	});

	return json({ success: true, message: 'Communication log assigned successfully' });
};
