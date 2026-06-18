import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized, pagination } from '$lib/api/spec';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const contact = await prisma.contact.findFirst({
		where: { id: params.contactId, companyId: auth.companyId },
		select: { id: true, name: true, email: true }
	});
	if (!contact) {
		return json({ success: false, error: 'Contact not found', code: 404 }, { status: 404 });
	}

	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
	const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)));
	const skip = (page - 1) * limit;
	const email = contact.email ?? '';

	const where = {
		companyId: auth.companyId,
		type: 'email' as const,
		OR: [{ customerId: contact.id }, { source: email }, { destination: email }]
	};
	const [total, logs] = await Promise.all([
		prisma.communicationLog.count({ where }),
		prisma.communicationLog.findMany({
			where,
			skip,
			take: limit,
			orderBy: { created: 'desc' }
		})
	]);

	const data = logs.map((l) => ({
		id: l.id,
		direction: l.direction,
		subject: (l.metadata as { subject?: string })?.subject ?? l.summary ?? '',
		body: l.content ?? '',
		status: l.status === 'success' || l.status === 'completed' ? 'delivered' : l.status,
		timestamp: l.created.toISOString()
	}));

	return json({
		success: true,
		data,
		contact: { id: contact.id, name: contact.name ?? '', email: contact.email ?? '' },
		pagination: pagination(page, limit, total)
	});
};
