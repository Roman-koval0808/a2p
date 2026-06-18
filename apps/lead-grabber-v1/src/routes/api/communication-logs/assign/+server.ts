import { prisma } from '$lib/db';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMessagesForLog } from '$lib/utils/inbox-log-link';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || !locals.user.company) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const data = await request.json();
		const { logIds, endpoint, memberIds } = data;

		if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
			return json({ success: false, error: 'Member IDs are required' }, { status: 400 });
		}

		// Verify all members belong to the user's company
		const members = await prisma.companyMember.findMany({
			where: {
				companyId: locals.user.company.id,
				status: 'active',
				userId: {
					in: memberIds
				}
			},
			include: {
				user: {
					select: {
						id: true
					}
				}
			}
		});

		const validMemberIds = members.map((m) => m.userId).filter((id): id is string => Boolean(id));
		if (validMemberIds.length === 0) {
			return json({ success: false, error: 'No valid members found' }, { status: 400 });
		}

		// If logIds provided, assign to specific logs
		if (logIds && Array.isArray(logIds) && logIds.length > 0) {
			const logs = await prisma.communicationLog.findMany({
				where: {
					companyId: locals.user.company.id,
					id: {
						in: logIds
					}
				}
			});

			if (logs.length === 0) {
				return json({ success: false, error: 'No logs found' }, { status: 404 });
			}

			// Update each log with assigned members
			for (const log of logs) {
				// Remove existing assignments
				await prisma.communicationLogAssignedMember.deleteMany({
					where: {
						communicationLogId: log.id
					}
				});

				// Add new assignments
				await prisma.communicationLogAssignedMember.createMany({
					data: validMemberIds.map((userId) => ({
						communicationLogId: log.id,
						userId
					})),
					skipDuplicates: true
				});
			}

			// Find related messages by thread_id or source/contact, then update
			const firstMemberId = validMemberIds[0];
			const seenMessageIds = new Set<string>();
			let messagesUpdated = 0;
			if (firstMemberId) {
				try {
					for (const log of logs) {
						const msgs = await getMessagesForLog(prisma, log, locals.user!.company!.id);
						for (const m of msgs) {
							if (seenMessageIds.has(m.id)) continue;
							seenMessageIds.add(m.id);
							await prisma.message.update({
								where: { id: m.id },
								data: { assignedToId: firstMemberId, status: 'assigned' }
							});
							messagesUpdated++;
						}
					}
				} catch (err) {
					console.error('Error updating related messages:', err);
				}
			}

			const messageMsg = messagesUpdated > 0 ? ` and ${messagesUpdated} message(s)` : '';
			return json({
				success: true,
				updated: logs.length,
				messagesUpdated,
				message: `Assigned ${validMemberIds.length} member(s) to ${logs.length} log(s)${messageMsg}`
			});
		}

		// If endpoint provided, assign to all logs with that endpoint
		if (endpoint) {
			const logs = await prisma.communicationLog.findMany({
				where: {
					companyId: locals.user.company.id,
					destination: endpoint
				},
				take: 500
			});

			if (logs.length === 0) {
				return json({ success: false, error: 'No logs found for endpoint' }, { status: 404 });
			}

			// Update all logs with assigned members
			for (const log of logs) {
				await prisma.communicationLogAssignedMember.deleteMany({
					where: { communicationLogId: log.id }
				});
				await prisma.communicationLogAssignedMember.createMany({
					data: validMemberIds.map((userId) => ({
						communicationLogId: log.id,
						userId
					})),
					skipDuplicates: true
				});
			}

			const firstMemberId = validMemberIds[0];
			const seenMessageIds = new Set<string>();
			let messagesUpdated = 0;
			if (firstMemberId) {
				try {
					for (const log of logs) {
						const msgs = await getMessagesForLog(prisma, log, locals.user!.company!.id);
						for (const m of msgs) {
							if (seenMessageIds.has(m.id)) continue;
							seenMessageIds.add(m.id);
							await prisma.message.update({
								where: { id: m.id },
								data: { assignedToId: firstMemberId, status: 'assigned' }
							});
							messagesUpdated++;
						}
					}
				} catch (err) {
					console.error('Error updating related messages:', err);
				}
			}

			const messageMsg = messagesUpdated > 0 ? ` and ${messagesUpdated} message(s)` : '';
			return json({
				success: true,
				updated: logs.length,
				messagesUpdated,
				message: `Assigned ${validMemberIds.length} member(s) to ${logs.length} log(s) with endpoint "${endpoint}"${messageMsg}`
			});
		}

		return json(
			{ success: false, error: 'Either logIds or endpoint must be provided' },
			{ status: 400 }
		);
	} catch (error) {
		console.error('Error assigning members:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to assign members'
			},
			{ status: 500 }
		);
	}
};
