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
			// Check if user already exists
			let user = await prisma.user.findUnique({ where: { email } });

			if (!user) {
				// Create new user with a random temporary password
				const temporaryPassword = Math.random().toString(36).slice(-10) + 'A1!';
				const passwordHash = await bcrypt.hash(temporaryPassword, 10);

				user = await prisma.user.create({
					data: {
						email,
						name,
						password: passwordHash,
						role: 'agent',
						verified: true // Assuming manually added reps are verified
					}
				});
			}

			// Check if company member exists
			const existingMember = await prisma.companyMember.findUnique({
				where: {
					userId_companyId: {
						userId: user.id,
						companyId: locals.user.company.id
					}
				}
			});

			if (existingMember) {
				return fail(400, { error: 'User is already a member of this company' });
			}

			// Create company member with profile data
			await prisma.companyMember.create({
				data: {
					userId: user.id,
					companyId: locals.user.company.id,
					role: 'member', // "member" maps to Representative in our UI
					status: 'active',
					joinedAt: new Date(),
					profileData: {
						phone: phoneNumber,
						location,
						schedule
					}
				}
			});

		} catch (err: any) {
			console.error('Failed to add representative:', err);
			return fail(500, { error: err.message || 'Failed to add representative' });
		}

		throw redirect(303, '/representatives');
	}
};
