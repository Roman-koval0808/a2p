import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';

function toSpecType(t: string) {
	if (t === 'voice') return 'call';
	return t; // sms, email, facebook, etc.
}

export const GET: RequestHandler = async ({ params, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const n = await prisma.notification.findFirst({
		where: { id: params.id, companyId: auth.companyId }
	});
	if (!n) {
		return json({ success: false, error: 'Notification not found', code: 404 }, { status: 404 });
	}

	const data = {
		id: n.id,
		senderName: n.sourceName ?? '',
		senderContact: n.sourceIdentifier ?? '',
		message: n.content ?? n.messagePreview,
		type: toSpecType(n.type),
		isRead: n.read,
		timestamp: n.createdAt.toISOString()
	};
	return json({ success: true, data });
};
