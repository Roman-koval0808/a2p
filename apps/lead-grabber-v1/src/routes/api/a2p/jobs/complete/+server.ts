import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { completeJob } from '$lib/server/job-fulfillment';

/**
 * Job-fulfillment trigger endpoint (Epics 6/7). A rep/back-office marks a job complete;
 * this closes the transaction, queues the post-job messages (review/referral/check-in)
 * for approval, and writes the Cohort 2 trajectory. Requires an authenticated session.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const companyId = locals.user?.company?.id;
	if (!companyId) {
		return json({ ok: false, error: 'unauthorized' }, { status: 401 });
	}

	const body = await request.json().catch(() => ({}));
	const result = await completeJob({
		companyId,
		transactionId: body.transactionId,
		contactId: body.contactId,
		phone: body.phone,
		customerName: body.customerName,
		companyNumber: body.companyNumber,
		gbpLink: body.gbpLink
	});

	return json({ ok: true, ...result });
};
