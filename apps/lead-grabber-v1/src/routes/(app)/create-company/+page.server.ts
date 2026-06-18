import { prisma } from '$lib/db';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { DEFAULT_PERMISSIONS } from '$lib/types/company_member';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) {
		throw redirect(303, '/login');
	}

	// Check if user already has a company
	if (user.company) {
		throw redirect(303, '/dashboard');
	}

	// Check if user is already a member of any company (invited users)
	const existingMembership = await prisma.companyMember.findFirst({
		where: {
			userId: user.id,
			status: 'active'
		}
	});

	if (existingMembership) {
		throw redirect(303, '/dashboard');
	}

	return {};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) {
			return fail(401, { error: 'Unauthorized' });
		}

		try {
			const data = await request.formData();
			const name = data.get('name')?.toString();
			const website = data.get('website')?.toString() || '';

			if (!name) {
				return fail(400, { error: 'Company name is required' });
			}

			// Create the company and update user in a transaction
			const result = await prisma.$transaction(async (tx) => {
				// Create the company
				const company = await tx.company.create({
					data: {
						name,
						website: website || null,
						ownerId: user.id,
						settings: {
							branding: {
								primary_color: '#3B5BDB',
								logo_url: ''
							},
							notifications: {
								email: true,
								web: true
							}
						}
					}
				});

				// Update the user's record with the company ID
				await tx.user.update({
					where: { id: user.id },
					data: { companyId: company.id }
				});

				// Create company member record for owner
				await tx.companyMember.create({
					data: {
						userId: user.id,
						companyId: company.id,
						role: 'owner',
						permissions: DEFAULT_PERMISSIONS.owner,
						status: 'active',
						joinedAt: new Date()
					}
				});

				return company;
			});

			// Return success response instead of redirect
			return {
				success: true,
				companyId: result.id
			};
		} catch (error) {
			console.error('Error creating company:', error);
			return fail(500, { error: 'Failed to create company' });
		}
	}
};
