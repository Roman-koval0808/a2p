import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TELNYX_API_KEY, TELNYX_CONNECTION_ID } from '$env/static/private';
import { formatPhoneForDialing } from '$lib/utils/phone';
import { getFirstCompanyNumber } from '$lib/company-numbers';
import { prisma } from '$lib/db';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { to, from: fromParam, clientId } = await request.json();

		if (!to) {
			return json({ success: false, error: 'Missing destination phone number' }, { status: 400 });
		}

		const companyId = locals.user?.company?.id;
		if (!companyId) {
			return json({ success: false, error: 'Unauthorized' }, { status: 401 });
		}

		let from: string;
		if (fromParam) {
			from = fromParam;
		} else {
			const companyNumber = await getFirstCompanyNumber(prisma, companyId);
			if (!companyNumber) {
				return json(
					{
						success: false,
						error: 'No phone number assigned. Assign a number in Manage Numbers.'
					},
					{ status: 400 }
				);
			}
			from = companyNumber.phoneNumber;
		}

		// Format phone number for dialing (E.164 format)
		const formattedPhone = formatPhoneForDialing(to);

		// Create the call using Telnyx API
		const response = await fetch('https://api.telnyx.com/v2/calls', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${TELNYX_API_KEY}`
			},
			body: JSON.stringify({
				connection_id: TELNYX_CONNECTION_ID,
				to: formattedPhone,
				from,
				send_silence_when_idle: false, // Ensures continuous audio
				record: 'record-from-answer',
				client_state: clientId ? btoa(JSON.stringify({ clientId })) : undefined,
				webhook_url: `${request.headers.get('origin')}/api/telnyx/call-webhook`, // Ensure webhooks are properly routed
				// Optional: Enable answering machine detection if needed
				answering_machine_detection: 'premium',
				answering_machine_detection_config: {
					total_analysis_time_millis: 5000,
					after_greeting_silence_millis: 1000,
					between_words_silence_millis: 1000,
					greeting_duration_millis: 1000,
					initial_silence_millis: 1000,
					maximum_number_of_words: 50,
					maximum_word_length_millis: 2000,
					silence_threshold: 512,
					greeting_total_analysis_time_millis: 50000,
					greeting_silence_duration_millis: 2000
				}
			})
		});

		const data = await response.json();

		if (!response.ok) {
			console.error('Telnyx API error:', data);
			return json(
				{
					success: false,
					error: data.errors?.[0]?.detail || 'Failed to initiate call'
				},
				{ status: 500 }
			);
		}

		// --- SLA CLEARANCE ---
		// When the technician successfully initiates a call to the customer using the dialer,
		// we must clear any pending emergency SLA tasks for this phone number.
		try {
			// Find all OPEN SLA tasks for emergency dispatch (ACT-A2P-004)
			const openTasks = await prisma.pipelineActionQueue.findMany({
				where: {
					actionId: 'ACT-A2P-004',
					status: { in: ['pending_approval', 'ready_for_execution', 'pending'] }
				}
			});

			for (const task of openTasks) {
				const params = task.parameters as any;
				const taskPhone = params?.phone_number || params?.callback_number;
				// If the dialed number matches the task's callback number, the SLA is met!
				if (taskPhone && (formatPhoneForDialing(taskPhone) === formattedPhone)) {
					await prisma.pipelineActionQueue.update({
						where: { id: task.id },
						data: {
							status: 'execution_completed',
							updatedAt: new Date()
						}
					});
					console.log(`[Dialer] Cleared SLA emergency task ${task.id} because outbound call was made to ${formattedPhone}`);
				}
			}
		} catch (slaErr) {
			console.error('[Dialer] Failed to clear SLA tasks:', slaErr);
		}

		// Reflect "SLA met" on the VISIBLE emergency-dispatch SMS record(s) for this callback
		// number, so the Communication Log badge flips from a countdown to "SLA met" rather than
		// eventually showing BREACHED after the tech has actually called back.
		try {
			const last10 = (ph: string) => (ph || '').replace(/\D/g, '').slice(-10);
			const target = last10(formattedPhone);
			const dispatches = await prisma.communicationLog.findMany({
				where: {
					type: 'sms',
					direction: 'outbound',
					created: { gte: new Date(Date.now() - 60 * 60 * 1000) }
				},
				select: { id: true, metadata: true }
			});
			for (const d of dispatches) {
				const md = (d.metadata as any) || {};
				if (md.is_emergency_dispatch && md.sla_status !== 'met' && last10(md.callback_number || '') === target) {
					await prisma.communicationLog.update({
						where: { id: d.id },
						data: { metadata: { ...md, sla_status: 'met', sla_met_at: new Date().toISOString() } }
					});
					console.log(`[Dialer] Marked emergency dispatch ${d.id} SLA met (callback placed).`);
				}
			}
		} catch (e) {
			console.error('[Dialer] Failed to mark emergency dispatch SLA met:', e);
		}

		// Return the call ID and success status
		return json({
			success: true,
			callId: data.data.call_control_id,
			callLegId: data.data.call_leg_id
		});
	} catch (error) {
		console.error('Error initiating call:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
