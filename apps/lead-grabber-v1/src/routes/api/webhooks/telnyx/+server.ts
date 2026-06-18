import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const payload = await request.json();

		// Safely extract the event type
		const eventType = payload?.data?.event_type;

		if (!eventType) {
			return json({ success: false, error: 'Missing event_type' }, { status: 400 });
		}

		// 1. Parse the call.initiated event
		if (eventType === 'call.initiated') {
			const toPhoneNumber = payload?.data?.payload?.to;
			const fromPhoneNumber = payload?.data?.payload?.from;

			if (!toPhoneNumber) {
				return json({ success: false, error: 'Missing to phone number' }, { status: 400 });
			}

			// 2. Match the "to" phone number to a userId (or list of userIds in that company)
			const companyPhone = await prisma.companyPhoneNumber.findUnique({
				where: { phoneNumber: toPhoneNumber },
				include: {
					company: {
						include: {
							teamMembers: true
						}
					}
				}
			});

			if (!companyPhone) {
				console.log(`[Telnyx Webhook] Incoming call to unmatched number: ${toPhoneNumber}`);
				return json({ success: true, message: 'Number not assigned to any user/company' });
			}

			// The core user (owner of the company)
			const userId = companyPhone.company.ownerId;
			
			// All users involved in the company (owner + team members) for VoIP routing
			const userIds = Array.from(new Set([
				companyPhone.company.ownerId,
				...companyPhone.company.teamMembers.map(m => m.userId)
			]));

			console.log(`[Telnyx Webhook] call.initiated from ${fromPhoneNumber} to ${toPhoneNumber}. Owner ID: ${userId}, All Users:`, userIds);

			// TODO: Add push notification / VoIP ringing logic here using the userIds
			// e.g. querying prisma.userDevice to get VoIP tokens and sending them out.

			return json({
				success: true,
				message: 'call.initiated processed successfully',
				userId,
				userIds,
				companyId: companyPhone.company.id
			});
		}

		// Acknowledge other events so Telnyx doesn't retry them
		return json({
			success: true,
			message: `Event ${eventType} received but ignored`
		});

	} catch (error) {
		console.error('[Telnyx Webhook] Error processing webhook:', error);
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};
