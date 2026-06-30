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

		let fetchUrl = `${PROFILEDB_URL}/api/v1/tenants/${locals.user.company.id}/profiles?limit=100`;
		
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

	// Always merge in local contacts so every caller with a profile shows here — even when
	// ProfileDB is unreachable or hasn't ingested a freshly-created caller yet.
	try {
		const last10 = (p: string | null | undefined) => (p || '').replace(/\D/g, '').slice(-10);
		const seen = new Set(profiles.map((p: any) => last10(p.phone || p.clearPhone)).filter(Boolean));
		const contacts = (await getContactsByCompany(user.company.id, 200)) as any[];
		for (const c of contacts) {
			const d = last10(c.phone);
			if (d && seen.has(d)) continue;
			if (d) seen.add(d);
			const score = c.engagementScore ?? 0;
			profiles.push({
				id: c.id,
				name: c.name || '',
				phone: c.phone || '',
				clearPhone: c.phone || '—',
				email: c.email || '',
				clearEmail: c.email || '—',
				isAnonymous: !c.name,
				tier: score >= 50 ? 'T1' : score >= 20 ? 'T2A' : score >= 10 ? 'T2B' : 'T3',
				scoreLive: score,
				intentBucket: score >= 20 ? 'active' : 'research',
				lastSeen: c.updated ?? c.created ?? null
			});
		}
	} catch (err) {
		console.error('Failed to merge local contacts into profiles:', err);
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
