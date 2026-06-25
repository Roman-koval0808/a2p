import { prisma } from '$lib/db';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { sendInviteEmail } from '$lib/server/brevo';
import { PUBLIC_BASE_URL, PUBLIC_ENV } from '$env/static/public';
import { saveUploadedFile } from '$lib/utils/file-upload';
import { normalizeUrl } from '$lib/utils';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user;
	if (!user) {
		throw redirect(303, '/login');
	}

	try {
		const isPlatformStaff = user.platformRole === 'CLEARSKY_ADMIN';
		const targetCompanyId = (isPlatformStaff && url.searchParams.get('companyId')) 
			? url.searchParams.get('companyId') 
			: user.company?.id;

		if (!targetCompanyId) {
			console.error('No target company found for user:', user);
			throw redirect(303, '/create-company');
		}

		// Get company with owner relation
		const company = await prisma.company.findUnique({
			where: { id: targetCompanyId },
			include: {
				owner: true
			}
		});

		if (!company) {
			throw redirect(303, '/create-company');
		}

		// Get company members with user data
		const members = await prisma.companyMember.findMany({
			where: {
				companyId: company.id,
				status: 'active',
				role: { not: 'support' }
			},
			include: {
				user: true
			},
			orderBy: {
				created: 'desc'
			},
			take: 50
		});

		console.log('members', members);

		if (!members.length) {
			console.warn('No members found for company:', company.id);
		}

		// Get current user's role from company_members
		const currentUserMember = members.find((m) => m.userId === user.id);
		const userRole = currentUserMember?.role || 'member';
		const isAdminOrOwner =
			userRole === 'admin' || userRole === 'owner' || company.ownerId === user.id || isPlatformStaff;

		// Parse settings if it's a string, otherwise use as-is
		let settings = company.settings;
		if (typeof settings === 'string') {
			try {
				settings = JSON.parse(settings);
			} catch {
				settings = {
					branding: { primary_color: '#000000' },
					notifications: { email: true, web: true, sms: false, phone_numbers: [] }
				};
			}
		}

		// Ensure all properties exist
		if (settings && typeof settings === 'object') {
			const s = settings as any;
			if (!s.notifications) s.notifications = {};
			if (s.notifications.email === undefined) s.notifications.email = true;
			if (s.notifications.web === undefined) s.notifications.web = true;
			if (s.notifications.sms === undefined) s.notifications.sms = false;
			if (!s.notifications.phone_numbers) s.notifications.phone_numbers = [];
		}

		// Get pending invites
		const pendingInvites = await prisma.invite.findMany({
			where: {
				companyId: company.id,
				status: 'pending'
			},
			orderBy: {
				created: 'desc'
			},
			take: 50
		});

		return {
			company: {
				id: company.id,
				name: company.name,
				website: company.website,
				logo: company.logo,
				owner: company.ownerId,
				settings: settings || {
					branding: { primary_color: '#000000' },
					notifications: { email: true, web: true, sms: false, phone_numbers: [] }
				}
			},
			members: members.map((member) => ({
				id: member.id,
				user: member.user,
				role: member.role,
				joined_at: member.joinedAt?.toISOString() || new Date().toISOString()
			})),
			pendingInvites: pendingInvites.map((invite) => ({
				id: invite.id,
				email: invite.email,
				role: invite.role,
				status: invite.status,
				created: invite.created.toISOString()
			})),
			userRole,
			isAdminOrOwner
		};
	} catch (error: any) {
		console.error('Error loading company:', error);
		// If company not found or other error, redirect to create company
		if (error.status === 404 || !user.company) {
			throw redirect(303, '/create-company');
		}
		return {
			company: null,
			members: [],
			error: 'Failed to load company'
		};
	}
};

