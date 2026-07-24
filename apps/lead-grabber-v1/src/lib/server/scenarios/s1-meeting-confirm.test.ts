import { describe, it, expect, vi } from 'vitest';
import {
	processSupportCallMeetingConfirmation,
	searchCalendarForMeeting
} from './s1-meeting-confirm';

vi.mock('$lib/db', () => ({
	prisma: {
		commApproval: {
			create: vi.fn().mockImplementation((opts) => Promise.resolve({ id: 'appr_1', ...opts.data }))
		},
		pipelineTimer: {
			create: vi.fn().mockResolvedValue({ id: 'tmr_1' }),
			update: vi.fn().mockResolvedValue({})
		}
	}
}));

describe('Scenario 1 Acceptance Tests — Support Call & Calendar Verification (§Part 3 & 5)', () => {
	const callStartTime = new Date('2026-08-01T12:00:00Z'); // Saturday Aug 1, 2026
	// Next Tuesday is August 4th, 2026 at 10:00
	const targetMeetingTime = new Date('2026-08-04T10:00:00Z');

	it('1-7: Ordinary support call with nothing scheduled DOES NOT invent a meeting (insisted test)', async () => {
		const res = await processSupportCallMeetingConfirmation({
			commId: 'c_1',
			companyId: 'comp_1',
			callStartTime,
			calendarEntries: [],
			hasMeetingSignal: false
		});

		expect(res.meetingDetected).toBe(false);
		expect(res.draftCreated).toBe(false);
		expect(res.reason).toBe('no_meeting_scheduled');
	});

	it('1-4c: Calendar empty at T+0 starts grace period without alerting immediately (insisted test)', async () => {
		const res = await processSupportCallMeetingConfirmation({
			commId: 'c_2',
			companyId: 'comp_1',
			repEnteredEmail: 'john@example.com',
			transcriptWeekday: 'Tuesday',
			transcriptDateStr: 'August 4th',
			callStartTime,
			calendarEntries: [], // Empty at T+0!
			hasMeetingSignal: true
		});

		expect(res.meetingDetected).toBe(true);
		expect(res.draftCreated).toBe(false);
		expect(res.inGracePeriod).toBe(true);
		expect(res.reason).toBe('calendar_grace_started');
	});

	it('1-1 & 1-4a: Clean audio, calendar matching entry -> draft created successfully', async () => {
		const matchingEntries = [
			{
				id: 'cal_event_1',
				title: 'Meeting with John',
				startTime: targetMeetingTime,
				attendees: ['john@example.com']
			}
		];

		const res = await processSupportCallMeetingConfirmation({
			commId: 'c_3',
			companyId: 'comp_1',
			repEnteredEmail: 'john@example.com',
			aiExtractedEmail: 'john@example.com',
			transcriptWeekday: 'Tuesday',
			transcriptDateStr: 'August 4th',
			callStartTime,
			calendarEntries: matchingEntries,
			hasMeetingSignal: true
		});

		expect(res.meetingDetected).toBe(true);
		expect(res.draftCreated).toBe(true);
		expect(res.approval).toBeDefined();
	});

	it('1-2: Weekday/date conflict ("Tuesday August 5th" when 5th is Wednesday) -> flags conflict and blocks', async () => {
		const res = await processSupportCallMeetingConfirmation({
			commId: 'c_4',
			companyId: 'comp_1',
			repEnteredEmail: 'john@example.com',
			transcriptWeekday: 'Tuesday',
			transcriptDateStr: 'August 5th', // 5th is Wednesday!
			callStartTime,
			calendarEntries: [],
			hasMeetingSignal: true
		});

		expect(res.meetingDetected).toBe(true);
		expect(res.draftCreated).toBe(false);
		expect(res.blocked).toBe(true);
		expect(res.reason).toContain('Weekday/date conflict');
	});

	it('1-3: Rep-entered and AI-extracted email disagreement -> flags and blocks', async () => {
		const res = await processSupportCallMeetingConfirmation({
			commId: 'c_5',
			companyId: 'comp_1',
			repEnteredEmail: 'john.smith@example.com',
			aiExtractedEmail: 'j.smith@example.com',
			transcriptWeekday: 'Tuesday',
			transcriptDateStr: 'August 4th',
			callStartTime,
			calendarEntries: [],
			hasMeetingSignal: true
		});

		expect(res.meetingDetected).toBe(true);
		expect(res.draftCreated).toBe(false);
		expect(res.blocked).toBe(true);
		expect(res.reason).toContain('Email disagreement');
	});

	it('1-4b: Calendar entry at 14:00, transcript says 10:00 -> surfaces mismatch and blocks', async () => {
		const mismatchedEntries = [
			{
				id: 'cal_event_2',
				title: 'Meeting with John',
				startTime: new Date('2026-08-04T14:00:00Z'), // 14:00 instead of 10:00!
				attendees: ['john@example.com']
			}
		];

		const res = await processSupportCallMeetingConfirmation({
			commId: 'c_6',
			companyId: 'comp_1',
			repEnteredEmail: 'john@example.com',
			transcriptWeekday: 'Tuesday',
			transcriptDateStr: 'August 4th',
			transcriptHour: 10,
			callStartTime,
			calendarEntries: mismatchedEntries,
			hasMeetingSignal: true
		});

		expect(res.meetingDetected).toBe(true);
		expect(res.draftCreated).toBe(false);
		expect(res.blocked).toBe(true);
		expect(res.reason).toContain('Calendar has event at');
	});
});
