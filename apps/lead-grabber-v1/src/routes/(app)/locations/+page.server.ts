import { prisma } from '$lib/db';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const HOURS_DAYS = ['Mon', 'Tue', 'Wed', 'Thurs', 'Fri', 'Sat', 'Sun'] as const;

function parseHours(form: FormData): Record<string, string> {
	const hours: Record<string, string> = {};
	for (const day of HOURS_DAYS) {
		const v = form.get(`hours_${day}`)?.toString();
		hours[day] = v ?? '';
	}
	return hours;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) throw redirect(303, '/login');
	if (!user.company) throw redirect(303, '/create-company');

	const rows = await prisma.location.findMany({
		where: { companyId: user.company.id },
		orderBy: { created: 'desc' }
	});

	const locations = rows.map((r) => ({
		id: r.id,
		name: r.name,
		address: r.address ?? '',
		city: r.city ?? '',
		phone: r.phone ?? '',
		hours: (typeof r.hours === 'object' && r.hours && !Array.isArray(r.hours)
			? (r.hours as Record<string, string>)
			: { Mon: '', Tue: '', Wed: '', Thurs: '', Fri: '', Sat: '', Sun: '' }) as Record<
			string,
			string
		>,
		created: r.created.toISOString()
	}));

	return { locations };
};

export const actions: Actions = {
	createLocation: async ({ request, locals }) => {
		const user = locals.user;
		if (!user?.company) return fail(401, { error: 'Unauthorized' });

		const form = await request.formData();
		const name = form.get('name')?.toString()?.trim();
		if (!name) return fail(400, { error: 'Name is required' });

		const hours = parseHours(form);
		try {
			await prisma.location.create({
				data: {
					companyId: user.company.id,
					name,
					address: form.get('address')?.toString()?.trim() ?? null,
					city: form.get('city')?.toString()?.trim() ?? null,
					phone: form.get('phone')?.toString()?.trim() ?? null,
					hours
				}
			});
			return { success: true };
		} catch (e) {
			console.error('Error creating location:', e);
			return fail(500, { error: 'Failed to create location' });
		}
	},

	updateLocation: async ({ request, locals }) => {
		const user = locals.user;
		if (!user?.company) return fail(401, { error: 'Unauthorized' });

		const form = await request.formData();
		const id = form.get('locationId')?.toString();
		if (!id) return fail(400, { error: 'Location ID is required' });

		const name = form.get('name')?.toString()?.trim();
		if (!name) return fail(400, { error: 'Name is required' });

		const hours = parseHours(form);
		try {
			await prisma.location.updateMany({
				where: { id, companyId: user.company.id },
				data: {
					name,
					address: form.get('address')?.toString()?.trim() ?? null,
					city: form.get('city')?.toString()?.trim() ?? null,
					phone: form.get('phone')?.toString()?.trim() ?? null,
					hours,
					updated: new Date()
				}
			});
			return { success: true };
		} catch (e) {
			console.error('Error updating location:', e);
			return fail(500, { error: 'Failed to update location' });
		}
	},

	deleteLocation: async ({ request, locals }) => {
		const user = locals.user;
		if (!user?.company) return fail(401, { error: 'Unauthorized' });

		const form = await request.formData();
		const id = form.get('locationId')?.toString();
		if (!id) return fail(400, { error: 'Location ID is required' });

		try {
			await prisma.location.deleteMany({
				where: { id, companyId: user.company.id }
			});
			return { success: true };
		} catch (e) {
			console.error('Error deleting location:', e);
			return fail(500, { error: 'Failed to delete location' });
		}
	}
};