export const actions: Actions = {
	updateCompany: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) {
			return fail(401, { error: 'Unauthorized' });
		}

		try {
			const formData = await request.formData();
			const targetCompanyId = formData.get('companyId') as string || user.company?.id;
			if (!targetCompanyId) return fail(404, { error: 'Company not found' });

			const name = formData.get('name') as string;
			const website = formData.get('website') as string;
			const primaryColor = formData.get('primaryColor') as string;
			const logo = formData.get('logo') as File;
			const emailNotifications = formData.get('emailNotifications') === 'true';
			const webNotifications = formData.get('webNotifications') === 'true';
			const smsNotifications = formData.get('smsNotifications') === 'true';
			const notificationPhonesRaw = formData.getAll('notificationPhones');

			// Get current company
			const company = await prisma.company.findUnique({
				where: { id: targetCompanyId }
			});

			if (!company) {
				return fail(404, { error: 'Company not found' });
			}

			// Check if user is owner or admin or platform staff
			const isPlatformStaff = user.platformRole === 'CLEARSKY_ADMIN';
			const userMember = await prisma.companyMember.findFirst({
				where: {
					userId: user.id,
					companyId: company.id,
					status: 'active'
				}
			});

			const isOwner = company.ownerId === user.id;
			const isAdmin = userMember?.role === 'admin';

			if (!isOwner && !isAdmin && !isPlatformStaff) {
				return fail(403, {
					error: 'Only company owners and admins can update company settings'
				});
			}

			const notificationPhones = notificationPhonesRaw
				.map((num) => num.toString().trim())
				.filter(Boolean);

			const updateData: any = {
				name,
				website: website || null,
				settings: {
					branding: { primary_color: primaryColor },
					notifications: {
						email: emailNotifications,
						web: webNotifications,
						sms: smsNotifications,
						phone_numbers: notificationPhones
					},
					webhook_url: `${PUBLIC_BASE_URL}/api/telnyx/webhook`
				}
			};

			// Handle file upload for logo
			if (logo instanceof File && logo.size > 0) {
				try {
					const logoPath = await saveUploadedFile(logo, `company-${company.id}-${Date.now()}`);
					updateData.logo = logoPath;
				} catch (error: any) {
					console.error('Error uploading logo:', error);
					return fail(400, { error: error.message || 'Failed to upload logo' });
				}
			}

			await prisma.company.update({
				where: { id: company.id },
				data: updateData
			});
			return { success: true };
		} catch (error) {
			console.error('Error updating company:', error);
			return fail(500, { error: 'Failed to update company' });
		}
	},

	inviteMember: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) {
			return fail(401, { error: 'Unauthorized' });
		}

		try {
			const data = await request.formData();
			const targetCompanyId = data.get('companyId')?.toString() || user.company?.id;
			if (!targetCompanyId) return fail(404, { error: 'Company not found' });

			const email = data.get('email')?.toString();
			const role = (data.get('role')?.toString() || 'member') as 'admin' | 'member';

			// Validate role
			if (!['admin', 'member'].includes(role)) {
				return fail(400, { error: 'Invalid role. Only admin and member roles are allowed.' });
			}

			if (!email) {
				return fail(400, { error: 'Email is required' });
			}

			// Get company and check if user has permission to invite
			const company = await prisma.company.findUnique({
				where: { id: targetCompanyId }
			});

			if (!company) {
				return fail(404, { error: 'Company not found' });
			}

			const isPlatformStaff = user.platformRole === 'CLEARSKY_ADMIN';
			if (company.ownerId !== user.id && !isPlatformStaff) {
				return fail(403, { error: 'Only company owners can invite members' });
			}

			// Check if user already exists
			const existingUser = await prisma.user.findUnique({
				where: { email }
			});

			// Check for existing pending invite for this email and company
			const existingInvite = await prisma.invite.findFirst({
				where: {
					email,
					companyId: company.id,
					status: 'pending'
				}
			});

			if (existingInvite) {
				return fail(400, {
					error: 'A pending invitation already exists for this email address'
				});
			}

			// Check if user is already a member of this company
			if (existingUser) {
				const existingMember = await prisma.companyMember.findFirst({
					where: {
						userId: existingUser.id,
						companyId: company.id,
						status: 'active'
					}
				});

				if (existingMember) {
					return fail(400, { error: 'This user is already a member of your company' });
				}
			}

			// Create invite record
			const invite = await prisma.invite.create({
				data: {
					email,
					companyId: company.id,
					role,
					status: 'pending',
					invitedById: user.id,
					userId: existingUser?.id || null,
					expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
				}
			});

			// Generate invite link
			const inviteLink = normalizeUrl(PUBLIC_BASE_URL, `/invite/accept/${invite.id}`);

			// Send invite email using Brevo (only in production)
			if (PUBLIC_ENV === 'production') {
				try {
					await sendInviteEmail({
						email,
						inviteId: invite.id,
						companyName: company.name || 'Company',
						invitedByName: user.name || user.email
					});
				} catch (error) {
					// Log error but don't fail - we'll still return the invite link
					console.error('Error sending invite email:', error);
				}
			} else {
				// In development, log to console
				console.log(`[DEV] Invite link for ${email}: ${inviteLink}`);
			}

			return { success: true, inviteLink };
		} catch (error) {
			console.error('Error sending invite:', error);
			return fail(500, { error: 'Failed to send invitation' });
		}
	}
};
