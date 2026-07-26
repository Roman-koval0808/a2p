import { prisma } from '$lib/db';
import { resolveRelativeDate, formatDateExplicit } from '$lib/server/datetime';
import { createHold, createTask, createApproval } from '$lib/server/container/container-service';
import { createCustomerFacingApproval } from '$lib/server/approval/approval-service';
import { registerTimer, cancelTimersForContainer } from '$lib/server/timer/timer-service';

export type SmsReplyIntent =
	| 'confirm'
	| 'counter_propose'
	| 'decline'
	| 'question'
	| 'opt_out'
	| 'unparseable';

export function parseSmsReplyIntent(text: string): SmsReplyIntent {
	const clean = (text || '').trim().toLowerCase();

	if (clean === 'stop' || clean === 'unsubscribe' || clean === 'cancel all') {
		return 'opt_out'; // Spec Correction 3 / test 4-6
	}

	if (
		clean === 'yes' ||
		clean === 'y' ||
		clean === 'confirmed' ||
		clean === 'confirm' ||
		clean.includes('👍') ||
		clean === 'ok' ||
		clean === 'sure'
	) {
		return 'confirm';
	}

	if (clean === 'no' || clean === 'cancel' || clean === 'n') {
		return 'decline';
	}

	if (
		clean.includes('instead') ||
		clean.includes('can we do') ||
		clean.includes('how about') ||
		clean.includes('works better')
	) {
		return 'counter_propose'; // Test 4-4
	}

	if (
		clean.includes('how much') ||
		clean.includes('what is the') ||
		clean.includes('price') ||
		clean.includes('cost') ||
		clean.includes('location')
	) {
		return 'question'; // Test 4-7
	}

	return 'unparseable';
}

export async function processSalesVoicemailBooking(input: {
	commId: string;
	companyId: string;
	customerProfileId?: string;
	customerPhone: string;
	isLandline?: boolean;
	transcriptWeekday?: string;
	transcriptTimeStr?: string;
	hour?: number;
	minute?: number;
	productInterest?: string;
	callStartTime: Date;
	availableResources: { personnel: string[]; assets: string[] };
	now?: Date;
}) {
	const now = input.now || new Date();

	// Test 4-10: Landline handling -> skip SMS, create phone-call task for rep!
	if (input.isLandline) {
		const task = await createTask(prisma, {
			commId: input.commId,
			description: `Call customer back at ${input.customerPhone} (Landline cannot receive SMS) regarding appointment request for ${input.productInterest || 'product/service'}.`,
			ownerUserId: input.availableResources.personnel[0] || 'u_sales_owner',
			due: new Date(now.getTime() + 2 * 3600 * 1000),
			category: 'internal_followup',
			confidence: 0.95
		});

		return {
			isLandline: true,
			smsDrafted: false,
			taskCreated: true,
			task
		};
	}

	// Resolve weekday -> date (Correction 1 / Test 4-2)
	const dateRes = resolveRelativeDate(
		input.callStartTime,
		input.transcriptWeekday,
		null,
		input.hour || 10,
		input.minute || 0
	);

	const proposedDate = dateRes.resolvedDate;
	const explicitDateText = formatDateExplicit(proposedDate);

	// Availability check on resource (personnel + asset)
	if (
		input.availableResources.personnel.length === 0 ||
		input.availableResources.assets.length === 0
	) {
		// Slot taken / no resource -> DO NOT send confirmation, create human task (Test 4-3)
		const task = await createTask(prisma, {
			commId: input.commId,
			description: `Call customer ${input.customerPhone} with alternative slots for appointment (${input.productInterest || 'product/service'} unavailable on ${explicitDateText}).`,
			ownerUserId: 'u_sales_owner',
			due: new Date(now.getTime() + 2 * 3600 * 1000),
			category: 'internal_followup',

			confidence: 0.9
		});

		return {
			slotAvailable: false,
			smsDrafted: false,
			taskCreated: true,
			task
		};
	}

	// Slot open -> create tentative hold (Correction 2)
	const holdExpiresAt = new Date(now.getTime() + 2 * 3600 * 1000); // 2h expiry
	const hold = await createHold(prisma, {
		commId: input.commId,
		resourceIds: {
			personnel: input.availableResources.personnel[0],
			asset: input.availableResources.assets[0]
		},
		startTime: proposedDate,
		endTime: new Date(proposedDate.getTime() + 60 * 60 * 1000),
		status: 'tentative',
		holdExpiresAt
	});

	// Register hold_expiry timer
	await registerTimer(prisma, {
		commId: input.commId,
		type: 'hold_expiry',
		fireAt: holdExpiresAt,
		payload: { holdId: hold.id }
	});

	// Draft SMS with full explicit date (Correction 1)
	const smsDraft = `Hi! We set a tentative hold for your appointment regarding the ${input.productInterest || 'product/service'} on ${explicitDateText}. Please reply YES to confirm or CANCEL to decline.`;
	const approvalDeadline = new Date(now.getTime() + 30 * 60 * 1000); // 30 min approval deadline

	const approval = await createCustomerFacingApproval(prisma, {
		commId: input.commId,
		draftType: 'sms',
		draftContent: smsDraft,
		contextPayload: {
			proposedDate: proposedDate.toISOString(),
			explicitDateText,
			holdId: hold.id,
			product: input.productInterest
		},
		approvalDeadline
	});

	return {
		slotAvailable: true,
		smsDrafted: true,
		hold,
		approval,
		explicitDateText
	};
}

