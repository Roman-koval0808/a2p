import { prisma } from '$lib/db';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.user.company) {
		throw redirect(302, '/login');
	}

try {
			const rooms = await prisma.viewRoom.findMany({
				where: { ownerCompanyId: locals.user.company.id },
				orderBy: { created: 'desc' }
			});

			const representatives = await prisma.companyMember.findMany({
			where: {
				companyId: locals.user.company.id,
				role: 'member', // Fetch only members, treating them as Representatives
				status: 'active'
			},
			include: {
				user: {
					select: {
						id: true,
						name: true,
						email: true,
						avatar: true
					}
				}
			},
			orderBy: {
				created: 'desc'
			}
		});

		// Parse profileData or provide default empty structure
		const formattedReps = representatives.map(rep => {
			let profileData: any = {
				phone: '',
				location: '',
				schedule: {
					Monday: { start: '08:00', end: '17:00' },
					Tuesday: { start: '08:00', end: '17:00' },
					Wednesday: { start: '08:00', end: '17:00' },
					Thursday: { start: '08:00', end: '17:00' },
					Friday: { start: '08:00', end: '17:00' },
					Saturday: { start: '09:00', end: '15:00' },
					Sunday: { start: '', end: '' }
				}
			};

			if (rep.profileData && typeof rep.profileData === 'object') {
				profileData = { ...profileData, ...(rep.profileData as object) };
			}

			return {
				id: rep.id,
				name: rep.user?.name || 'Unknown',
				email: rep.user?.email || 'No email',
				phone: profileData.phone,
				location: profileData.location,
				schedule: profileData.schedule,
				avatar: rep.user?.avatar,
				rooms: rooms
					.filter(room => room.representative.includes(rep.id))
					.map(room => ({ id: room.id, title: room.title, created: room.created }))
			};
		});

		const pendingInvites = await prisma.invite.findMany({
			where: {
				companyId: locals.user.company.id,
				role: 'member',
				status: 'pending'
			},
			orderBy: {
				created: 'desc'
			}
		});

		const formattedInvites = pendingInvites.map(invite => {
			let profileData: any = {};
			let firstName = '';
			let lastName = '';
			
			if (invite.metadata && typeof invite.metadata === 'object') {
				const meta = invite.metadata as any;
				profileData = meta.profileData || {};
				firstName = meta.firstName || '';
				lastName = meta.lastName || '';
			}

			return {
				id: invite.id,
				name: `${firstName} ${lastName}`.trim() || invite.email || 'Pending Invite',
				email: invite.email,
				phone: profileData.phone || '',
				location: profileData.location || '',
				schedule: profileData.schedule || {},
				isPending: true,
				rooms: []
			};
		});

		return {
			representatives: formattedReps,
			pendingInvites: formattedInvites
		};
	} catch (err) {
		console.error('Error fetching representatives:', err);
		return { representatives: [], pendingInvites: [] };
	}
};

export const actions: Actions = {
	/**
	 * Remove a representative.
	 *
	 * The member row is set `inactive`, not deleted. A rep's user id is referenced by comm logs,
	 * assigned messages and tasks, so deleting the row would either fail on a foreign key or strip
	 * the author off historical records — the same reasoning the identity rules apply to contacts.
	 * `inactive` drops them out of this page and out of the callback rota, which is what "delete"
	 * means to the person clicking it.
	 *
	 * Pending invites predate the direct-add change and are still deleted outright: nothing points
	 * at them and an unaccepted invite has no history worth keeping.
	 */
	deleteRepresentative: async ({ request, locals }) => {
		if (!locals.user?.company) return fail(401, { error: 'Unauthorized' });

		const data = await request.formData();
		const id = data.get('id')?.toString();
		const isPending = data.get('isPending')?.toString() === 'true';
		if (!id) return fail(400, { error: 'Missing representative id' });

		const companyId = locals.user.company.id;

		try {
			if (isPending) {
				// Scoped to the company so an id from another tenant cannot be cancelled.
				const removed = await prisma.invite.deleteMany({ where: { id, companyId } });
				if (removed.count === 0) return fail(404, { error: 'Invite not found' });
				return { success: true };
			}

			const removed = await prisma.companyMember.updateMany({
				where: { id, companyId, role: 'member' },
				data: { status: 'inactive' }
			});
			if (removed.count === 0) return fail(404, { error: 'Representative not found' });
			return { success: true };
		} catch (err: any) {
			console.error('Failed to remove representative:', err);
			return fail(500, { error: err.message || 'Failed to remove representative' });
		}
	}
};
