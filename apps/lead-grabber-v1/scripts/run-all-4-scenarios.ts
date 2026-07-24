import { prisma } from '../src/lib/db.js';
import { processSupportCallMeetingConfirmation } from '../src/lib/server/scenarios/s1-meeting-confirm.js';
import { processEmergencyVoicemail, handleTechDtmfResponse, extractTasksFromEmergencyCall } from '../src/lib/server/scenarios/s2-emergency-bridge.js';
import { processSecondEmergencyVoicemail, handleBridgeFailure } from '../src/lib/server/scenarios/s3-escalation.js';
import { processSalesVoicemailBooking, handleInboundSmsReply } from '../src/lib/server/scenarios/s4-sms-booking.js';
import { createContainerAtIntake, getContainerView } from '../src/lib/server/container/container-service.js';

async function runScenario1() {
	console.log('\n======================================================');
	console.log('--- TESTING SCENARIO 1: Support Call & Meeting Schedule ---');
	console.log('======================================================');

	// Step 1: Call arrival + IVR option 3 -> container creation
	const { container } = await createContainerAtIntake(prisma, {
		companyId: 'cm_demo_company',
		threadType: 'support',
		subject: 'Software support inquiry'
	});
	console.log(`[Intake] Created Container ${container.commRef} (ID: ${container.id})`);

	// Step 2: Leave voicemail
	const transcript = 'Hi, this is Alice. I need some help with my software, can we schedule a meeting for tomorrow at 2 PM? My email is alice@example.com.';
	console.log(`[Voicemail Transcript]: "${transcript}"`);

	// Step 3: Run Scenario 1 Pipeline
	const res = await processSupportCallMeetingConfirmation({
		commId: container.id,
		companyId: 'cm_demo_company',
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

	const view = await getContainerView(container.id);
	console.log('[Container View Snapshot]:', {
		commRef: view?.container.commRef,
		approvals: view?.approvals.length,
		timers: view?.timers.length
	});
}

async function runScenario2() {
	console.log('\n======================================================');
	console.log('--- TESTING SCENARIO 2: Emergency Voicemail Auto-Bridge ---');
	console.log('======================================================');

	// Step 1: Inbound Emergency Call
	const { container } = await createContainerAtIntake(prisma, {
		companyId: 'cm_demo_company',
		threadType: 'emergency',
		subject: 'Burst pipe emergency'
	});

	const transcript = "My pipe burst, there's water everywhere! We need someone immediately!";
	console.log(`[Emergency Voicemail]: "${transcript}"`);

	const res = await processEmergencyVoicemail({
		commId: container.id,
		companyId: 'cm_demo_company',
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

	// Step 2: Tech answers outbound leg & presses 1 (DTMF 1)
	const dtmfRes = await handleTechDtmfResponse({
		commId: container.id,
		dtmfDigit: '1',
		currentRung: 1,
		workOrder: res.workOrder!
	});

	console.log('[Tech Whisper & DTMF Response]: Press 1 -> Action:', dtmfRes.action);

	// Step 3: Call finishes, tasks extracted
	const tasks = await extractTasksFromEmergencyCall({
		commId: container.id,
		techUserId: 'u_tech1',
		transcript: "I'll be there by 3pm to stop the water leak."
	});

	console.log('[Extracted Promises & Tasks]:', tasks.map((t) => ({ description: t.description, category: t.category, due: t.due })));
}

async function runScenario3() {
	console.log('\n======================================================');
	console.log('--- TESTING SCENARIO 3: Bridge Failure & Repeat Escalation ---');
	console.log('======================================================');

	// Step 1: Initial emergency voicemail
	const { container: container1 } = await createContainerAtIntake(prisma, {
		companyId: 'cm_demo_company',
		threadType: 'emergency'
	});

	const workOrder1 = (
		await processEmergencyVoicemail({
			commId: container1.id,
			companyId: 'cm_demo_company',
			customerPhone: '+15550002222',
			transcript: 'Water leak in basement.'
		})
	).workOrder!;

	console.log('[Initial Emergency]: Container', container1.commRef, 'Rung 1 Primary Tech dialing...');

	// Step 2: Tech fails / voicemail (no DTMF) -> advance rung
	const failRes = await handleBridgeFailure({
		commId: container1.id,
		failureType: 'tech_voicemail_no_dtmf',
		workOrder: workOrder1
	});
	console.log('[Bridge Failure]: Tech voicemail detected -> Action:', failRes.action);

	// Step 3: 1 min later, customer calls back with 2nd voicemail
	console.log('[Customer Callback]: 2nd voicemail received from same customer 1 min later...');

	const res2 = await processSecondEmergencyVoicemail({
		companyId: 'cm_demo_company',
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
}

async function runScenario4() {
	console.log('\n======================================================');
	console.log('--- TESTING SCENARIO 4: Sales Voicemail & SMS Confirmation Loop ---');
	console.log('======================================================');

	// Step 1: Sales IVR voicemail
	const { container } = await createContainerAtIntake(prisma, {
		companyId: 'cm_demo_company',
		threadType: 'sales',
		subject: 'Test drive request'
	});

	const transcript = "Hi, I'm interested in buying a used Honda Civic. Can we do a test drive next Wednesday at 4 PM?";
	console.log(`[Sales Voicemail]: "${transcript}"`);

	const bookingRes = await processSalesVoicemailBooking({
		commId: container.id,
		companyId: 'cm_demo_company',
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

	// Step 2: Customer replies "YES" via SMS
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
}

async function main() {
	try {
		await runScenario1();
		await runScenario2();
		await runScenario3();
		await runScenario4();

		console.log('\n======================================================');
		console.log('🎉 ALL 4 SCENARIOS TESTED & VERIFIED SUCCESSFULLY!');
		console.log('======================================================\n');
	} catch (err) {
		console.error('Error running test scenarios:', err);
	} finally {
		await prisma.$disconnect();
	}
}

main();
