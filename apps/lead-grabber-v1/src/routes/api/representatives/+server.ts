import { json, type RequestHandler } from '@sveltejs/kit';
import { prisma } from '$lib/db';
import { toRepresentative, resolveCompanyId } from '$lib/server/viewroom';

export const GET: RequestHandler = async ({ url, locals }) => {
	const authUser = locals.user;
	if (!authUser) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}
	const companyId = resolveCompanyId(locals.user);
	if (!companyId) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const search = (url.searchParams.get('search') ?? '').trim();
	const name = (url.searchParams.get('name') ?? '').trim();

	const members = await prisma.companyMember.findMany({
		where: {
			companyId,
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

	let reps = members.map((m) => toRepresentative(m, m.user));

	if (name) {
		const needle = name.toLowerCase();
		reps = reps.filter(
			(r) =>
				(r.name?.toLowerCase().includes(needle) ?? false) ||
				(`${r.first_name ?? ''} ${r.last_name ?? ''}`.toLowerCase().includes(needle) ?? false) ||
				(r.email?.toLowerCase().includes(needle) ?? false)
		);
	}

	// a2p legacy shape (id = userId)
	const data = members.map((m) => ({
		id: m.userId,
		name: m.user.name ?? m.user.email ?? 'Unknown',
		email: m.user.email ?? '',
		phone: null as string | null,
		department: (m.role as string) ?? null,
		avatarUrl: m.user.avatar ?? null
	}));

	return json({ success: true, data, representatives: reps });
};