import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';

export const GET: RequestHandler = async ({ params, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const member = await prisma.companyMember.findFirst({
		where: {
			userId: params.id,
			companyId: auth.companyId,
			status: 'active'
		},
		include: { user: { select: { id: true, name: true, email: true, avatar: true } } }
	});
	if (!member) {
		return json({ success: false, error: 'Representative not found', code: 404 }, { status: 404 });
	}

	const data = {
		id: member.userId,
		name: member.user.name ?? member.user.email ?? 'Unknown',
		email: member.user.email ?? '',
		phone: null as string | null,
		department: (member.role as string) ?? null,
		avatarUrl: member.user.avatar ?? null
	};
	return json({ success: true, data });
};
