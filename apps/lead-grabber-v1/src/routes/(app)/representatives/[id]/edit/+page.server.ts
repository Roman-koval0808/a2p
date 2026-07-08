import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { prisma } from '$lib/db';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const DEFAULT_SCHEDULE: Record<string, { start: string; end: string }> = {
	Monday: { start: '08:00', end: '17:00' },
	Tuesday: { start: '08:00', end: '17:00' },
	Wednesday: { start: '08:00', end: '17:00' },
	Thursday: { start: '08:00', end: '17:00' },
	Friday: { start: '08:00', end: '17:00' },
	Saturday: { start: '09:00', end: '15:00' },
	Sunday: { start: '', end: '' }
};

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user || !locals.user.company) {
		throw redirect(302, '/login');
	}
	const companyId = locals.user.company.id;

	// The list links here with the CompanyMember id, so match on that (scoped to the company).
	const member = await prisma.companyMember.findFirst({
		where: { id: params.id, companyId },
		include: { user: { select: { id: true, name: true, email: true, avatar: true } } }
	});
	if (!member) throw error(404, 'Representative not found');

	const pd = (member.profileData && typeof member.profileData === 'object'
		? (member.profileData as Record<string, any>)
		: {}) as Record<string, any>;
	const savedSchedule = (pd.schedule && typeof pd.schedule === 'object' ? pd.schedule : {}) as Record<
		string,
		{ start?: string; end?: string }
	>;
	const schedule = Object.fromEntries(
		DAYS.map((d) => [
			d,
			{
				start: savedSchedule[d]?.start ?? DEFAULT_SCHEDULE[d].start,
				end: savedSchedule[d]?.end ?? DEFAULT_SCHEDULE[d].end
			}
		])
	);

	const locations = await prisma.location.findMany({
		where: { companyId },
		select: { id: true, name: true },
		orderBy: { name: 'asc' }
	});

	return {
		rep: {
			id: member.id,
			name: member.user?.name ?? '',
			email: member.user?.email ?? '',
			avatar: member.user?.avatar ?? null,
			phone: pd.phone ?? '',
			cell: pd.cell ?? '',
			location: pd.location ?? '',
			department: pd.department ?? '',
			schedule
		},
		locations
	};
};

export const actions: Actions = {
	save: async ({ params, request, locals }) => {
		if (!locals.user || !locals.user.company) {
			return fail(401, { error: 'Not authenticated' });
		}
		const companyId = locals.user.company.id;

		const member = await prisma.companyMember.findFirst({
			where: { id: params.id, companyId },
			select: { id: true, userId: true, profileData: true }
		});
		if (!member) return fail(404, { error: 'Representative not found' });

		// Permission: company owner or an admin may edit anyone; members may edit their own profile.
		const [company, me] = await Promise.all([
			prisma.company.findUnique({ where: { id: companyId }, select: { ownerId: true } }),
			prisma.companyMember.findFirst({
				where: { userId: locals.user.id, companyId, status: 'active' },
				select: { role: true }
			})
		]);
		const allowed =
			company?.ownerId === locals.user.id ||
			me?.role === 'admin' ||
			member.userId === locals.user.id;
		if (!allowed) {
			return fail(403, { error: "You don't have permission to edit this representative." });
		}

		const form = await request.formData();
		const name = ((form.get('name') as string) || '').trim();
		const phone = ((form.get('phone') as string) || '').trim();
		const cell = ((form.get('cell') as string) || '').trim();
		const location = ((form.get('location') as string) || '').trim();
		const department = ((form.get('department') as string) || '').trim();

		// Schedule arrives as a JSON blob; normalize to exactly the seven days we render.
		let schedule: Record<string, { start: string; end: string }> = {};
		try {
			const parsed = JSON.parse((form.get('schedule') as string) || '{}');
			for (const d of DAYS) {
				const v = parsed?.[d] || {};
				schedule[d] = { start: String(v.start ?? ''), end: String(v.end ?? '') };
			}
		} catch {
			schedule = { ...DEFAULT_SCHEDULE };
		}

		const existingPd = (member.profileData && typeof member.profileData === 'object'
			? (member.profileData as Record<string, any>)
			: {}) as Record<string, any>;

		try {
			await prisma.$transaction([
				prisma.companyMember.update({
					where: { id: member.id },
					data: { profileData: { ...existingPd, phone, cell, location, department, schedule } }
				}),
				// Only touch the user's display name if one was provided (don't null it out).
				...(name ? [prisma.user.update({ where: { id: member.userId }, data: { name } })] : [])
			]);
		} catch (e) {
			console.error('[rep-edit] save failed:', e);
			return fail(500, { error: 'Could not save changes. Please try again.' });
		}

		return { success: true };
	}
};
