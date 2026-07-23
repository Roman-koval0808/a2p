import { prisma } from '$lib/db';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { TELNYX_API_KEY } from '$env/static/private';
import { PUBLIC_BASE_URL } from '$env/static/public';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user || !user.companyId) {
		throw redirect(302, '/login');
	}

	const companyId = user.companyId;

	// Fetch pending approvals for the user's company
	// Join with Container and Person to get customer phone/email
	const approvals = await prisma.actionApproval.findMany({
		where: {
			state: 'pending',
			container: {
				companyId: companyId
			}
		},
		include: {
			container: {
				include: {
					person: true
				}
			}
		},
		orderBy: {
			approval_deadline: 'asc'
		}
	});

	return {
		approvals: JSON.parse(JSON.stringify(approvals))
	};
};

export const actions: Actions = {
	approve: async ({ request, locals }) => {
		const user = locals.user;
		if (!user || !user.companyId) return { success: false, error: 'Unauthorized' };

		const data = await request.formData();
		const approvalId = String(data.get('approval_id') || '').trim();
		const editedContent = data.has('edited_content') ? String(data.get('edited_content')).trim() : null;

		if (!approvalId) return { success: false, error: 'Missing approval ID' };

		const approval = await prisma.actionApproval.findUnique({
			where: { approval_id: approvalId },
			include: {
				container: {
					include: {
						person: true
					}
				}
			}
		});

		if (!approval) return { success: false, error: 'Approval not found' };
		if (approval.container.companyId !== user.companyId) return { success: false, error: 'Unauthorized' };
		if (approval.state !== 'pending') return { success: false, error: 'Approval is not pending' };

		const finalContent = editedContent || approval.draft_content;

		// Dispatch based on draft type
		if (approval.draft_type === 'sms') {
			// Get phone number from identifiers
			const identifiers = approval.container.person.identifiers as any[];
			const phoneId = identifiers?.find(i => i.type === 'phone');
			
			if (!phoneId?.value) {
				return { success: false, error: 'Customer has no phone number on record' };
			}

			try {
				const response = await fetch('https://api.telnyx.com/v2/messages', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${TELNYX_API_KEY}`
					},
					body: JSON.stringify({
						from: '+18005550199', // TODO: Look up company's actual number
						to: phoneId.value,
						text: finalContent
					})
				});

				if (!response.ok) {
					console.error('Telnyx SMS failed:', await response.text());
					return { success: false, error: 'Failed to send SMS via Telnyx' };
				}
			} catch (e) {
				console.error(e);
				return { success: false, error: 'Error sending SMS' };
			}
		} else if (approval.draft_type === 'email') {
			// Simulate email send for now
			console.log(`[Email Dispatch] To: ${approval.container.person.person_id}, Content: ${finalContent}`);
		}

		// Update state to approved
		await prisma.actionApproval.update({
			where: { approval_id: approvalId },
			data: { 
				state: 'approved',
				draft_content: finalContent // Save the edited content if it was changed
			}
		});

		return { success: true };
	},

	reject: async ({ request, locals }) => {
		const user = locals.user;
		if (!user || !user.companyId) return { success: false, error: 'Unauthorized' };

		const data = await request.formData();
		const approvalId = String(data.get('approval_id') || '').trim();

		if (!approvalId) return { success: false, error: 'Missing approval ID' };

		const approval = await prisma.actionApproval.findUnique({
			where: { approval_id: approvalId },
			include: { container: true }
		});

		if (!approval || approval.container.companyId !== user.companyId) {
			return { success: false, error: 'Unauthorized' };
		}

		await prisma.actionApproval.update({
			where: { approval_id: approvalId },
			data: { state: 'rejected' }
		});

		return { success: true };
	}
};
