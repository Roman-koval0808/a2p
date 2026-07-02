import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';
import { getProfileDetails } from '$lib/server/profiledb/profiles';

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

	let contact = await prisma.contact.findFirst({
		where: { id: params.id, companyId: auth.companyId }
	});

	if (!contact) {
		let name = 'Unknown';
		let phone = '';
		let email = '';
		try {
			const result = await getProfileDetails(auth.companyId, params.id);
			if (result.status >= 200 && result.status < 300) {
				const cdp = result.body;
				name = cdp.name || 'Unknown';
				phone = cdp.phone || '';
				email = cdp.email || '';
			} else {
				return json({ success: false, error: 'Profile not found', code: 404 }, { status: 404 });
			}
		} catch (e) {
			console.error('Error fetching from ProfileDB:', e);
			return json({ success: false, error: 'Profile not found', code: 404 }, { status: 404 });
		}

		contact = await prisma.contact.create({
			data: {
				id: params.id,
				companyId: auth.companyId,
				name,
				phone,
				email
			}
		});
	}

	return json({ success: true, data: toSpecProfile(contact) });
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	let contact = await prisma.contact.findFirst({
		where: { id: params.id, companyId: auth.companyId }
	});

	if (!contact) {
		let name = 'Unknown';
		let phone = '';
		let email = '';
		try {
			const result = await getProfileDetails(auth.companyId, params.id);
			if (result.status >= 200 && result.status < 300) {
				const cdp = result.body;
				name = cdp.name || 'Unknown';
				phone = cdp.phone || '';
				email = cdp.email || '';
			}
		} catch (e) {
			console.error('Error fetching from ProfileDB:', e);
		}

		contact = await prisma.contact.create({
			data: {
				id: params.id,
				companyId: auth.companyId,
				name,
				phone,
				email
			}
		});
	}

	const body = await request.json().catch(() => ({}));
	const data: Record<string, any> = {};
	if (typeof body.name === 'string') data.name = body.name.trim();
	if (typeof body.phone === 'string') data.phone = body.phone.trim();
	if (typeof body.email === 'string') data.email = body.email.trim();
	if (typeof body.company === 'string') data.companyName = body.company.trim();
	if (typeof body.address === 'string') data.address = body.address.trim();
	if (typeof body.notes === 'string') data.notes = body.notes.trim();

	if ('accountBalance' in body) {
		const val = body.accountBalance;
		if (val === null || val === undefined || val === '') {
			data.accountBalance = null;
		} else {
			const parsed = parseFloat(String(val));
			data.accountBalance = isNaN(parsed) ? null : parsed;
		}
	}

	data.updated = new Date();

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
	if (contact) {
		await prisma.contact.delete({ where: { id: params.id } });
	}
	return json({ success: true, message: 'Profile deleted successfully' });
};
