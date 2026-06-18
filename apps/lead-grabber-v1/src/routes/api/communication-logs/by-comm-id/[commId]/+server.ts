import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';

export const GET: RequestHandler = async ({ params, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	// Match by id or by metadata.commId (stored when assigning/creating)
	const byId = await prisma.communicationLog.findMany({
		where: { id: params.commId, companyId: auth.companyId },
		orderBy: { created: 'asc' },
		select: { id: true, type: true, created: true }
	});
	if (byId.length > 0) {
		const data = byId.map((l) => ({
			id: l.id,
			type: l.type === 'voice' ? 'call' : l.type,
			timestamp: l.created.toISOString()
		}));
		return json({ success: true, data });
	}
	const all = await prisma.communicationLog.findMany({
		where: { companyId: auth.companyId },
		orderBy: { created: 'asc' },
		select: { id: true, type: true, created: true, metadata: true }
	});
	const logs = all.filter((l) => (l.metadata as { commId?: string })?.commId === params.commId);

	const data = logs.map((l) => ({
		id: l.id,
		type: l.type === 'voice' ? 'call' : l.type,
		timestamp: l.created.toISOString()
	}));
	return json({ success: true, data });
};
