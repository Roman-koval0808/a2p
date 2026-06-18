import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized, pagination } from '$lib/api/spec';

function toSpecProfile(c: {
	id: string;
	name: string | null;
	phone: string | null;
	email: string | null;
	companyName: string | null;
	address: string | null;
	notes: string | null;
	created: Date;
	updated: Date;
}) {
	return {
		id: c.id,
		name: c.name ?? '',
		phone: c.phone ?? '',
		email: c.email ?? '',
		company: c.companyName ?? '',
		address: c.address ?? '',
		notes: c.notes ?? '',
		createdAt: c.created.toISOString(),
		updatedAt: c.updated.toISOString()
	};
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
	const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));
	const search = (url.searchParams.get('search') ?? '').trim();
	const skip = (page - 1) * limit;

	const where: { companyId: string; OR?: unknown[] } = { companyId: auth.companyId };
	if (search) {
		where.OR = [
			{ name: { contains: search, mode: 'insensitive' } },
			{ phone: { contains: search, mode: 'insensitive' } },
			{ email: { contains: search, mode: 'insensitive' } },
			{ companyName: { contains: search, mode: 'insensitive' } }
		];
	}

	const [total, contacts] = await Promise.all([
		prisma.contact.count({ where }),
		prisma.contact.findMany({
			where,
			skip,
			take: limit,
			orderBy: { updated: 'desc' },
			select: {
				id: true,
				name: true,
				phone: true,
				email: true,
				companyName: true,
				address: true,
				notes: true,
				created: true,
				updated: true
			}
		})
	]);

	return json({
		success: true,
		data: contacts.map(toSpecProfile),
		pagination: pagination(page, limit, total)
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const body = await request.json().catch(() => ({}));
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
	const email = typeof body.email === 'string' ? body.email.trim() : null;
	const company = typeof body.company === 'string' ? body.company.trim() : null;
	const address = typeof body.address === 'string' ? body.address.trim() : null;
	const notes = typeof body.notes === 'string' ? body.notes.trim() : null;

	if (!name) {
		return json({ success: false, error: 'name is required', code: 400 }, { status: 400 });
	}

	const contact = await prisma.contact.create({
		data: {
			companyId: auth.companyId,
			name,
			phone: phone || undefined,
			email: email ?? undefined,
			companyName: company ?? undefined,
			address: address ?? undefined,
			notes: notes ?? undefined
		},
		select: {
			id: true,
			name: true,
			phone: true,
			email: true,
			companyName: true,
			address: true,
			notes: true,
			created: true,
			updated: true
		}
	});

	return json(
		{ success: true, data: toSpecProfile(contact), message: 'Profile created successfully' },
		{ status: 201 }
	);
};
