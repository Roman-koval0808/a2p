import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '$lib/db';
import { processSupportCallMeetingConfirmation } from './s1-meeting-confirm';
import { processEmergencyVoicemail, handleTechDtmfResponse, extractTasksFromEmergencyCall } from './s2-emergency-bridge';
import { processSecondEmergencyVoicemail, handleBridgeFailure } from './s3-escalation';
import { processSalesVoicemailBooking, handleInboundSmsReply } from './s4-sms-booking';
import { createContainerAtIntake } from '$lib/server/container/container-service';

describe('Real-World End-to-End Simulation of All 4 Scenarios', () => {
	let companyId: string;

	beforeAll(async () => {
		let company = await prisma.company.findFirst();
		if (!company) {
			let user = await prisma.user.findFirst();
			if (!user) {
				user = await prisma.user.create({
					data: {
						email: `demo_${Date.now()}@example.com`,
						password: 'hashed_password'
					}
				});
			}
			company = await prisma.company.create({
				data: {
					name: 'Demo Company',
					ownerId: user.id
				}
			});
		}
		companyId = company.id;
	});

	it('Scenario 1: Support Call, Meeting Scheduled & Calendar Verification', async () => {
		console.log('\n======================================================');
		console.log('--- TESTING SCENARIO 1: Support Call & Meeting Schedule ---');
		console.log('======================================================');

		const { container } = await createContainerAtIntake(prisma, {
			companyId,
			threadType: 'support',
			subject: 'Software support inquiry'
		});
		console.log(`[Intake] Created Container ${container.commRef} (ID: ${container.id})`);

		const transcript = 'Hi, this is Alice. I need some help with my software, can we schedule a meeting for tomorrow at 2 PM? My email is alice@example.com.';
		console.log(`[Voicemail Transcript]: "${transcript}"`);

		const res = await processSupportCallMeetingConfirmation({
			commId: container.id,
			companyId,
			repEnteredEmail: 'alice@example.com',
			aiExtractedEmail: 'alice@example.com',
			transcriptWeekday: 'Tuesday',
			transcriptDateStr: 'August 4th',
			transcriptHour: 14,
			callStartTime: new Date(),
			calendarEntries: [
				{
					id: 'cal_101',
					title: 'Support Session with Alice',
					startTime: new Date('2026-08-04T14:00:00Z'),
					attendees: ['alice@example.com']
				}
			],
			hasMeetingSignal: true
		});

		console.log('[Pipeline Output]:', {
			meetingDetected: res.meetingDetected,
			draftCreated: res.draftCreated,
			approvalId: res.approval?.id,
			draftContent: res.approval?.draftContent
		});

		expect(res.meetingDetected).toBe(true);
		expect(res.draftCreated).toBe(true);
		expect(res.approval?.draftContent).toContain('August 4');
	});

	it('Scenario 2: Emergency Voicemail Auto-Bridge & Task Extraction', async () => {
		console.log('\n======================================================');
		console.log('--- TESTING SCENARIO 2: Emergency Voicemail Auto-Bridge ---');
		console.log('======================================================');

		const { container } = await createContainerAtIntake(prisma, {
			companyId,
			threadType: 'emergency',
			subject: 'Burst pipe emergency'
		});

		const transcript = "My pipe burst, there's water everywhere! We need someone immediately!";
		console.log(`[Emergency Voicemail]: "${transcript}"`);

		const res = await processEmergencyVoicemail({
			commId: container.id,
			companyId,
			customerPhone: '+15550001111',
			customerName: 'Bob Builder',
			transcript
		});

		console.log('[Emergency Evaluation]:', {
			isEmergency: res.isEmergency,
			summary: res.workOrder?.emergencySummary,
			dialLadderCount: res.workOrder?.dialLadder.length,
			slaDeadline: res.workOrder?.slaDeadline
		});

		expect(res.isEmergency).toBe(true);
		expect(res.bridgeTriggered).toBe(true);

		const dtmfRes = await handleTechDtmfResponse({
			commId: container.id,
			dtmfDigit: '1',
			currentRung: 1,
			workOrder: res.workOrder!
		});

		console.log('[Tech Whisper & DTMF Response]: Press 1 -> Action:', dtmfRes.action);
		expect(dtmfRes.action).toBe('bridge_customer');

		const tasks = await extractTasksFromEmergencyCall({
			commId: container.id,
			techUserId: 'u_tech1',
			transcript: "I'll be there by 3pm to stop the water leak."
		});

		console.log('[Extracted Promises & Tasks]:', tasks.map((t) => ({ description: t.description, category: t.category, due: t.due })));
		expect(tasks.length).toBeGreaterThan(0);
	});

	it('Scenario 3: Bridge Failure & Repeat Escalation', async () => {
		console.log('\n======================================================');
		console.log('--- TESTING SCENARIO 3: Bridge Failure & Repeat Escalation ---');
		console.log('======================================================');

		const { container: container1 } = await createContainerAtIntake(prisma, {
			companyId,
			threadType: 'emergency'
		});

		const workOrder1 = (
			await processEmergencyVoicemail({
				commId: container1.id,
				companyId,
				customerPhone: '+15550002222',
				transcript: 'My pipe burst in the basement!'
			})
		).workOrder!;

		console.log('[Initial Emergency]: Container', container1.commRef, 'Rung 1 Primary Tech dialing...');

		const failRes = await handleBridgeFailure({
			commId: container1.id,
			failureType: 'tech_voicemail_no_dtmf',
			workOrder: workOrder1
		});
		console.log('[Bridge Failure]: Tech voicemail detected -> Action:', failRes.action);
		expect(failRes.action).toBe('next_rung_immediately');

		console.log('[Customer Callback]: 2nd voicemail received from same customer 1 min later...');

		const res2 = await processSecondEmergencyVoicemail({
			companyId,
			customerPhone: '+15550002222',
			firstTranscript: 'Water leak in basement.',
			secondTranscript: "Water leak getting worse, water rising fast! Call my cell at +15559998888!",
			firstCallbackNum: '+15550002222',
			secondCallbackNum: '+15559998888',
			existingContainer: container1,
			workOrder: workOrder1
		});

		console.log('[Suppression & Escalation Result]:', {
			dedupSuppressedEntryCreated: !!res2.entry,
			escalationAdvanced: res2.escalationAdvanced,
			nextTechRung: res2.nextTech.rung,
			nextTechName: res2.nextTech.name,
			updatedWhisper: res2.updatedWorkOrder.whisperText
		});

		expect(res2.escalationAdvanced).toBe(true);
		expect(res2.nextTech.rung).toBe(2);
	});

	it('Scenario 4: Sales Voicemail & SMS Confirmation Loop', async () => {
		console.log('\n======================================================');
		console.log('--- TESTING SCENARIO 4: Sales Voicemail & SMS Confirmation Loop ---');
		console.log('======================================================');

		const { container } = await createContainerAtIntake(prisma, {
			companyId,
			threadType: 'sales',
			subject: 'Test drive request'
		});

		const transcript = "Hi, I'm interested in buying a used Honda Civic. Can we do a test drive next Wednesday at 4 PM?";
		console.log(`[Sales Voicemail]: "${transcript}"`);

		const bookingRes = await processSalesVoicemailBooking({
			commId: container.id,
			companyId,
			customerPhone: '+15550003333',
			transcriptWeekday: 'Wednesday',
			vehicleInterest: 'Honda Civic',
			hour: 16,
			minute: 0,
			callStartTime: new Date(),
			availableResources: { salespeople: ['u_sales_bob'], vehicles: ['v_civic_2022'] }
		});

		console.log('[Hold & Approval Creation]:', {
			slotAvailable: bookingRes.slotAvailable,
			tentativeHoldId: bookingRes.hold?.id,
			holdExpiresAt: bookingRes.hold?.holdExpiresAt,
			draftedSms: bookingRes.approval?.draftContent
		});

		expect(bookingRes.slotAvailable).toBe(true);
		expect(bookingRes.approval?.draftContent).toContain('Wednesday');

		console.log('\n[Customer Inbound SMS]: "YES"');
		const smsReplyRes = await handleInboundSmsReply({
			commId: container.id,
			customerPhone: '+15550003333',
			replyText: 'YES',
			pendingHolds: [bookingRes.hold]
		});

		console.log('[SMS Reply State Switch]:', {
			intent: smsReplyRes.intent,
			booked: smsReplyRes.booked,
			terminalState: smsReplyRes.terminalState
		});

		expect(smsReplyRes.intent).toBe('confirm');
		expect(smsReplyRes.terminalState).toBe('booked');
	});
});
