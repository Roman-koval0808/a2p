import { prisma } from '$lib/db';
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) {
		throw redirect(303, '/login');
	}

	const companyId = locals.user.companyId ?? locals.user.company?.id;
	if (!companyId) {
		throw error(403, 'Access denied');
	}

	try {
		const userId = params.id;

		// Get user details
		const user = await prisma.user.findUnique({
			where: { id: userId },
			include: { company: true }
		});

		if (!user) {
			throw error(404, 'User not found');
		}

		// Verify user is in the same company
		if (user.companyId !== companyId) {
			throw error(403, 'Access denied');
		}

		// Get company member info
		const member = await prisma.companyMember.findFirst({
			where: {
				userId,
				companyId,
				status: 'active'
			}
		});

		// Get messages assigned to this user
		const assignedMessages = await prisma.message.findMany({
			where: {
				assignedToId: userId,
				companyId
			},
			orderBy: { updated: 'desc' },
			take: 50
		});

		// Get communication logs assigned to this user
		const assignedLogs = await prisma.communicationLog.findMany({
			where: {
				companyId,
				assignedMembers: {
					some: { userId }
				}
			},
			orderBy: { created: 'desc' },
			take: 200,
			include: { assignedMembers: true }
		});

		return {
			user: {
				id: user.id,
				name: user.name || user.email || 'Unknown',
				email: user.email || '',
				avatar: user.avatar || null,
				created: user.created.toISOString()
			},
			member: member
				? {
						id: member.id,
						role: member.role,
						joined_at: member.joinedAt?.toISOString() ?? ''
					}
				: null,
			assignedMessages,
			assignedLogs
		};
	} catch (err: unknown) {
		if (
			err &&
			typeof err === 'object' &&
			'status' in err &&
			(err.status === 403 || err.status === 404)
		) {
			throw error(
				(err as { status: number }).status,
				(err as { message?: string }).message || 'User not found'
			);
		}
		console.error('Error loading user profile:', err);
		throw error(500, 'Failed to load user profile');
	}
};
