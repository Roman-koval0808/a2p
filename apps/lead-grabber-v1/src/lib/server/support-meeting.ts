import { prisma } from '$lib/db';
import { resolveAndMergeLocalProfile } from '$lib/server/pipeline/profile-service';
import { processSupportCallMeetingConfirmation } from '$lib/server/scenarios/s1-meeting-confirm';
import { createCustomerFacingApproval } from '$lib/server/approval/approval-service';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const MEETING_KEYWORDS = [
	'meeting',
	'schedule',
	'appointment',
	'book',
	'consultation',
	'come by',
	'come out',
	'set up a time',
	'set a time'
];

/**
 * Scenario 1 live wiring: connects the support branch of process_orchestrator to the tested
 * meeting-confirmation module. Given a support call/voicemail with a scheduling intent, it:
 *   - finds the customer's open container (created at intake by the voice bridge),
 *   - extracts the email (rep field is authoritative; transcript regex is the AI cross-check),
 *   - takes the resolved appointment datetime from analysis,
 *   - VERIFIES the owner's real calendar (§Scenario 1: the calendar is a verification target),
 *   - runs processSupportCallMeetingConfirmation (draft on match, block on mismatch/weekday
 *     conflict, calendar_grace timer when absent at T+0 — the race-condition guard, test 1-4c).
 *
 * When the calendar has no matching entry at T+0, the module (correctly) does NOT alert and starts
 * the grace timer. Because approval gates the customer email, we ALSO stage a TENTATIVE email draft
 * in the approval queue (§Scenario 1 "create a tentative hold and flag — a wrong hold costs
 * nothing"), so a reviewer sees the pending confirmation immediately. Nothing is sent without
 * approval; the grace re-check still governs whether an alert fires.
 */
export async function runSupportMeetingConfirmation(
	input: {
		companyId: string;
		customerPhone: string;
		customerName?: string | null;
		repEnteredEmail?: string | null;
		transcript: string;
		/** Resolved appointment datetime from call analysis (ISO), if any. */
		datetimeIso?: string | null;
		callStartTime: Date;
		now?: Date;
	},
	tx?: any
): Promise<{ ran: boolean; reason?: string; draftCreated?: boolean; blocked?: boolean; commId?: string }> {
	const db = tx || prisma;
	const now = input.now || new Date();
	const text = input.transcript || '';

	// Meeting signal: a scheduling keyword AND a resolvable datetime. Conservative — no datetime
	// means nothing to confirm, so we do not invent a meeting (test 1-7).
	const hasMeetingKeyword = MEETING_KEYWORDS.some((kw) => text.toLowerCase().includes(kw));
	if (!hasMeetingKeyword || !input.datetimeIso) {
		return { ran: false, reason: 'no_meeting_signal' };
	}

	// Find the customer's open container (created by the voice intake bridge).
	let customerProfileId: string | null = null;
	try {
		const profile = await resolveAndMergeLocalProfile(db, {
			companyId: input.companyId,
			phone: input.customerPhone,
			name: input.customerName || undefined
		});
		customerProfileId = profile?.id ?? null;
	} catch {
		customerProfileId = null;
	}
	if (!customerProfileId) return { ran: false, reason: 'no_profile' };

	const containers = await db.commContainer.findMany({
		where: { companyId: input.companyId, customerProfileId, state: { not: 'closed' } },
		orderBy: { openedAt: 'desc' }
	});
	// Prefer a support/general container; fall back to the most recent open one.
	const container =
		containers.find((c: any) => c.threadType === 'support' || c.threadType === 'general') ||
		containers[0];
	if (!container) return { ran: false, reason: 'no_container' };

	const aiEmail = (text.match(EMAIL_RE) || [])[0] || undefined;
	const target = new Date(input.datetimeIso);

	// Verify the owner's real calendar within a ±35-minute window around the proposed time.
	let calendarEntries: any[] = [];
	try {
		const { listEvents } = await import('$lib/server/google-calendar');
		const from = new Date(target.getTime() - 35 * 60 * 1000).toISOString();
		const to = new Date(target.getTime() + 35 * 60 * 1000).toISOString();
		calendarEntries = await listEvents(input.companyId, from, to);
	} catch (e) {
		console.error('[SupportMeeting] calendar list failed, treating as empty:', e);
		calendarEntries = [];
	}

	const result = await processSupportCallMeetingConfirmation({
		commId: container.id,
		companyId: input.companyId,
		customerProfileId,
		repEnteredEmail: input.repEnteredEmail || undefined,
		aiExtractedEmail: aiEmail,
		transcriptDateStr: input.datetimeIso.slice(0, 10),
		transcriptHour: target.getUTCHours(),
		transcriptMinute: target.getUTCMinutes(),
		callStartTime: input.callStartTime,
		calendarEntries,
		hasMeetingSignal: true,
		now
	});

	// Not-found at T+0: the module started the grace timer (no alert). Stage a TENTATIVE email draft
	// so the approval queue reflects the pending confirmation. Only when we have an email to send to.
	if (result.meetingDetected && !result.draftCreated && !result.blocked && (result as any).inGracePeriod) {
		const email = input.repEnteredEmail || aiEmail;
		if (email) {
			await createCustomerFacingApproval(db, {
				commId: container.id,
				draftType: 'email',
				draftContent: `Hi${input.customerName ? ' ' + input.customerName : ''}, confirming our meeting for ${target.toUTCString()}. Please reply if anything needs to change.`,
				contextPayload: {
					transcriptCaptured: { datetime: input.datetimeIso },
					systemHas: { calendarStatus: 'created_tentative' },
					contactDetail: {
						value: email,
						source: input.repEnteredEmail && aiEmail ? 'both_agree' : input.repEnteredEmail ? 'rep_entered' : 'ai_extracted'
					},
					flags: ['calendar_entry_tentative', 'calendar_grace_pending']
				},
				approvalDeadline: new Date(now.getTime() + 2 * 3600 * 1000)
			});
			return { ran: true, draftCreated: true, blocked: false, commId: container.id, reason: 'tentative_draft_grace' };
		}
	}

	return {
		ran: true,
		draftCreated: !!result.draftCreated,
		blocked: !!result.blocked,
		commId: container.id,
		reason: result.reason
	};
}
