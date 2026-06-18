import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';

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

export const GET: RequestHandler = async ({ params, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const contact = await prisma.contact.findFirst({
		where: { id: params.id, companyId: auth.companyId },
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
	if (!contact) {
		return json({ success: false, error: 'Profile not found', code: 404 }, { status: 404 });
	}
	return json({ success: true, data: toSpecProfile(contact) });
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const contact = await prisma.contact.findFirst({
		where: { id: params.id, companyId: auth.companyId }
	});
	if (!contact) {
		return json({ success: false, error: 'Profile not found', code: 404 }, { status: 404 });
	}

	const body = await request.json().catch(() => ({}));
	const data: Record<string, string | null> = {};
	if (typeof body.name === 'string') data.name = body.name.trim();
	if (typeof body.phone === 'string') data.phone = body.phone.trim();
	if (typeof body.email === 'string') data.email = body.email.trim();
	if (typeof body.company === 'string') data.companyName = body.company.trim();
	if (typeof body.address === 'string') data.address = body.address.trim();
	if (typeof body.notes === 'string') data.notes = body.notes.trim();

	const updated = await prisma.contact.update({
		where: { id: params.id },
		data,
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
	return json({
		success: true,
		data: toSpecProfile(updated),
		message: 'Profile updated successfully'
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const contact = await prisma.contact.findFirst({
		where: { id: params.id, companyId: auth.companyId }
	});
	if (!contact) {
		return json({ success: false, error: 'Profile not found', code: 404 }, { status: 404 });
	}
	await prisma.contact.delete({ where: { id: params.id } });
	return json({ success: true, message: 'Profile deleted successfully' });
};
