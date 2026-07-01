import { prisma } from '$lib/db';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getContactsByCompany } from '$lib/utils/contacts';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;

	if (!user) {
		throw redirect(303, '/login');
	}
	if (!user.company) {
		throw redirect(303, '/create-company');
	}

	// SINGLE source of truth: local Contacts only. We deliberately do NOT also pull from
	// ProfileDB here — merging two sources is what let the same caller show up twice. Contacts
	// are the editable record (they hold the phone, name, engagement score and balance), so the
	// list is built purely from them and can never accidentally contain a duplicate twin.
	let profiles: any[] = [];
	try {
		const last10 = (p: string | null | undefined) => (p || '').replace(/\D/g, '').slice(-10);
		const contacts = (await getContactsByCompany(user.company.id, 200)) as any[];
		const localList = contacts.map((c) => {
			const score = c.engagementScore ?? 0;
			return {
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
			};
		});

		// Safety net: if two Contact rows ever share a phone, keep only the higher-scored one.
		const byPhone = new Map<string, any>();
		const noPhone: any[] = [];
		for (const prof of localList) {
			const key = last10(prof.phone);
			if (!key) {
				noPhone.push(prof);
				continue;
			}
			const existing = byPhone.get(key);
			if (!existing || (prof.scoreLive ?? 0) > (existing.scoreLive ?? 0)) byPhone.set(key, prof);
		}
		profiles = [...byPhone.values(), ...noPhone];
	} catch (err) {
		console.error('Failed to load profiles from contacts:', err);
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
