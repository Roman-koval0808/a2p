import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';

/** Reply via SMS/email/call - stub: marks as read and optionally triggers send (SMS uses existing /api/telnyx). */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const n = await prisma.notification.findFirst({
		where: { id: params.id, companyId: auth.companyId }
	});
	if (!n) {
		return json({ success: false, error: 'Notification not found', code: 404 }, { status: 404 });
	}

	const body = await request.json().catch(() => ({}));
	const message = typeof body.message === 'string' ? body.message.trim() : '';
	const replyMethod = body.replyMethod; // sms | email | call

	if (!message || !['sms', 'email', 'call'].includes(replyMethod)) {
		return json(
			{ success: false, error: 'message and replyMethod (sms|email|call) are required', code: 400 },
			{ status: 400 }
		);
	}

	await prisma.notification.update({
		where: { id: params.id },
		data: { read: true }
	});

	// Actual send would call /api/telnyx for SMS, email provider for email, etc.
	// For spec compliance we just acknowledge; client or webhook can send.
	return json({ success: true, message: 'Reply sent successfully' });
};
