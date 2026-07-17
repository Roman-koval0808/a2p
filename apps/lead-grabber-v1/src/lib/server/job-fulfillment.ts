import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';
import { writeCohort2Trajectory } from './cohort2';

export interface CompleteJobResult {
	transactionClosed: boolean;
	draftsQueued: string[];
	cohort2Written: boolean;
}

/**
 * Job-fulfillment trigger (Epics 6/7). Fired when a job is marked complete:
 *  - closes the Transaction (status → closed, jobCompletedAt, paidAt),
 *  - queues the post-job messages (review request / referral / check-in) as
 *    approval-gated drafts into the consultant's queue (ACT-REV-008/009, ACT-COM-004),
 *  - writes the Cohort 2 trajectory.
 */
export async function completeJob(opts: {
	companyId: string;
	transactionId?: string;
	contactId?: string;
	phone?: string;
	customerName?: string;
	companyNumber?: string;
	gbpLink?: string;
	brand?: string;
}): Promise<CompleteJobResult> {
	const brand = opts.brand || 'RightFlush Plumbing';

	// 1. Close the transaction (if one is referenced).
	let transactionClosed = false;
	if (opts.transactionId) {
		const now = new Date();
		await prisma.transaction.update({
			where: { id: opts.transactionId },
			data: { status: 'closed', jobCompletedAt: now, paidAt: now, balanceAmount: 0 }
		});
		transactionClosed = true;
	}

	// 2. Resolve contact details for the follow-up messages.
	let contactId = opts.contactId ?? null;
	let phone = opts.phone ?? null;
	let name = opts.customerName ?? null;
	if (contactId && (!phone || !name)) {
		const contact = await prisma.contact.findUnique({ where: { id: contactId } });
		phone = phone || contact?.phone || null;
		name = name || contact?.name || null;
	}
	const who = name?.trim() || 'there';

	// 3. Queue the post-job messages as approval-gated drafts (consultant's queue).
	const draftsQueued: string[] = [];
	if (phone) {
		const gbp = opts.gbpLink || 'https://g.page/r/your-gbp/review';
		const messages: { action: string; content: string }[] = [
			{
				action: 'ACT-REV-008',
				content: `Thanks ${who}! If you're happy with the work from ${brand}, we'd really appreciate a quick review: ${gbp}`
			},
			{
				action: 'ACT-REV-009',
				content: `Thanks again ${who}! If you know anyone who needs a hand, we'd be grateful for a referral — just have them mention your name. — ${brand}`
			},
			{
				action: 'ACT-COM-004',
				content: `Hi ${who}, just checking in after your recent service with ${brand} — everything working well? Reply or call us anytime if anything comes up.`
			}
		];
		for (const m of messages) {
			await logCommunication({
				type: 'sms',
				direction: 'outbound',
				status: 'pending_approval',
				source: opts.companyNumber,
				destination: phone,
				company_id: opts.companyId,
				customer_id: contactId ?? undefined,
				summary: `[${m.action}] ${m.content.substring(0, 40)}...`,
				content: m.content,
				metadata: { action: m.action, origin: 'job_completed', transaction_id: opts.transactionId ?? null }
			});
			draftsQueued.push(m.action);
		}
	}

	// 4. Cohort 2 trajectory write.
	await writeCohort2Trajectory({
		companyId: opts.companyId,
		contactId,
		bookedJobOutcome: 'completed'
	});

	return { transactionClosed, draftsQueued, cohort2Written: true };
}
