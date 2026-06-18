import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';

export const GET: RequestHandler = async ({ url, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const search = (url.searchParams.get('search') ?? '').trim();
	const members = await prisma.companyMember.findMany({
		where: {
			companyId: auth.companyId,
			status: 'active',
			...(search && {
				user: {
					OR: [
						{ name: { contains: search, mode: 'insensitive' } },
						{ email: { contains: search, mode: 'insensitive' } }
					]
				}
			})
		},
		include: { user: { select: { id: true, name: true, email: true, avatar: true } } }
	});

	const data = members.map((m) => ({
		id: m.userId,
		name: m.user.name ?? m.user.email ?? 'Unknown',
		email: m.user.email ?? '',
		phone: null as string | null,
		department: (m.role as string) ?? null,
		avatarUrl: m.user.avatar ?? null
	}));
	return json({ success: true, data });
};
