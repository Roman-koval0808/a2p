import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';
import { logCommunication } from '$lib/utils/communication-log';

export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const body = await request.json().catch(() => ({}));
	const contactId = body.contactId ?? null;
	const contactName = body.contactName ?? null;
	const contactNumber = typeof body.contactNumber === 'string' ? body.contactNumber.trim() : '';
	const direction =
		body.direction === 'inbound' || body.direction === 'outbound' ? body.direction : 'outbound';
	const duration = typeof body.duration === 'number' ? body.duration : 0;
	const status = ['completed', 'missed', 'rejected', 'failed'].includes(body.status)
		? body.status
		: 'completed';
	const callerIdName = body.callerIdName ?? null;
	const callerIdNumber = body.callerIdNumber ?? null;
	const telnyxCallId = body.telnyxCallId ?? null;
	const startedAt = body.startedAt ?? new Date().toISOString();
	const endedAt = body.endedAt ?? new Date().toISOString();

	if (!contactNumber) {
		return json({ success: false, error: 'contactNumber is required', code: 400 }, { status: 400 });
	}

	const logStatus =
		status === 'completed' ? 'completed' : status === 'missed' ? 'missed' : 'failed';
	await logCommunication({
		type: 'voice',
		direction,
		status: logStatus,
		source: direction === 'outbound' ? (callerIdNumber ?? undefined) : contactNumber,
		destination: direction === 'outbound' ? contactNumber : (callerIdNumber ?? undefined),
		customer_id: contactId ?? undefined,
		company_id: auth.companyId,
		user_id: auth.id,
		summary: contactName ?? undefined,
		duration,
		metadata: {
			contactName,
			callerIdName,
			telnyxCallId,
			startedAt,
			endedAt
		}
	});

	const created = await prisma.communicationLog.findFirst({
		where: { companyId: auth.companyId, type: 'voice' },
		orderBy: { created: 'desc' },
		select: { id: true, destination: true, direction: true, duration: true, created: true }
	});

	return json(
		{
			success: true,
			data: {
				id: created?.id ?? 'call_log_1',
				contactNumber,
				direction,
				duration,
				status,
				startedAt,
				endedAt
			},
			message: 'Call logged successfully'
		},
		{ status: 201 }
	);
};
