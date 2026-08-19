import { json, type RequestHandler } from '@sveltejs/kit';
import { prisma } from '$lib/db';
import { toRepresentative, resolveCompanyId } from '$lib/server/viewroom';

export const GET: RequestHandler = async ({ params, locals }) => {
	const authUser = locals.user;
	if (!authUser) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}
	const companyId = resolveCompanyId(locals.user);

	const member = await prisma.companyMember.findFirst({
		where: {
			companyId,
			OR: [{ id: params.id }, { userId: params.id }]
		},
		include: { user: { select: { id: true, name: true, email: true, avatar: true } } }
	});
	if (!member) {
		return json({ success: false, error: 'Representative not found', code: 404 }, { status: 404 });
	}

	const representative = toRepresentative(member, member.user);
	const data = {
		id: member.userId,
		name: member.user.name ?? member.user.email ?? 'Unknown',
		email: member.user.email ?? '',
		phone: null as string | null,
		department: (member.role as string) ?? null,
		avatarUrl: member.user.avatar ?? null
	};
	return json({ success: true, data, representative });
};