import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user?.company?.id) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const id = params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	try {
		const body = await request.json();
		const data: { name?: string; sortOrder?: number } = {};
		if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
		if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder;
		if (Object.keys(data).length === 0) {
			return json({ error: 'No updates provided' }, { status: 400 });
		}
		const category = await prisma.callTrackingCategory.updateMany({
			where: { id, companyId: locals.user.company.id },
			data
		});
		if (category.count === 0) {
			return json({ error: 'Category not found' }, { status: 404 });
		}
		const updated = await prisma.callTrackingCategory.findFirst({
			where: { id, companyId: locals.user.company.id }
		});
		return json({ success: true, category: updated });
	} catch (e: unknown) {
		const msg =
			e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002'
				? 'A category with this name already exists'
				: 'Failed to update category';
		console.error('Call tracking category update:', e);
		return json({ success: false, error: msg }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user?.company?.id) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const id = params.id;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	try {
		await prisma.callTrackingCategory.deleteMany({
			where: { id, companyId: locals.user.company.id }
		});
		return json({ success: true });
	} catch (e) {
		console.error('Call tracking category delete:', e);
		return json({ success: false, error: 'Failed to delete category' }, { status: 500 });
	}
};
