import { prisma } from '$lib/db';
import { createTimer } from './TimerService';
import { TELNYX_API_KEY } from '$env/static/private';
import { PUBLIC_BASE_URL } from '$env/static/public';
// Assuming standard SMS function is replaced with inline fetch

export interface Rung {
	rep_id: string; // User ID of the tech/owner
	phone_number: string;
	attempts_made: number;
	max_attempts: number;
}

export interface WorkOrder {
	comm_id: string;
	dial_ladder: Rung[];
	current_rung_index: number;
	whisper_text: string;
	emergency_summary: string;
	customer_number: string;
	sla_deadline: Date;
}

// In-memory store for active ladders (in a real system, store in DB or Redis)
const activeWorkOrders = new Map<string, WorkOrder>();

export async function initiateEmergencyDialLadder(
	comm_id: string,
	companyId: string,
	customerNumber: string,
	summary: string
) {
	console.log(`🚨 Initiating Emergency Dial Ladder for comm_id: ${comm_id}`);

	// 1. Send immediate customer SMS
	try {
		await fetch('https://api.telnyx.com/v2/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${TELNYX_API_KEY}`
			},
			body: JSON.stringify({
				from: '+18005550199', // TODO: Use company's actual Telnyx number
				to: customerNumber,
				text: 'We have received your emergency request. A technician is being dispatched and will call you momentarily.'
			})
		});
		console.log('✅ Sent immediate emergency confirmation SMS to customer');
	} catch (e) {
		console.error('Failed to send immediate SMS to customer, proceeding anyway', e);
	}

	// 2. Build the ladder (Primary -> Owner for now)
	const company = await prisma.company.findUnique({
		where: { id: companyId },
		include: { members: { include: { user: true } } }
	});

	if (!company) throw new Error('Company not found');

	const owners = company.members.filter((m) => m.role === 'owner' && m.user.phone);
	const techs = company.members.filter((m) => m.role !== 'owner' && m.user.phone);

	const dial_ladder: Rung[] = [];
	
	// Add primary tech
	if (techs.length > 0) {
		dial_ladder.push({
			rep_id: techs[0].userId,
			phone_number: techs[0].user.phone!,
			attempts_made: 0,
			max_attempts: 1
		});
	}

	// Add owner as guaranteed last rung
	if (owners.length > 0) {
		dial_ladder.push({
			rep_id: owners[0].userId,
			phone_number: owners[0].user.phone!,
			attempts_made: 0,
			max_attempts: 1
		});
	}

	if (dial_ladder.length === 0) {
		console.error('❌ Empty/misconfigured rota: No tech or owner available to answer emergency!');
		// Escalate to owner fallback immediately
		return;
	}

	const workOrder: WorkOrder = {
		comm_id,
		dial_ladder,
		current_rung_index: 0,
		whisper_text: `Emergency call. ${summary}. Press 1 to connect, press 2 to decline.`,
		emergency_summary: summary,
		customer_number: customerNumber,
		sla_deadline: new Date(Date.now() + 15 * 60000) // 15 min SLA
	};

	activeWorkOrders.set(comm_id, workOrder);

	// Start dialing the first rung
	await dialCurrentRung(workOrder);
}

async function dialCurrentRung(workOrder: WorkOrder) {
	if (workOrder.current_rung_index >= workOrder.dial_ladder.length) {
		console.error(`🚨 Dial ladder exhausted for comm_id: ${workOrder.comm_id}. No one answered.`);
		// Trigger SLA breach or final fallback
		return;
	}

	const rung = workOrder.dial_ladder[workOrder.current_rung_index];
	rung.attempts_made++;

	console.log(`📞 Dialing rung ${workOrder.current_rung_index} (${rung.phone_number})...`);

	const clientState = Buffer.from(
		JSON.stringify({
			isDialLadderCall: true,
			comm_id: workOrder.comm_id,
			whisper_text: workOrder.whisper_text,
			customer_number: workOrder.customer_number
		})
	).toString('base64');

	// Dial the tech
	try {
		await fetch('https://api.telnyx.com/v2/calls', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${TELNYX_API_KEY}`
			},
			body: JSON.stringify({
				to: rung.phone_number,
				from: '+18005550199', // TODO: Use company's actual Telnyx number
				connection_id: process.env.TELNYX_CONNECTION_ID,
				client_state: clientState,
				webhook_url: `${PUBLIC_BASE_URL}/api/telnyx/call-webhook`,
				webhook_url_method: 'POST',
				timeout_secs: 15 // Spec: dial tech (15s timeout)
			})
		});
	} catch (e) {
		console.error(`❌ Failed to dial rung ${workOrder.current_rung_index}:`, e);
		advanceLadder(workOrder.comm_id);
	}
}

export async function advanceLadder(comm_id: string) {
	const workOrder = activeWorkOrders.get(comm_id);
	if (!workOrder) return;

	const rung = workOrder.dial_ladder[workOrder.current_rung_index];
	if (rung.attempts_made < rung.max_attempts) {
		// Retry current rung
		await dialCurrentRung(workOrder);
	} else {
		// Move to next rung
		workOrder.current_rung_index++;
		await dialCurrentRung(workOrder);
	}
}

export function finishLadder(comm_id: string) {
	activeWorkOrders.delete(comm_id);
	console.log(`✅ Dial ladder completed for comm_id: ${comm_id}`);
}
