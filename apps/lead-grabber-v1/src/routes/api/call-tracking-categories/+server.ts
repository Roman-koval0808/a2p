import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user?.company?.id) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	try {
		const categories = await prisma.callTrackingCategory.findMany({
			where: { companyId: locals.user.company.id },
			orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
		});
		return json({ success: true, categories });
	} catch (e) {
		console.error('Call tracking categories list:', e);
		return json({ success: false, error: 'Failed to list categories' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.company?.id) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	try {
		const body = await request.json();
		const name = (body.name as string)?.trim();
		if (!name) {
			return json({ error: 'name is required' }, { status: 400 });
		}
		const sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : 0;
		const category = await prisma.callTrackingCategory.create({
			data: {
				companyId: locals.user.company.id,
				name,
				sortOrder
			}
		});
		return json({ success: true, category });
	} catch (e: unknown) {
		const msg =
			e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002'
				? 'A category with this name already exists'
				: 'Failed to create category';
		console.error('Call tracking category create:', e);
		return json({ success: false, error: msg }, { status: 500 });
	}
};
