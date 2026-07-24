import { prisma } from '$lib/db';
import { createContainerAtIntake, createEntry, shouldSuppressActions } from '$lib/server/container/container-service';
import { registerTimer } from '$lib/server/timer/timer-service';
import type { TechRotaItem, EmergencyBridgeWorkOrder } from './s2-emergency-bridge';

export type BridgeFailureType =
	| 'tech_no_answer'
	| 'tech_voicemail_no_dtmf'
	| 'customer_no_answer'
	| 'api_bridge_error'
	| 'bridge_dropped_under_30s';

export interface RepeatContactAnalysis {
	isRepeatContact: boolean;
	severityIncreased: boolean;
	callbackNumberChanged: boolean;
	newCallbackNumber?: string;
	deltaText?: string;
}

export function analyzeRepeatContactDelta(
	firstTranscript: string,
	secondTranscript: string,
	firstCallbackNum?: string,
	secondCallbackNum?: string
): RepeatContactAnalysis {
	const firstLower = (firstTranscript || '').toLowerCase();
	const secondLower = (secondTranscript || '').toLowerCase();

	const severityKeywords = ['getting worse', 'rising', 'gushing', 'ceiling collapse', 'shut off'];
	const severityIncreased = severityKeywords.some((kw) => secondLower.includes(kw));

	const callbackNumberChanged = !!(
		secondCallbackNum &&
		firstCallbackNum &&
		secondCallbackNum.replace(/\D/g, '') !== firstCallbackNum.replace(/\D/g, '')
	);

	let deltaText = '';
	if (severityIncreased) deltaText += 'Water/severity getting worse! ';
	if (callbackNumberChanged) deltaText += `New callback number provided: ${secondCallbackNum}. `;

	return {
		isRepeatContact: true,
		severityIncreased,
		callbackNumberChanged,
		newCallbackNumber: callbackNumberChanged ? secondCallbackNum : undefined,
		deltaText: deltaText.trim()
	};
}

export async function processSecondEmergencyVoicemail(input: {
	companyId: string;
	customerProfileId?: string;
	customerPhone: string;
	firstTranscript: string;
	secondTranscript: string;
	firstCallbackNum?: string;
	secondCallbackNum?: string;
	existingContainer: any;
	workOrder: EmergencyBridgeWorkOrder;
	now?: Date;
}) {
	const now = input.now || new Date();

	// Step 1: Intake gate suppression (§1.1.4)
	// Suppress ACTIONS, never storage
	const delta = analyzeRepeatContactDelta(
		input.firstTranscript,
		input.secondTranscript,
		input.firstCallbackNum,
		input.secondCallbackNum
	);

	// Append entry to container
	const entry = await createEntry(prisma, {
		commId: input.existingContainer.id,
		customerProfileId: input.customerProfileId,
		direction: 'inbound',
		channel: 'voice',
		fromParty: delta.newCallbackNumber || input.customerPhone,
		toParty: 'system',
		fromPartyType: 'customer',
		toPartyType: 'system',
		occurredAt: now,
		transcript: input.secondTranscript,
		dedupSuppressed: true // Dedup suppresses actions, never storage (Correction 1)
	});

	// Correction 2: Repeat contact during open SLA shortens escalation!
	// Advance ladder to backup tech immediately
	let updatedRung = input.workOrder.currentRung + 1;
	if (updatedRung > input.workOrder.dialLadder.length) {
		updatedRung = input.workOrder.dialLadder.length; // Owner
	}

	const nextTech = input.workOrder.dialLadder[updatedRung - 1] || input.workOrder.dialLadder[0];

	let updatedWhisper = input.workOrder.whisperText;
	if (delta.deltaText) {
		updatedWhisper = `SECOND CALL from customer! ${delta.deltaText} ${input.workOrder.whisperText}`;
	}

	const updatedWorkOrder: EmergencyBridgeWorkOrder = {
		...input.workOrder,
		currentRung: updatedRung,
		whisperText: updatedWhisper,
		customerNumber: delta.newCallbackNumber || input.workOrder.customerNumber
	};

	return {
		entry,
		delta,
		escalationAdvanced: true,
		nextTech,
		updatedWorkOrder
	};
}

export async function handleBridgeFailure(input: {
	commId: string;
	failureType: BridgeFailureType;
	workOrder: EmergencyBridgeWorkOrder;
	attemptDurationSeconds?: number;
}): Promise<{
	action: 'next_rung_immediately' | 'retry_customer_schedule' | 'call_owner_directly';
	retryDelaySeconds?: number;
}> {
	switch (input.failureType) {
		case 'tech_no_answer':
		case 'tech_voicemail_no_dtmf':
		case 'api_bridge_error':
			return { action: 'next_rung_immediately' };

		case 'customer_no_answer': {
			// Reachability issue -> retry customer on schedule (2, 5, 10 min)
			return {
				action: 'retry_customer_schedule',
				retryDelaySeconds: 120 // 2 minutes
			};
		}

		case 'bridge_dropped_under_30s': {
			if ((input.attemptDurationSeconds || 0) < 30) {
				// Drop under 30s is NOT a resolution -> continue outer loop
				return { action: 'next_rung_immediately' };
			}
			return { action: 'retry_customer_schedule' };
		}
	}
}
