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
		const { to, from, duration, wasAnswered, telnyxSessionId, telnyxLegId } = await request.json();

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

		const callStatus = wasAnswered === false ? 'missed' : 'completed';
		const callDuration = typeof duration === 'number' && duration > 0 ? Math.round(duration) : null;
		const callVerb = wasAnswered === false ? 'not answered' : 'completed';
		const callLabel = callDuration
			? `Outbound call ${callVerb} (${callDuration}s)`
			: `Outbound call ${callVerb}`;

		// De-duplicate: check if call.hangup in call-webhook already created a CommunicationLog
		const since = new Date(Date.now() - 2 * 60 * 1000);
		const existingLogs = await prisma.communicationLog.findMany({
			where: {
				companyId,
				type: 'voice',
				created: { gte: since }
			},
			orderBy: { created: 'desc' },
			take: 20
		});

		const existingLog = existingLogs.find((l) => {
			const meta = l.metadata as Record<string, unknown>;
			const isMatchCallId =
				(telnyxSessionId && (meta?.call_session_id === telnyxSessionId || meta?.call_control_id === telnyxSessionId)) ||
				(telnyxLegId && (meta?.call_leg_id === telnyxLegId || meta?.call_control_id === telnyxLegId));
			const isMatchPhone =
				l.direction === 'outbound' &&
				(last10(l.destination || '') === target || last10(l.source || '') === target);
			return isMatchCallId || isMatchPhone;
		});

		if (existingLog) {
			await prisma.communicationLog.update({
				where: { id: existingLog.id },
				data: {
					duration: callDuration ?? existingLog.duration,
					status: callStatus,
					content: callLabel,
					metadata: {
						...((existingLog.metadata as Record<string, unknown>) || {}),
						dialer_outbound: true,
						webrtc_call: true,
						call_session_id: telnyxSessionId || undefined,
						call_leg_id: telnyxLegId || undefined,
						placed_by: locals.user?.id || null,
						placed_at: new Date().toISOString(),
						answered: wasAnswered !== false,
						no_answer: wasAnswered === false
					} as any
				}
			});
			console.log(`[Dialer WebRTC] Updated existing CommunicationLog for ${callee?.name || to} (${callVerb}, ${callDuration ?? '?'}s)`);
			return json({ success: true, logId: existingLog.id });
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
				// Keys the call.recording.saved handler matches on, so the recording (once connection
				// recording is enabled) attaches to THIS log + gets transcribed, instead of duplicating.
				call_session_id: telnyxSessionId || undefined,
				call_leg_id: telnyxLegId || undefined,
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
