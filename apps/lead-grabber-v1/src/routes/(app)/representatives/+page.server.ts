import { prisma } from '$lib/db';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.user.company) {
		throw redirect(302, '/login');
	}

	try {
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
				rooms: [] // Mocked rooms for now
			};
		});

		return {
			representatives: formattedReps
		};
	} catch (err) {
		console.error('Error fetching representatives:', err);
		return { representatives: [] };
	}
};
