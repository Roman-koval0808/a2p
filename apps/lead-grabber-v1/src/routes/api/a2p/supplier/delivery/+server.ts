import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logCommunication } from '$lib/utils/communication-log';
import { prisma } from '$lib/db';

/**
 * Supplier-delivery-received trigger (Epic 6, T6.5). Back-office marks a supplier
 * delivery as received; queues the "your unit has arrived" arrival notice as an
 * approval-gated draft (Sarah's queue) for the linked customer.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const companyId = locals.user?.company?.id;
	if (!companyId) {
		return json({ ok: false, error: 'unauthorized' }, { status: 401 });
	}

	const body = await request.json().catch(() => ({}));
	const { transactionId, contactId, phone, customerName, companyNumber } = body;

	let toPhone = phone as string | undefined;
	let name = customerName as string | undefined;
	let contact = contactId as string | undefined;
	if (transactionId && (!toPhone || !contact)) {
		const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
		contact = contact || tx?.contactId || undefined;
	}
	if (contact && (!toPhone || !name)) {
		const c = await prisma.contact.findUnique({ where: { id: contact } });
		toPhone = toPhone || c?.phone || undefined;
		name = name || c?.name || undefined;
	}

	if (!toPhone) {
		return json({ ok: false, error: 'no_contact_phone' }, { status: 400 });
	}

	const who = name?.trim() || 'there';
	const content = `Hi ${who}, your unit has arrived at our shop. We'll be in touch to schedule installation. — RightFlush Plumbing`;
	await logCommunication({
		type: 'sms',
		direction: 'outbound',
		status: 'pending_approval',
		source: companyNumber,
		destination: toPhone,
		company_id: companyId,
		customer_id: contact,
		summary: `[arrival_notice] ${content.substring(0, 40)}...`,
		content,
		metadata: { action: 'arrival_notice', origin: 'supplier_delivery', transaction_id: transactionId ?? null }
	});

	return json({ ok: true, draftQueued: true });
};
