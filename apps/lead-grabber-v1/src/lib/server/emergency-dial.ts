import { TELNYX_API_KEY, TELNYX_CONNECTION_ID } from '$env/static/private';
import type { EmergencyBridgeWorkOrder } from './scenarios/s2-emergency-bridge';
import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';
import { getCompanyAndFlowByPhoneNumber } from '$lib/company-numbers';

export async function startDialLadder(workOrder: EmergencyBridgeWorkOrder, companyNumber: string) {
	let currentTech = workOrder.dialLadder[workOrder.currentRung - 1];
	if (!currentTech) {
		// Ladder exhausted — wrap around to the first tech so emergencies always get bridged
		if (workOrder.dialLadder.length > 0) {
			workOrder.currentRung = 1;
			currentTech = workOrder.dialLadder[0];
			console.log(`[EmergencyDial] Rung ${workOrder.currentRung} exhausted, wrapping back to rung 1: ${currentTech.name}`);
		} else {
			console.error('[EmergencyDial] No techs in dial ladder at all — cannot bridge');
			return false;
		}
	}

	const clientStateObj = {
		isDialLadderTechLeg: true,
		commId: workOrder.commId,
		workOrder
	};
	const clientState = Buffer.from(JSON.stringify(clientStateObj)).toString('base64');

	const to = currentTech.phone;
	console.log(`📞 [EmergencyDial] Dialing tech rung ${workOrder.currentRung}: ${currentTech.name} (${to})`);

	const numberInfo = await getCompanyAndFlowByPhoneNumber(prisma, companyNumber);
	await logCommunication({
		type: 'voice',
		direction: 'outbound',
		status: 'completed',
		source: companyNumber,
		destination: to,
		company_id: numberInfo?.companyId,
		summary: `[System Dialing Tech] Escaping to Rung ${workOrder.currentRung}: ${currentTech.name}`,
		content: `System is automatically dialing technician ${currentTech.name} at ${to} for emergency bridge.`,
		metadata: {
			workOrder: true,
			rung: workOrder.currentRung,
			tech_name: currentTech.name,
			commId: workOrder.commId
		}
	});

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

	const numberInfo = await getCompanyAndFlowByPhoneNumber(prisma, companyNumber);
	await logCommunication({
		type: 'voice',
		direction: 'outbound',
		status: 'completed',
		source: companyNumber,
		destination: to,
		company_id: numberInfo?.companyId,
		summary: `[Bridge] Connecting Tech to Customer`,
		content: `Technician accepted the bridge. System is dialing customer at ${to} to connect the calls.`,
		metadata: {
			workOrder: true,
			bridging: true,
			commId: workOrder.commId
		}
	});

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
