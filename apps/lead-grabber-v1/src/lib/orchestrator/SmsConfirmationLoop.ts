import { prisma } from '$lib/db';
import { createApprovalDraft } from './ApprovalQueue';
import { createActionTask } from './TaskManager';
import { verifyCalendar } from './CalendarService';
import { createTimer } from './TimerService';

export async function processSalesVoicemail(
	comm_id: string,
	ownerId: string,
	datetime: string | null,
	customerNumber: string,
	summary: string
) {
	console.log(`💼 Processing sales voicemail logic for comm_id: ${comm_id}`);

	if (datetime) {
		const requestedDate = new Date(datetime);
		const calCheck = await verifyCalendar(ownerId, requestedDate);

		if (calCheck.status === 'match') {
			const smsDraft = `Hi, we received your inquiry. Can we schedule a quick call at ${requestedDate.toLocaleString('en-US', { timeZone: 'America/Toronto' })}? Reply YES to confirm.`;

			await createApprovalDraft({
				comm_id,
				draft_type: 'sms',
				draft_content: smsDraft,
				context_payload: { requestedDate, customerNumber },
				deadline_minutes: 60
			});
			console.log(`✅ Sales match! Created SMS approval draft for ${customerNumber}.`);
		} else {
			const smsDraft = `Hi, we received your inquiry. Unfortunately ${requestedDate.toLocaleString('en-US', { timeZone: 'America/Toronto' })} is booked. Can we find another time?`;

			await createApprovalDraft({
				comm_id,
				draft_type: 'sms',
				draft_content: smsDraft,
				context_payload: { requestedDate, customerNumber, conflict: calCheck.message },
				deadline_minutes: 60
			});
			console.log(`❌ Sales calendar conflict. Created alternative SMS approval draft for ${customerNumber}.`);
		}
	} else {
		// No datetime provided in sales call
		await createActionTask({
			comm_id,
			owner_id: ownerId,
			description: `Sales lead received from ${customerNumber}. Summary: ${summary}. Follow up via call/text.`,
			due: new Date(Date.now() + 4 * 3600000), // 4 hours SLA for sales
			category: 'customer_promise',
			confidence: 1.0
		});
	}
}

/**
 * Parses incoming SMS from a customer that has an active sales thread.
 * Identifies if they are confirming, declining, or proposing a new time.
 */
export async function parseIncomingSalesSms(comm_id: string, smsText: string) {
	console.log(`📩 Parsing incoming SMS for sales loop ${comm_id}: "${smsText}"`);
	const text = smsText.toLowerCase();

	if (text.includes('yes') || text.includes('confirm') || text.includes('sure') || text.includes('ok')) {
		console.log('✅ Customer confirmed via SMS');
		// Mark Calendar hold as firm
	} else if (text.includes('no') || text.includes('cancel')) {
		console.log('❌ Customer declined via SMS');
		// Release Calendar hold
	} else {
		console.log('🔄 Customer sent unstructured reply, escalating to human');
		// Trigger human task to read SMS
	}
}
