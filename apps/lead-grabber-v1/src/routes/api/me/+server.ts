import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ success: false, error: 'Unauthorized', code: 401 }, { status: 401 });
	}

	const user = locals.user;
	let role: string | null = (user.role as string | null) ?? null;

	if (user.company?.id) {
		const membership = await locals.prisma.companyMember.findUnique({
			where: {
				userId_companyId: {
					userId: user.id,
					companyId: user.company.id
				}
			},
			select: { role: true }
		});
		role = (membership?.role as string | undefined) ?? role;
	}

	return json({
		success: true,
		data: {
			id: user.id,
			name: user.name ?? null,
			email: user.email,
			phone: null as string | null,
			avatar: user.avatar ?? null,
			company: user.company
				? {
						id: user.company.id,
						name: user.company.name ?? null
					}
				: null,
			role
		}
	});
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ success: false, error: 'Unauthorized', code: 401 }, { status: 401 });
	}

	try {
		const { name, email, avatar } = await request.json();
		const userId = locals.user.id;

		// Basic validation
		if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return json({ success: false, error: 'Invalid email format' }, { status: 400 });
		}

		// Check email uniqueness if changing email
		if (email && email !== locals.user.email) {
			const existing = await locals.prisma.user.findUnique({
				where: { email: email.toLowerCase() }
			});
			if (existing) {
				return json({ success: false, error: 'Email already in use' }, { status: 400 });
			}
		}

		const updatedUser = await locals.prisma.user.update({
			where: { id: userId },
			data: {
				...(name !== undefined && { name }),
				...(email !== undefined && { email: email.toLowerCase() }),
				...(avatar !== undefined && { avatar })
			},
			include: { company: true }
		});

		let role: string | null = (updatedUser.role as string | null) ?? null;
		if (updatedUser.companyId) {
			const membership = await locals.prisma.companyMember.findUnique({
				where: {
					userId_companyId: {
						userId: updatedUser.id,
						companyId: updatedUser.companyId
					}
				},
				select: { role: true }
			});
			role = (membership?.role as string | undefined) ?? role;
		}

		return json({
			success: true,
			data: {
				id: updatedUser.id,
				name: updatedUser.name ?? null,
				email: updatedUser.email,
				phone: null as string | null,
				avatar: updatedUser.avatar ?? null,
				company: updatedUser.company
					? {
							id: updatedUser.company.id,
							name: updatedUser.company.name ?? null
						}
					: null,
				role
			}
		});
	} catch (e) {
		console.error('PUT /api/me error:', e);
		return json(
			{ success: false, error: e instanceof Error ? e.message : 'Failed to update profile' },
			{ status: 500 }
		);
	}
};
