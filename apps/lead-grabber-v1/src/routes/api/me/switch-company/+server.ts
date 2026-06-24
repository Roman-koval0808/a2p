import { json } from '@sveltejs/kit';
import { prisma } from '$lib/db';
import { invalidateUserCache } from '$lib/auth';

export const POST = async ({ request, locals }) => {
	const user = locals.user;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = await request.json();
		const { companyId } = body;

		if (!companyId) {
			return json({ error: 'Company ID is required' }, { status: 400 });
		}

		// Verify the user is allowed to switch to this company
		if (user.platformRole !== 'CLEARSKY_ADMIN') {
			const isMember = await prisma.companyMember.findUnique({
				where: {
					userId_companyId: {
						userId: user.id,
						companyId: companyId
					}
				}
			});

			if (!isMember) {
				return json({ error: 'Forbidden: You do not have access to this company' }, { status: 403 });
			}
		} else {
			// Verify the company exists
			const company = await prisma.company.findUnique({
				where: { id: companyId }
			});
			if (!company) {
				return json({ error: 'Company not found' }, { status: 404 });
			}
		}

		// Update the user's active company context
		await prisma.user.update({
			where: { id: user.id },
			data: { companyId: companyId }
		});

		// Invalidate the auth cache so the next request pulls the new company context
		invalidateUserCache(user.id);

		return json({ success: true, companyId });
	} catch (error) {
		console.error('[switch-company] Error:', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
