import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';

/**
 * POST /api/telnyx/log-webrtc-call
 *
 * Called by the dialer page after a WebRTC call ends to register the call in
 * CommunicationLog. WebRTC calls bypass /api/telnyx/dial entirely (they go
 * browser → Telnyx SIP → PSTN), so the server never learns about them unless
 * the client explicitly reports them here.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { to, from, duration, wasAnswered } = await request.json();

		const companyId = locals.user?.company?.id;
		if (!companyId) {
			return json({ success: false, error: 'Unauthorized' }, { status: 401 });
		}
		if (!to) {
			return json({ success: false, error: 'Missing destination' }, { status: 400 });
		}

		// Resolve destination contact
		const last10 = (ph: string) => (ph || '').replace(/\D/g, '').slice(-10);
		const target = last10(to);
		const contacts = await prisma.contact.findMany({
			where: { companyId },
			select: { id: true, name: true, phone: true }
		});
		let callee = contacts.find((c) => last10(c.phone || '') === target) || null;

		if (!callee) {
			callee = await prisma.contact.create({
				data: { companyId, phone: to, name: null },
				select: { id: true, name: true, phone: true }
			});
		}

		// Find existing thread for this contact
		const recentThreaded = await prisma.communicationLog.findMany({
			where: {
				companyId,
				communicationThreadId: { not: null },
				created: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
			},
			orderBy: { created: 'desc' },
			select: { source: true, destination: true, communicationThreadId: true },
			take: 100
		});
		const threadRow = recentThreaded.find(
			(r) => last10(r.source || '') === target || last10(r.destination || '') === target
		);

		const callStatus = wasAnswered === false ? 'missed' : 'completed';
		const callDuration = typeof duration === 'number' && duration > 0 ? Math.round(duration) : null;
		const callVerb = wasAnswered === false ? 'not answered' : 'completed';
		const callLabel = callDuration
			? `Outbound call ${callVerb} (${callDuration}s)`
			: `Outbound call ${callVerb}`;

		const record = await logCommunication({
			type: 'voice',
			direction: 'outbound',
			status: callStatus,
			source: from || undefined,
			destination: to,
			company_id: companyId,
			customer_id: callee?.id,
			summary: `Outbound call to ${callee?.name || to}`,
			content: callLabel,
			duration: callDuration ?? undefined,
			metadata: {
				dialer_outbound: true,
				webrtc_call: true,
				placed_by: locals.user?.id || null,
				placed_at: new Date().toISOString(),
				answered: wasAnswered !== false,
				no_answer: wasAnswered === false,
				thread_id: to,
				commId: threadRow?.communicationThreadId || undefined
			}
		});

		console.log(
			`[Dialer WebRTC] Logged outbound call to ${callee?.name || to} (${callVerb}, ${callDuration ?? '?'}s)`
		);

		return json({ success: true, logId: record?.id || null });
	} catch (error: any) {
		console.error('[Dialer WebRTC] Failed to log call:', error);
		return json(
			{ success: false, error: error?.message || 'Failed to log call' },
			{ status: 500 }
		);
	}
};
