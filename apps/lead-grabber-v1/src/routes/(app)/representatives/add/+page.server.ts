import { prisma } from '$lib/db';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import bcrypt from 'bcryptjs';

export const actions: Actions = {
	addRepresentative: async ({ request, locals }) => {
		if (!locals.user || !locals.user.company) {
			return fail(401, { error: 'Unauthorized' });
		}

		const data = await request.formData();
		const firstName = data.get('firstName')?.toString() || '';
		const lastName = data.get('lastName')?.toString() || '';
		const email = data.get('email')?.toString() || '';
		const phoneNumber = data.get('phoneNumber')?.toString() || '';
		const location = data.get('location')?.toString() || '';
		const scheduleJson = data.get('schedule')?.toString() || '{}';

		if (!email || !firstName) {
			return fail(400, { error: 'Email and First Name are required' });
		}

		let schedule = {};
		try {
			schedule = JSON.parse(scheduleJson);
		} catch (e) {
			// ignore
		}

		const name = `${firstName} ${lastName}`.trim();

		try {
			// Check if user already exists in the company
			const existingUser = await prisma.user.findUnique({ where: { email } });

			if (existingUser) {
				const existingMember = await prisma.companyMember.findFirst({
					where: {
						userId: existingUser.id,
						companyId: locals.user.company.id,
						status: 'active'
					}
				});

				if (existingMember) {
					return fail(400, { error: 'User is already a member of this company' });
				}
			}

			// Check for existing pending invite for this email and company
			const existingInvite = await prisma.invite.findFirst({
				where: {
					email,
					companyId: locals.user.company.id,
					status: 'pending'
				}
			});

			if (existingInvite) {
				return fail(400, {
					error: 'A pending invitation already exists for this email address'
				});
			}

			// Create invite record with metadata
			const invite = await prisma.invite.create({
				data: {
					email,
					companyId: locals.user.company.id,
					role: 'member',
					status: 'pending',
					invitedById: locals.user.id,
					userId: existingUser?.id || null,
					expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
					metadata: {
						firstName,
						lastName,
						profileData: {
							phone: phoneNumber,
							location,
							schedule
						}
					}
				}
			});

			// Dispatch the email invite
			const { PUBLIC_BASE_URL, PUBLIC_ENV } = await import('$env/static/public');
			const { normalizeUrl } = await import('$lib/utils');
			const inviteLink = normalizeUrl(PUBLIC_BASE_URL, `/invite/accept/${invite.id}`);

			if (PUBLIC_ENV === 'production') {
				try {
					const { sendInviteEmail } = await import('$lib/server/brevo');
					const company = await prisma.company.findUnique({ where: { id: locals.user.company.id } });
					await sendInviteEmail({
						email,
						inviteId: invite.id,
						companyName: company?.name || 'Company',
						invitedByName: locals.user.name || locals.user.email
					});
				} catch (error) {
					console.error('Error sending invite email:', error);
				}
			} else {
				console.log(`[DEV] Invite link for ${email}: ${inviteLink}`);
			}

		} catch (err: any) {
			console.error('Failed to add representative:', err);
			return fail(500, { error: err.message || 'Failed to send invite' });
		}

		throw redirect(303, '/representatives');
	}
};
