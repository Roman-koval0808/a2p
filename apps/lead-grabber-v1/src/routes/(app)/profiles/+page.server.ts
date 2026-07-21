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

		// The intent bucket is assigned by SIGNAL, never recomputed from a score band (developer
		// brief P1.3, Four Intent Buckets §3.1). The only bucket the main database can evidence is
		// Emergency — the orchestrator records `message_category` on the communication, and an
		// emergency signal overrides every other bucket at any score. Anything else is left
		// `unclassified` rather than guessed: the real CDP bucket is not stored in this database.
		const latestByContact = new Map<string, string>();
		try {
			const recent = await prisma.communicationLog.findMany({
				where: { companyId: user.company.id, customerId: { not: null } },
				orderBy: { created: 'desc' },
				select: { customerId: true, metadata: true },
				take: 500
			});
			for (const log of recent) {
				if (!log.customerId || latestByContact.has(log.customerId)) continue;
				const category = (log.metadata as Record<string, any>)?.message_category;
				if (typeof category === 'string') latestByContact.set(log.customerId, category);
			}
		} catch (e: any) {
			console.error('[profiles] could not read latest classification:', e?.message || e);
		}
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
				// Tier is an ATTRIBUTION judgement (do we have an identifier for this person?), not a
				// measure of engagement. Deriving it from engagementScore combined the two dimensions
				// the canonical tiers doc says must never be combined (§4.1 "Two Confidence Dimensions
				// — Never Combined"), so a highly-engaged anonymous visitor was reported as Tier 1.
				// Locked model: 1 = strong identifier · 2 = name only · 2B = real but no identifier.
				tier: c.phone || c.email ? 'Tier 1' : c.name ? 'Tier 2' : 'Tier 2B',
				scoreLive: score,
				// NOT score >= 20 ? 'active' : 'research' — that threshold matches none of the
				// canonical bands (research 9-34 / comparison 35-49 / active 50-74) and could never
				// produce 'emergency', so a flooded-basement caller on score 25 was shown as an
				// Active Project.
				intentBucket: latestByContact.get(c.id) === 'emergency' ? 'emergency' : 'unclassified',
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
