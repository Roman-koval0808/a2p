import { prisma } from '$lib/db';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user || !locals.user.company) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const members = await prisma.companyMember.findMany({
			where: {
				companyId: locals.user.company.id,
				status: 'active'
			},
			take: 50,
			include: {
				user: {
					select: {
						id: true,
						name: true,
						email: true
					}
				}
			},
			orderBy: {
				created: 'desc'
			}
		});

		return json({
			success: true,
			data: members.map((member) => ({
				id: member.id,
				user: member.user.id,
				expand: {
					user: member.user
				},
				role: member.role,
				status: member.status
			}))
		});
	} catch (error: any) {
		console.error('Error fetching company members:', error);
		return json(
			{ success: false, error: error.message || 'Failed to fetch company members' },
			{ status: 500 }
		);
	}
};
