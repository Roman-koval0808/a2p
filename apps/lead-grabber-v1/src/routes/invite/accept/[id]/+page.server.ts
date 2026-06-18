import { prisma } from '$lib/db';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { hashPassword } from '$lib/auth';

export const load: PageServerLoad = async ({ params, locals }) => {
	try {
		// Get invite data first to show info even if not logged in
		const invite = await prisma.invite.findUnique({
			where: { id: params.id },
			include: {
				company: true,
				invitedBy: true
			}
		});

		if (!invite) {
			throw error(404, 'Invitation not found');
		}

		// Validate invite status and expiry regardless of login state
		if (invite.status !== 'pending') {
			throw error(400, 'Invalid or expired invitation');
		}

		if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
			throw error(400, 'This invitation has expired');
		}

		if (!invite.company || !invite.invitedBy) {
			throw error(400, 'Invalid invitation data');
		}

		// If not logged in, return invite data with a flag
		if (!locals.user) {
			return {
				invite: {
					id: invite.id,
					email: invite.email,
					role: invite.role,
					company: {
						id: invite.company.id,
						name: invite.company.name,
						logo: invite.company.logo
					},
					invitedBy: {
						name: invite.invitedBy.name || invite.invitedBy.email
					}
				},
				requiresLogin: true
			};
		}

		// If logged in but wrong email
		if (invite.email && invite.email !== locals.user.email) {
			return {
				invite: {
					id: invite.id,
					email: invite.email,
					role: invite.role,
					company: {
						id: invite.company.id,
						name: invite.company.name,
						logo: invite.company.logo
					},
					invitedBy: {
						name: invite.invitedBy.name || invite.invitedBy.email
					}
				},
				wrongEmail: true,
				currentUserEmail: locals.user.email
			};
		}

		// User is logged in with correct email
		return {
			invite: {
				id: invite.id,
				email: invite.email,
				role: invite.role,
				company: {
					id: invite.company.id,
					name: invite.company.name,
					logo: invite.company.logo
				},
				invitedBy: {
					name: invite.invitedBy.name || invite.invitedBy.email
				}
			}
		};
	} catch (err: any) {
		console.error('Error loading invite:', err);
		if (err.status) {
			throw err;
		}
		throw error(404, 'Invitation not found');
	}
};

export const actions = {
	default: async ({ request, locals, params }) => {
		try {
			const invite = await prisma.invite.findUnique({
				where: { id: params.id }
			});

			if (!invite || invite.status !== 'pending') {
				return fail(400, { error: 'Invalid invite' });
			}

			const formData = await request.formData();
			const name = formData.get('name')?.toString();
			const password = formData.get('password')?.toString();
			const passwordConfirm = formData.get('passwordConfirm')?.toString();

			let user = locals.user;

			// If no user is logged in, create a new account
			if (!user) {
				if (!name || !password || !passwordConfirm) {
					return fail(400, { error: 'Name, password and confirmation are required' });
				}

				if (password !== passwordConfirm) {
					return fail(400, { error: 'Passwords do not match' });
				}

				try {
					// Hash password
					const hashedPassword = await hashPassword(password);

					// Create new user
					const newUser = await prisma.user.create({
						data: {
							email: invite.email || '',
							name,
							password: hashedPassword,
							emailVisibility: true,
							verified: false
						}
					});

					user = newUser;
				} catch (error: any) {
					console.error('Error creating user:', error);
					return fail(500, {
						error: error.message || 'Failed to create account'
					});
				}
			}

			// Create company member
			await prisma.companyMember.create({
				data: {
					userId: user.id,
					companyId: invite.companyId || '',
					role: invite.role || 'member',
					status: 'active',
					joinedAt: new Date()
				}
			});

			// Update the user's company
			await prisma.user.update({
				where: { id: user.id },
				data: { companyId: invite.companyId }
			});

			// Update invite status
			await prisma.invite.update({
				where: { id: invite.id },
				data: {
					status: 'accepted',
					acceptedAt: new Date()
				}
			});

			return { success: true };
		} catch (err: any) {
			console.error('Error accepting invite:', err);
			return fail(500, { error: err.message || 'Failed to accept invitation' });
		}
	}
};
