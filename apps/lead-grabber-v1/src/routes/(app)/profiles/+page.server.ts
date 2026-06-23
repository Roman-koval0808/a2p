import { prisma } from '$lib/db';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getContactsByCompany } from '$lib/utils/contacts';

export const load: PageServerLoad = async ({ locals, fetch }) => {
	const user = locals.user;

	if (!user) {
		throw redirect(303, '/login');
	}
	if (!user.company) {
		throw redirect(303, '/create-company');
	}

	const PROFILEDB_URL = process.env.PROFILEDB_URL || 'http://localhost:6277';
	let profiles: any[] = [];
	try {
		// Get user's role to determine data access
		const companyMember = await prisma.companyMember.findFirst({
			where: {
				userId: user.id,
				companyId: user.company.id
			}
		});

		let fetchUrl = `${PROFILEDB_URL}/api/v1/tenants/clearsky-demo/profiles?limit=100`;
		
		// If user is a Representative (member), only show their assigned customers
		if (companyMember && companyMember.role === 'member') {
			fetchUrl += `&representativeId=${user.id}`;
		}

		const res = await fetch(fetchUrl);
		if (res.ok) {
			const json = await res.json();
			if (json && Array.isArray(json.data)) {
				profiles = json.data;
			}
		}
	} catch (err) {
		console.error('Failed to load profiles from ProfileDB:', err);
	}

	return { profiles };
};

export const actions: Actions = {
	deleteProfile: async ({ request, locals }) => {
		const user = locals.user;
		if (!user?.company) return fail(401, { error: 'Unauthorized' });

		const profileId = (await request.formData()).get('profileId')?.toString();
		if (!profileId) return fail(400, { error: 'Profile ID is required' });

		try {
			await prisma.contact.deleteMany({
				where: { id: profileId, companyId: user.company.id }
			});
			return { success: true };
		} catch (e) {
			console.error('Error deleting profile:', e);
			return fail(500, { error: 'Failed to delete profile' });
		}
	},
	updateProfile: async ({ request, locals }) => {
		const user = locals.user;
		if (!user?.company) return fail(401, { error: 'Unauthorized' });

		const form = await request.formData();
		const id = form.get('profileId')?.toString();
		const name = form.get('name')?.toString() ?? null;
		const email = form.get('email')?.toString() ?? null;
		const phone = form.get('phone')?.toString() ?? null;
		const avatarUrl = form.get('avatarUrl')?.toString() ?? null;

		if (!id) return fail(400, { error: 'Profile ID is required' });

		try {
			await prisma.contact.updateMany({
				where: { id, companyId: user.company.id },
				data: { name, email, phone, avatarUrl, updated: new Date() }
			});
			return { success: true };
		} catch (e) {
			console.error('Error updating profile:', e);
			return fail(500, { error: 'Failed to update profile' });
		}
	}
};
