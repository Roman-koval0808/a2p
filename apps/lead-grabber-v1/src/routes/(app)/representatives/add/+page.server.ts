import { prisma } from '$lib/db';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import bcrypt from 'bcryptjs';
import { invalidScheduleDays } from '$lib/utils/time';

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

		// Reject improper shift times (end before/equal start, malformed, or a half-filled day).
		const invalid = invalidScheduleDays(schedule as any);
		if (invalid.length > 0) {
			return fail(400, { error: `Invalid schedule times on ${invalid.join(', ')}.` });
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

			// A representative is a record the business keeps about its own staff — a name, a
			// number and a shift — not an account somebody has to claim. Creating them as a
			// PENDING INVITE meant a rep sat unusable until they clicked a link in an email:
			// they showed as "pending" on this page and, because the callback rota reads active
			// CompanyMember rows, they were never rung. So the member is created active here and
			// now. Logging in is a separate concern, handled below.
			const profileData = { phone: phoneNumber, location, schedule };

			// Reuse the account if the person already has one — never touch their password.
			let userId = existingUser?.id;
			if (!userId) {
				// CompanyMember requires a User, and User.password is required. A rep added this
				// way has no login until they set a password via the reset flow; the random value
				// is unguessable so the account is not left open in the meantime.
				const placeholderPassword = await bcrypt.hash(crypto.randomUUID(), 10);
				const created = await prisma.user.create({
					data: {
						email,
						name,
						password: placeholderPassword,
						companyId: locals.user.company.id
					}
				});
				userId = created.id;
			}

			// Re-activating someone previously removed must not trip the [userId, companyId]
			// unique constraint, so this is an upsert rather than a create.
			await prisma.companyMember.upsert({
				where: { userId_companyId: { userId, companyId: locals.user.company.id } },
				update: {
					role: 'member',
					status: 'active',
					profileData
				},
				create: {
					userId,
					companyId: locals.user.company.id,
					role: 'member',
					status: 'active',
					joinedAt: new Date(),
					profileData
				}
			});
		} catch (err: any) {
			console.error('Failed to add representative:', err);
			return fail(500, { error: err.message || 'Failed to add representative' });
		}

		throw redirect(303, '/representatives');
	}
};
