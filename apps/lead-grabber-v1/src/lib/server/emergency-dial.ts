import { TELNYX_API_KEY, TELNYX_CONNECTION_ID } from '$env/static/private';
import type { EmergencyBridgeWorkOrder } from './scenarios/s2-emergency-bridge';
import { prisma } from '$lib/db';

export async function startDialLadder(workOrder: EmergencyBridgeWorkOrder, companyNumber: string) {
	const currentTech = workOrder.dialLadder[workOrder.currentRung - 1];
	if (!currentTech) {
		console.error('[EmergencyDial] No tech at rung', workOrder.currentRung);
		return false;
	}

	const clientStateObj = {
		isDialLadderTechLeg: true,
		commId: workOrder.commId,
		workOrder
	};
	const clientState = Buffer.from(JSON.stringify(clientStateObj)).toString('base64');

	const to = currentTech.phone;
	console.log(`📞 [EmergencyDial] Dialing tech rung ${workOrder.currentRung}: ${currentTech.name} (${to})`);

	const res = await fetch('https://api.telnyx.com/v2/calls', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${TELNYX_API_KEY}`
		},
		body: JSON.stringify({
			connection_id: TELNYX_CONNECTION_ID,
			to,
			from: companyNumber,
			client_state: clientState,
			timeout_secs: 15
		})
	});

	if (!res.ok) {
		const err = await res.text();
		console.error('❌ [EmergencyDial] Failed to dial tech:', err);
		return false;
	}

	return true;
}

export async function bridgeCustomer(techCallControlId: string, workOrder: EmergencyBridgeWorkOrder, companyNumber: string) {
	const clientStateObj = {
		isDialLadderCustomerLeg: true,
		commId: workOrder.commId,
		techCallControlId,
		workOrder
	};
	const clientState = Buffer.from(JSON.stringify(clientStateObj)).toString('base64');

	const to = workOrder.customerNumber;
	console.log(`📞 [EmergencyDial] Tech confirmed. Dialing customer: ${to}`);

	const res = await fetch('https://api.telnyx.com/v2/calls', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${TELNYX_API_KEY}`
		},
		body: JSON.stringify({
			connection_id: TELNYX_CONNECTION_ID,
			to,
			from: companyNumber,
			client_state: clientState,
			timeout_secs: 45
		})
	});

	if (!res.ok) {
		const err = await res.text();
		console.error('❌ [EmergencyDial] Failed to dial customer:', err);
		return false;
	}
	return true;
}
