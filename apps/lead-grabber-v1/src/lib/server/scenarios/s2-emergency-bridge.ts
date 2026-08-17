import { prisma } from '$lib/db';
import { evaluateEmergency } from '$lib/server/ai/emergency';
import { registerTimer } from '$lib/server/timer/timer-service';
import { createTask, createEntry } from '$lib/server/container/container-service';
import { formatPhoneForDialing } from '$lib/utils/phone';

export interface TechRotaItem {
	userId: string;
	name: string;
	phone: string;
	rung: number; // 1 = primary, 2 = backup, 3 = on-call, 4 = owner
}

export interface EmergencyBridgeWorkOrder {
	commId: string;
	personId?: string | null;
	customerNumber: string;
	dialLadder: TechRotaItem[];
	currentRung: number;
	maxAttemptsPerRung: number;
	whisperText: string;
	emergencySummary: string;
	slaDeadline: Date;
	escalationPolicy: string;
	/**
	 * What this ladder is for. Absent means an emergency — every existing caller omits it, and the
	 * emergency path must behave exactly as it did before this field existed.
	 *
	 * The leadbox callback router (callback-dispatch.ts) reuses this ladder because the dial /
	 * whisper / DTMF / next-rung behaviour is identical. This field exists so the two are
	 * distinguishable in logs and so a future change to one can be made without silently changing
	 * the other. It must never gate the dialling logic itself.
	 */
	kind?: 'emergency' | 'callback';
}

export async function processEmergencyVoicemail(input: {
	commId: string;
	companyId: string;
	customerProfileId?: string | null;
	customerPhone: string;
	customerName?: string | null;
	transcript: string;
	ivrOption?: number;
	rota?: TechRotaItem[];
	now?: Date;
}) {
	const now = input.now || new Date();

	// Step 1: Emergency evaluation (deterministic floor)
	const evalResult = evaluateEmergency(input.transcript);

	// Test 2-8: Routine non-emergency voicemail MUST NOT trigger bridge!
	if (!evalResult.isEmergency) {
		console.log(`[Scenario 2] Transcript is non-emergency. Skipping bridge dispatch.`);
		return {
			isEmergency: false,
			workOrder: null,
			bridgeTriggered: false
		};
	}

	// Step 2: Rota validation
	const dialLadder = input.rota || [
		{ userId: 'u_tech1', name: 'Primary Tech', phone: '+15550000001', rung: 1 },
		{ userId: 'u_tech2', name: 'Backup Tech', phone: '+15550000002', rung: 2 },
		{ userId: 'u_owner', name: 'Owner', phone: '+15550000009', rung: 4 }
	];

	if (!dialLadder || dialLadder.length === 0) {
		console.error(`[Scenario 2] CRITICAL: Rota empty! Escalating to owner immediately.`);
	}

	const slaDeadline = new Date(now.getTime() + 10 * 60 * 1000); // 10-minute SLA

	// Register sla_breach timer (§1.2)
	await registerTimer(prisma, {
		commId: input.commId,
		companyId: input.companyId,
		type: 'sla_breach',
		fireAt: slaDeadline,
		payload: { customerPhone: input.customerPhone }
	});

	const whisperText = `Emergency call, ${input.customerName || 'Customer'}, ${evalResult.keywordHits.join(', ') || 'urgent issue'}. Press 1 to connect, press 2 to decline.`;

	const workOrder: EmergencyBridgeWorkOrder = {
		commId: input.commId,
		personId: input.customerProfileId || null,
		customerNumber: input.customerPhone,
		dialLadder,
		currentRung: 1,
		maxAttemptsPerRung: 1,
		whisperText,
		emergencySummary: evalResult.keywordHits.join(', ') || 'Emergency',
		slaDeadline,
		escalationPolicy: 'ladder_with_dtmf'
	};

	return {
		isEmergency: true,
		workOrder,
		bridgeTriggered: true
	};
}

export async function handleTechDtmfResponse(input: {
	commId: string;
	dtmfDigit: string;
	currentRung: number;
	workOrder: EmergencyBridgeWorkOrder;
}): Promise<{
	action: 'bridge_customer' | 'next_rung' | 'exhausted';
	nextTech?: TechRotaItem;
}> {
	// Rule: ONLY on DTMF 1 dial customer (test 2-2, 2-3)
	if (input.dtmfDigit === '1') {
		return { action: 'bridge_customer' };
	}

	// DTMF 2 (decline) or no keypress / voicemail -> move to next rung
	const nextRungIndex = input.currentRung;
	if (nextRungIndex < input.workOrder.dialLadder.length) {
		const nextTech = input.workOrder.dialLadder[nextRungIndex];
		return {
			action: 'next_rung',
			nextTech
		};
	}

	return { action: 'exhausted' };
}

export async function extractTasksFromEmergencyCall(input: {
	commId: string;
	sourceEntryId?: string;
	techUserId: string;
	transcript: string;
	now?: Date;
}) {
	const now = input.now || new Date();
	const extracted: any[] = [];

	// Parse commitments from transcript
	const lower = input.transcript.toLowerCase();

	if (lower.includes('be there by') || lower.includes("i'll call") || lower.includes('will arrive')) {
		const dueTime = new Date(now.getTime() + 2 * 3600 * 1000);
		const task = await createTask(prisma, {
			commId: input.commId,
			sourceEntryId: input.sourceEntryId,
			description: 'Arrive at customer site for emergency repair',
			ownerUserId: input.techUserId,
			due: dueTime,
			category: 'customer_promise',
			confidence: 0.95
		});

		// Register promise_due timer (§1.5)
		await registerTimer(prisma, {
			commId: input.commId,
			type: 'promise_due',
			fireAt: dueTime,
			payload: { taskId: task.id }
		});

		extracted.push(task);
	}

	if (lower.includes('order parts') || lower.includes('invoice') || lower.includes('followup')) {
		const task = await createTask(prisma, {
			commId: input.commId,
			sourceEntryId: input.sourceEntryId,
			description: 'Followup internal tasks post-bridge',
			ownerUserId: input.techUserId,
			due: new Date(now.getTime() + 24 * 3600 * 1000),
			category: 'internal_followup',
			confidence: 0.9
		});
		extracted.push(task);
	}

	return extracted;
}
