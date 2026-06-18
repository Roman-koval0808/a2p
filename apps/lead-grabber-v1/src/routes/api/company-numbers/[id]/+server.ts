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
		const callFlowId = body.callFlowId as string | null | undefined;
		const callTrackingCategoryId = body.callTrackingCategoryId as string | null | undefined;
		const connectionLabel = body.connectionLabel as string | null | undefined;
		const data: {
			callFlowId?: string | null;
			callTrackingCategoryId?: string | null;
			connectionLabel?: string | null;
		} = {};
		if (callFlowId !== undefined) data.callFlowId = callFlowId || null;
		if (callTrackingCategoryId !== undefined)
			data.callTrackingCategoryId = callTrackingCategoryId || null;
		if (connectionLabel !== undefined) data.connectionLabel = connectionLabel || null;
		if (Object.keys(data).length === 0) {
			return json({ error: 'No updates provided' }, { status: 400 });
		}
		const updated = await prisma.companyPhoneNumber.updateMany({
			where: { id, companyId: locals.user.company.id },
			data
		});
		if (updated.count === 0) {
			return json({ error: 'Number not found' }, { status: 404 });
		}
		const number = await prisma.companyPhoneNumber.findFirst({
			where: { id, companyId: locals.user.company.id },
			include: {
				callFlow: { select: { id: true, title: true } },
				callTrackingCategory: { select: { id: true, name: true } }
			}
		});
		return json({ success: true, number });
	} catch (e) {
		console.error('Company number update:', e);
		return json({ success: false, error: 'Failed to update number' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user?.company?.id) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const id = params.id;
	if (!id) {
		return json({ error: 'Missing id' }, { status: 400 });
	}
	try {
		await prisma.companyPhoneNumber.deleteMany({
			where: { id, companyId: locals.user.company.id }
		});
		return json({ success: true });
	} catch (e) {
		console.error('Company numbers unassign:', e);
		return json({ success: false, error: 'Failed to unassign number' }, { status: 500 });
	}
};
