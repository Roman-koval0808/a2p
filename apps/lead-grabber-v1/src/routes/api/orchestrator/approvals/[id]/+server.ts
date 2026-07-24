import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { sendAutomatedSms } from '$lib/server/sms';

export const POST: RequestHandler = async ({ params, request }) => {
	const { id } = params;
	try {
		const { action, rejectReason } = await request.json();

		const approval = await prisma.commApproval.findUnique({
			where: { id },
			include: { container: { include: { customerProfile: true } } }
		});

		if (!approval) {
			return json({ error: 'Approval not found' }, { status: 404 });
		}

		if (approval.state !== 'pending') {
			return json({ error: 'Approval is not in pending state' }, { status: 400 });
		}

		if (action === 'approve') {
			await prisma.commApproval.update({
				where: { id },
				data: { state: 'approved', approvedBy: 'user' }
			});

			// If it's SMS, we send it via sendAutomatedSms
			if (approval.draftType === 'sms') {
				const contextPayload: any = approval.contextPayload || {};
				const customerPhone = contextPayload.destination || approval.container.customerProfile?.phoneNumber;
				if (customerPhone) {
					try {
						await sendAutomatedSms(customerPhone, approval.draftContent, contextPayload.source);
						console.log(`[Approval API] SMS approved and sent to ${customerPhone}`);
					} catch (e) {
						console.error(`[Approval API] Failed to send SMS on approval:`, e);
						return json({ error: 'Failed to send SMS' }, { status: 500 });
					}
				}
			}
			// For email, you'd integrate Brevo/SendGrid here if needed.

			return json({ success: true, state: 'approved' });
		} else if (action === 'reject') {
			await prisma.commApproval.update({
				where: { id },
				data: { state: 'rejected', rejectedReason: rejectReason || 'Manually rejected' }
			});
			return json({ success: true, state: 'rejected' });
		} else {
			return json({ error: 'Invalid action' }, { status: 400 });
		}
	} catch (e: any) {
		console.error('[Approval API] Error processing approval:', e);
		return json({ error: e.message || 'Internal error' }, { status: 500 });
	}
};
