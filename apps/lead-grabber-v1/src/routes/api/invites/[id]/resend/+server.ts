import { prisma } from '$lib/db';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendInviteEmail } from '$lib/server/brevo';
import { PUBLIC_BASE_URL, PUBLIC_ENV } from '$env/static/public';
import { normalizeUrl } from '$lib/utils';

export const POST: RequestHandler = async ({ params, locals }) => {
	const user = locals.user;
	if (!user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		// Verify invite belongs to user's company
		const invite = await prisma.invite.findUnique({
			where: { id: params.id },
			include: {
				company: true,
				invitedBy: true
			}
		});

		if (!invite || invite.companyId !== user.company.id) {
			return json({ error: 'Invite not found' }, { status: 404 });
		}

		if (invite.status !== 'pending') {
			return json({ error: 'Can only resend pending invites' }, { status: 400 });
		}

		// Generate invite link
		const inviteLink = normalizeUrl(PUBLIC_BASE_URL, `/invite/accept/${invite.id}`);

		// Send invite email using Brevo (only in production)
		if (PUBLIC_ENV === 'production') {
			try {
				await sendInviteEmail({
					email: invite.email || '',
					inviteId: invite.id,
					companyName: invite.company?.name || 'Company',
					invitedByName: invite.invitedBy?.name || invite.invitedBy?.email || 'Someone'
				});
			} catch (error) {
				console.error('Error sending invite email:', error);
			}
		} else {
			console.log(`[DEV] Resent invite link for ${invite.email}: ${inviteLink}`);
		}

		return json({ success: true, inviteLink });
	} catch (error) {
		console.error('Error resending invite:', error);
		return json({ error: 'Failed to resend invite' }, { status: 500 });
	}
};
