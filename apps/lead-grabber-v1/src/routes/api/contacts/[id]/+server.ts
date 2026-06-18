import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized, specSuccess, notFound } from '$lib/api/spec';
import { normalizePhoneNumber } from '$lib/utils/phone';

function toSpecContact(c: {
	id: string;
	name: string | null;
	phone: string | null;
	email: string | null;
	companyName: string | null;
	contactType: string | null;
	avatarUrl: string | null;
	created: Date;
	updated: Date;
}) {
	return {
		id: c.id,
		name: c.name ?? '',
		phone: c.phone ?? '',
		email: c.email ?? '',
		company: c.companyName ?? '',
		type: c.contactType ?? 'phone',
		avatarUrl: c.avatarUrl,
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
			contactType: true,
			avatarUrl: true,
			created: true,
			updated: true
		}
	});
	if (!contact) return notFound('Contact not found');
	return specSuccess(toSpecContact(contact));
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const contact = await prisma.contact.findFirst({
		where: { id: params.id, companyId: auth.companyId }
	});
	if (!contact) return notFound('Contact not found');

	const body = await request.json().catch(() => ({}));
	const data: {
		name?: string;
		phone?: string;
		email?: string;
		companyName?: string;
		contactType?: string;
		avatarUrl?: string;
	} = {};
	if (typeof body.name === 'string') data.name = body.name.trim();
	if (typeof body.phone === 'string') data.phone = normalizePhoneNumber(body.phone);
	if (typeof body.email === 'string') data.email = body.email.trim();
	if (typeof body.company === 'string') data.companyName = body.company.trim();
	if (['phone', 'email', 'sms', 'facebook'].includes(body.type)) data.contactType = body.type;
	if (typeof body.avatarUrl === 'string') data.avatarUrl = body.avatarUrl.trim();

	const updated = await prisma.contact.update({
		where: { id: params.id },
		data,
		select: {
			id: true,
			name: true,
			phone: true,
			email: true,
			companyName: true,
			contactType: true,
			avatarUrl: true,
			created: true,
			updated: true
		}
	});
	return specSuccess(toSpecContact(updated), 'Contact updated successfully');
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const contact = await prisma.contact.findFirst({
		where: { id: params.id, companyId: auth.companyId }
	});
	if (!contact) return notFound('Contact not found');
	await prisma.contact.delete({ where: { id: params.id } });
	return specSuccess(null, 'Contact deleted successfully');
};
