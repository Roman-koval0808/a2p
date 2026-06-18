import { prisma } from '$lib/db';
import type { CommunicationType } from '@prisma/client';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user?.company) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const page = parseInt(url.searchParams.get('page') || '1');
	const perPage = Math.min(parseInt(url.searchParams.get('perPage') || '50') || 50, 100);
	const type = url.searchParams.get('type'); // email, sms, voice, etc.
	const read = url.searchParams.get('read'); // true, false, or omit for all
	const companyId = locals.user.company.id;

	try {
		const where: { companyId: string; type?: CommunicationType; read?: boolean } = { companyId };
		if (type) where.type = type as CommunicationType;
		if (read === 'true') where.read = true;
		if (read === 'false') where.read = false;

		const [items, total] = await Promise.all([
			prisma.notification.findMany({
				where,
				orderBy: { createdAt: 'desc' },
				skip: (page - 1) * perPage,
				take: perPage
			}),
			prisma.notification.count({ where })
		]);

		return json({
			success: true,
			data: items,
			pagination: {
				page,
				limit: perPage,
				total,
				totalPages: Math.ceil(total / perPage)
			}
		});
	} catch (e) {
		console.error('GET /api/notifications error:', e);
		return json(
			{ success: false, error: e instanceof Error ? e.message : 'Failed to fetch notifications' },
			{ status: 500 }
		);
	}
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.company) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = await request.json();
		const { id, read } = body as { id?: string; read?: boolean };
		if (id == null || read === undefined) {
			return json({ success: false, error: 'id and read are required' }, { status: 400 });
		}

		const notification = await prisma.notification.findFirst({
			where: { id, companyId: locals.user!.company!.id }
		});
		if (!notification) {
			return json({ success: false, error: 'Notification not found' }, { status: 404 });
		}

		const updated = await prisma.notification.update({
			where: { id },
			data: { read }
		});
		return json({ success: true, data: updated });
	} catch (e) {
		console.error('PATCH /api/notifications error:', e);
		return json(
			{ success: false, error: e instanceof Error ? e.message : 'Failed to update notification' },
			{ status: 500 }
		);
	}
};