export async function handleInboundSmsReply(input: {
	commId: string;
	customerPhone: string;
	replyText: string;
	pendingHolds: any[];
	now?: Date;
}) {
	const now = input.now || new Date();

	// Test 4-9: If two pending confirmations for same number -> route to human!
	if (input.pendingHolds && input.pendingHolds.length > 1) {
		const task = await createTask(prisma, {
			commId: input.commId,
			description: `Multiple pending confirmations found for ${input.customerPhone}. Manual triage required for reply: "${input.replyText}"`,
			ownerUserId: 'u_sales_owner',
			due: new Date(now.getTime() + 1 * 3600 * 1000),
			category: 'internal_followup'
		});
		return {
			routedToHuman: true,
			reason: 'multiple_pending_confirmations',
			task
		};
	}

	const activeHold = input.pendingHolds?.[0];
	const intent = parseSmsReplyIntent(input.replyText);

	switch (intent) {
		case 'confirm': {
			if (activeHold) {
				await prisma.commHold.update({
					where: { id: activeHold.id },
					data: { status: 'booked' }
				});
				await cancelTimersForContainer(input.commId, 'hold_expiry', 'confirmed_by_customer');
			}
			return {
				intent: 'confirm',
				booked: true,
				terminalState: 'booked'
			};
		}

		case 'decline': {
			if (activeHold) {
				await prisma.commHold.update({
					where: { id: activeHold.id },
					data: { status: 'released' }
				});
				await cancelTimersForContainer(input.commId, 'hold_expiry', 'declined_by_customer');
			}
			return {
				intent: 'decline',
				booked: false,
				terminalState: 'declined'
			};
		}

		case 'opt_out': {
			if (activeHold) {
				await prisma.commHold.update({
					where: { id: activeHold.id },
					data: { status: 'released' }
				});
				await cancelTimersForContainer(input.commId, 'hold_expiry', 'opt_out');
			}
			const task = await createTask(prisma, {
				commId: input.commId,
				description: `Customer ${input.customerPhone} opted out (STOP received). Hold released.`,
				ownerUserId: 'u_sales_owner',
				due: now,
				category: 'internal_followup'
			});
			return {
				intent: 'opt_out',
				booked: false,
				terminalState: 'declined',
				task
			};
		}

		case 'counter_propose':
		case 'question':
		case 'unparseable':
		default: {
			// Spec Correction 3: Anything not a clean confirm/decline goes to human. Hold is NOT released or auto-rebooked!
			const task = await createTask(prisma, {
				commId: input.commId,
				description: `Customer replied to confirmation: "${input.replyText}". Requires human handling (${intent}).`,
				ownerUserId: 'u_sales_owner',
				due: new Date(now.getTime() + 1 * 3600 * 1000),
				category: 'internal_followup'
			});
			return {
				intent,
				routedToHuman: true,
				holdPreserved: true,
				task
			};
		}
	}
}
