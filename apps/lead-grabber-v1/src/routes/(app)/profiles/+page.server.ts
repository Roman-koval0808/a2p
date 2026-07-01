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

	// One profile per caller. Local Contacts are the source of truth (they hold the phone, name,
	// engagement score and balance AND are the editable record). We merge them with ProfileDB
	// leads, then collapse EVERYTHING by phone so each caller appears exactly once — keeping the
	// best record for that phone (the local contact wins; otherwise the most complete profile).
	try {
		const last10 = (p: string | null | undefined) => (p || '').replace(/\D/g, '').slice(-10);
		const GENERIC = ['Unknown Caller', 'Anonymous', 'Unknown', 'Unknown Customer'];
		const isRealName = (n: any) => !!n && !GENERIC.includes(String(n));
		// ProfileDB stores the phone under several possible keys — check them all.
		const phoneOf = (p: any) =>
			last10(p.phone || p.clearPhone || p.primaryPhone || p.phone_number || p.phoneNumber);
		const hasEmail = (p: any) =>
			!!(p.email || (p.clearEmail && p.clearEmail !== '—'));
		const rank = (p: any) => {
			let s = 0;
			if (p._local) s += 1000; // prefer the actionable local contact
			if (isRealName(p.name)) s += 100;
			if (hasEmail(p)) s += 50;
			s += Number(p.scoreLive ?? p.liveScore ?? 0);
			return s;
		};

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
				lastSeen: c.updated ?? c.created ?? null,
				_local: true
			};
		});

		const byPhone = new Map<string, any>();
		const noPhone: any[] = [];
		for (const prof of [...localList, ...profiles]) {
			const key = phoneOf(prof);
			if (!key) {
				// Phoneless: keep local contacts, and ProfileDB leads only if they have a real
				// email or name (drops anonymous "Unknown Caller" twins with no phone).
				if (prof._local || hasEmail(prof) || isRealName(prof.name)) noPhone.push(prof);
				continue;
			}
			const existing = byPhone.get(key);
			if (!existing || rank(prof) > rank(existing)) byPhone.set(key, prof);
		}
		profiles = [...byPhone.values(), ...noPhone];
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
