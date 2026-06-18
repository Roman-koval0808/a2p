import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';

function toSpecType(t: string) {
	if (t === 'voice') return 'call';
	return t;
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get('limit') ?? '5', 10)));
	const items = await prisma.notification.findMany({
		where: { companyId: auth.companyId },
		orderBy: { createdAt: 'desc' },
		take: limit
	});

	const data = items.map((n) => ({
		id: n.id,
		senderName: n.sourceName ?? '',
		message: n.content ?? n.messagePreview,
		type: toSpecType(n.type),
		isRead: n.read,
		timestamp: n.createdAt.toISOString()
	}));
	return json({ success: true, data });
};
