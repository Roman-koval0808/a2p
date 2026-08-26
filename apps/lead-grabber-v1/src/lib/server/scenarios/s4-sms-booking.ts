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
	availableResources: {
		personnel?: string[];
		assets?: string[];
		salespeople?: string[];
		vehicles?: string[];
	};
	requestedContactMethod?: string;
	aiExtractedEmail?: string;
	now?: Date;
}) {
	const now = input.now || new Date();
	const personnel =
		input.availableResources.personnel ?? input.availableResources.salespeople ?? [];
	const assets = input.availableResources.assets ?? input.availableResources.vehicles ?? [];

	// Test 4-10: Landline handling -> skip SMS, create phone-call task for rep!
	if (input.isLandline) {
		const task = await createTask(prisma, {
			commId: input.commId,
			description: `Call customer back at ${input.customerPhone} (Landline cannot receive SMS) regarding appointment request for ${input.productInterest || 'product/service'}.`,
			ownerUserId: personnel[0] || 'u_sales_owner',
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
	if (personnel.length === 0 || assets.length === 0) {
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
			personnel: personnel[0],
			asset: assets[0]
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

	// Draft the response based on requested contact method
	let draftType: 'sms' | 'email' | 'call' = 'sms';
	let draftContent = '';
	let contactMethodResolved = input.requestedContactMethod || 'sms';
	const reason = input.productInterest || 'Sales Opportunity';

	if (input.aiExtractedEmail) {
		draftType = 'email';
		draftContent = `Subject: Appointment Confirmation — ${reason} for ${explicitDateText}\n\nHi!\n\nYour appointment regarding ${reason} on ${explicitDateText} is confirmed.\n\nWe look forward to seeing you then.\n\nBest,\nThe Team`;
	} else if (contactMethodResolved === 'phone' || input.isLandline) {
		const task = await createTask(prisma, {
			commId: input.commId,
			description: `Call customer back to confirm ${reason} on ${explicitDateText}.`,
			ownerUserId: personnel[0] || 'u_sales_owner',
			due: new Date(now.getTime() + 30 * 60 * 1000),
			category: 'internal_followup',
			confidence: 0.95
		});
		return { slotAvailable: true, smsDrafted: false, taskCreated: true, task };
	} else {
		draftType = 'sms';
		draftContent = `Okay, appointment confirmed for ${reason} at ${explicitDateText}.`;
	}

	const approvalDeadline = new Date(now.getTime() + 30 * 60 * 1000); // 30 min approval deadline

	const approval = await createCustomerFacingApproval(prisma, {
		commId: input.commId,
		draftType: draftType as any,
		draftContent,
		contextPayload: {
			proposedDate: proposedDate.toISOString(),
			explicitDateText,
			holdId: hold.id,
			product: input.productInterest,
			purpose: reason,
			extractedEmail: input.aiExtractedEmail
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
	companyId?: string;
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

				if (input.companyId && activeHold.startTime) {
					try {
						// Resolve contact name for display
						let contactName: string | undefined = undefined;
						try {
							const c = await prisma.contact.findFirst({
								where: {
									companyId: input.companyId,
									OR: [{ phone: input.customerPhone }, { cell: input.customerPhone }]
								},
								select: { name: true }
							});
							if (c?.name) contactName = c.name;
						} catch (e) {}

						const displayName = contactName || input.customerPhone;
						const reason =
							(activeHold as any).booking_reason ||
							(activeHold as any).product ||
							(activeHold as any).purpose ||
							'Sales Opportunity';
						const description = `Subject / Reason: ${reason}\n\nBooked via AI Assistant (SMS Confirmation)`;

						const { createEvent } = await import('$lib/server/google-calendar');
						const startISO = new Date(activeHold.startTime).toISOString();
						const endISO = activeHold.endTime
							? new Date(activeHold.endTime).toISOString()
							: new Date(new Date(activeHold.startTime).getTime() + 60 * 60 * 1000).toISOString();

						const ev = await createEvent(input.companyId, {
							summary: `Appointment — ${displayName} (${reason})`,
							description,
							startISO,
							endISO,
							phone: input.customerPhone,
							addMeet: true
						});

						if (ev?.eventId) {
							await prisma.commHold.update({
								where: { id: activeHold.id },
								data: { calendarEventId: ev.eventId }
							});
						}

						// Internal notification to Rory / reps (No approval needed - Requirement 4)
						try {
							const { notifyRepsOfBooking } = await import('$lib/server/rep-notify');
							const dateLabel = new Date(activeHold.startTime).toLocaleString('en-US', {
								weekday: 'short',
								month: 'short',
								day: 'numeric',
								hour: 'numeric',
								minute: '2-digit'
							});
							await notifyRepsOfBooking(
								input.companyId,
								`New appointment: ${displayName} (${reason}) — ${dateLabel}`,
								{
									contactName: displayName,
									reason,
									commId: input.commId
								}
							);
						} catch (nErr) {
							console.error('[SMS Booking] Rep notification failed:', nErr);
						}
					} catch (err) {
						console.error('[SMS Booking] Google Calendar booking failed:', err);
					}
				}
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
