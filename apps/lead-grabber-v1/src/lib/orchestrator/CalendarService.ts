import { prisma } from '$lib/db';
import { createApprovalDraft } from './ApprovalQueue';
import { createActionTask } from './TaskManager';

interface CalendarVerifyResult {
	status: 'match' | 'mismatch' | 'not_found';
	message: string;
}

/**
 * Mock calendar verification for Scenario 1 testing.
 * In production, this would query Google Calendar or Outlook OAuth tokens for the owner.
 */
export async function verifyCalendar(
	ownerId: string,
	requestedDate: Date
): Promise<CalendarVerifyResult> {
	console.log(`📅 Verifying calendar for user ${ownerId} at ${requestedDate.toISOString()}`);
	
	// Mock: If hour is 12, it's a conflict.
	if (requestedDate.getHours() === 12) {
		return { status: 'mismatch', message: 'Owner is busy at 12:00 PM.' };
	}
	
	return { status: 'match', message: 'Slot is available.' };
}

export async function processSupportCall(
	comm_id: string,
	ownerId: string,
	datetime: string | null,
	date_confidence: 'explicit' | 'inferred' | 'conflict' | 'none',
	customerEmail: string | null
) {
	console.log(`🛠️ Processing support call logic for comm_id: ${comm_id}`);
	
	if (date_confidence === 'conflict') {
		console.log('⚠️ Date/Weekday conflict detected. Not booking. Escalating to human.');
		await createActionTask({
			comm_id,
			owner_id: ownerId,
			description: 'Customer requested a meeting but the date and weekday do not match. Please contact them.',
			due: new Date(Date.now() + 24 * 3600000), // 24 hours
			category: 'internal_followup',
			confidence: 1.0
		});
		return;
	}

	if (datetime && customerEmail) {
		const requestedDate = new Date(datetime);
		const calCheck = await verifyCalendar(ownerId, requestedDate);

		if (calCheck.status === 'match') {
			// Generate email confirmation draft
			const emailDraft = `Hi there,\n\nConfirming our meeting scheduled for ${requestedDate.toLocaleString('en-US', { timeZone: 'America/Toronto' })}.\n\nThanks,\nSupport Team`;
			
			await createApprovalDraft({
				comm_id,
				draft_type: 'email',
				draft_content: emailDraft,
				context_payload: { requestedDate, customerEmail },
				deadline_minutes: 60
			});
			console.log(`✅ Meeting match! Created email approval draft for ${customerEmail}.`);
		} else {
			// Generate alternative email draft
			const emailDraft = `Hi there,\n\nUnfortunately, the time you requested (${requestedDate.toLocaleString('en-US', { timeZone: 'America/Toronto' })}) is no longer available. Can we reschedule?\n\nThanks,\nSupport Team`;
			
			await createApprovalDraft({
				comm_id,
				draft_type: 'email',
				draft_content: emailDraft,
				context_payload: { requestedDate, customerEmail, conflict: calCheck.message },
				deadline_minutes: 60
			});
			console.log(`❌ Meeting conflict. Created alternative email approval draft for ${customerEmail}.`);
		}
	} else if (datetime && !customerEmail) {
		console.log('⚠️ Meeting requested but no email captured. Escalating to human.');
		await createActionTask({
			comm_id,
			owner_id: ownerId,
			description: `Customer requested a meeting at ${datetime} but no email was captured. Call to confirm.`,
			due: new Date(Date.now() + 2 * 3600000), // 2 hours
			category: 'internal_followup',
			confidence: 1.0
		});
	}
}
