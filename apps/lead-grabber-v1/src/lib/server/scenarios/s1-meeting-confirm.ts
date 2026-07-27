import { prisma } from '$lib/db';
import { resolveRelativeDate } from '$lib/server/datetime';
import { createCustomerFacingApproval } from '$lib/server/approval/approval-service';
import { registerTimer } from '$lib/server/timer/timer-service';

export interface CalendarMatchResult {
	status: 'found' | 'mismatch' | 'not_found';
	matchingEntry?: any;
	mismatchReason?: string;
	score: number;
}

export function searchCalendarForMeeting(
	calendarEntries: Array<{
		id: string;
		title?: string;
		startTime: Date;
		attendees?: string[];
	}>,
	targetTime: Date,
	customerName?: string,
	customerEmail?: string
): CalendarMatchResult {
	if (!calendarEntries || calendarEntries.length === 0) {
		return { status: 'not_found', score: 0 };
	}

	const targetMs = targetTime.getTime();
	const windowMs = 30 * 60 * 1000; // ±30 min window

	for (const entry of calendarEntries) {
		const entryMs = new Date(entry.startTime).getTime();
		const timeDiff = Math.abs(entryMs - targetMs);

		const nameMatch = customerName
			? (entry.title || '').toLowerCase().includes(customerName.toLowerCase())
			: false;
		const emailMatch = customerEmail
			? (entry.attendees || []).some((a) => a.toLowerCase() === customerEmail.toLowerCase())
			: false;

		if (timeDiff <= windowMs) {
			if (nameMatch || emailMatch) {
				return { status: 'found', matchingEntry: entry, score: 1.0 };
			}
			return { status: 'found', matchingEntry: entry, score: 0.8 };
		}

		if (nameMatch || emailMatch) {
			// Found matching event but at a DIFFERENT time (§Scenario 1 outcome 2)
			return {
				status: 'mismatch',
				matchingEntry: entry,
				mismatchReason: `Calendar has event at ${new Date(entry.startTime).toISOString()}, transcript proposed ${targetTime.toISOString()}`,
				score: 0.5
			};
		}
	}

	return { status: 'not_found', score: 0 };
}

export async function processSupportCallMeetingConfirmation(input: {
	commId: string;
	companyId: string;
	customerProfileId?: string;
	contactId: string;
	repEnteredEmail?: string;
	aiExtractedEmail?: string;
	transcriptWeekday?: string;
	transcriptDateStr?: string;
	transcriptHour?: number;
	transcriptMinute?: number;
	callStartTime: Date;
	calendarEntries: any[];
	hasMeetingSignal: boolean;
	now?: Date;
}) {
	const now = input.now || new Date();

	// Test 1-7: Ordinary support call with nothing scheduled -> DOES NOT invent a meeting!
	if (!input.hasMeetingSignal) {
		return {
			meetingDetected: false,
			draftCreated: false,
			blocked: false,
			reason: 'no_meeting_scheduled'
		};
	}

	// Gate 1: Weekday/date consistency check (Test 1-2)
	const dateRes = resolveRelativeDate(
		input.callStartTime,
		input.transcriptWeekday,
		input.transcriptDateStr,
		input.transcriptHour || 10,
		input.transcriptMinute || 0
	);

	if (dateRes.hasConflict) {
		return {
			meetingDetected: true,
			draftCreated: false,
			blocked: true,
			reason: dateRes.conflictReason || 'weekday_date_mismatch'
		};
	}

	// Gate 2: Email capture cross-check (Test 1-3)
	let finalEmail = input.repEnteredEmail;
	if (
		input.repEnteredEmail &&
		input.aiExtractedEmail &&
		input.repEnteredEmail.toLowerCase() !== input.aiExtractedEmail.toLowerCase()
	) {
		// Flag mismatch, rep-entered is authoritative but requires verification
		return {
			meetingDetected: true,
			draftCreated: false,
			blocked: true,
			reason: `Email disagreement: Rep entered "${input.repEnteredEmail}" vs AI extracted "${input.aiExtractedEmail}"`
		};
	}
	if (!finalEmail) finalEmail = input.aiExtractedEmail;

	if (!finalEmail) {
		return {
			meetingDetected: true,
			draftCreated: false,
			blocked: true,
			reason: 'missing_email_address'
		};
	}

	// Gate 3: Calendar verification (Race condition check - T+0 check)
	const calMatch = searchCalendarForMeeting(
		input.calendarEntries,
		dateRes.resolvedDate,
		undefined,
		finalEmail
	);

	// Create a CommContainer to hold the SLA timer and the Approval draft (required for Prisma foreign keys)
	const { createContainerAtIntake } = await import('$lib/server/container/container-service');
	const container = await createContainerAtIntake(prisma, {
		companyId: input.companyId,
		customerProfileId: input.customerProfileId,
		contactId: input.contactId,
		threadType: 'support',
		sourceCommId: input.commId
	});

	// Case 1: Match found -> proceed to draft immediately (Test 1-4a)
	if (calMatch.status === 'found') {
		const draftContent = `Hi, confirming our meeting scheduled for ${dateRes.formattedExplicitText || dateRes.resolvedDate.toISOString()}.`;
		const approvalDeadline = new Date(now.getTime() + 2 * 3600 * 1000);

		const approval = await createCustomerFacingApproval(prisma, {
			commId: container.id, // Use container ID for foreign key!
			draftType: 'email',
			draftContent,
			contextPayload: {
				transcriptCaptured: {
					weekday: input.transcriptWeekday,
					dateStr: input.transcriptDateStr
				},
				systemHas: { calendarStatus: 'found', eventId: calMatch.matchingEntry?.id },
				contactDetail: { value: finalEmail, source: 'rep_entered' },
				flags: []
			},
			approvalDeadline
		});

		return {
			meetingDetected: true,
			draftCreated: true,
			blocked: false,
			approval
		};
	}

	// Case 2: Time mismatch -> block and surface both times (Test 1-4b)
	if (calMatch.status === 'mismatch') {
		return {
			meetingDetected: true,
			draftCreated: false,
			blocked: true,
			reason: calMatch.mismatchReason
		};
	}

	// Case 3: Missing at T+0 -> Start calendar_grace timer (15 min), DO NOT alert yet (Test 1-4c)
	const graceDeadline = new Date(now.getTime() + 15 * 60 * 1000);
	await registerTimer(prisma, {
		commId: container.id, // Use container ID for foreign key!
		companyId: input.companyId,
		type: 'calendar_grace',
		fireAt: graceDeadline,
		payload: {
			targetTime: dateRes.resolvedDate.toISOString(),
			email: finalEmail
		}
	});

	return {
		meetingDetected: true,
		draftCreated: false,
		blocked: false,
		inGracePeriod: true,
		reason: 'calendar_grace_started'
	};
}
