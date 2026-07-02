import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { prisma } from '$lib/db';
import { getConnectionInfo, getAvailableSlots, bookAppointment } from '$lib/server/google-calendar';

export const load: PageServerLoad = async ({ params, url }) => {
	const companyId = params.companyId;
	const company = await prisma.company.findUnique({
		where: { id: companyId },
		include: { locations: true }
	});
	if (!company) throw error(404, 'Not found');

	const conn = await getConnectionInfo(companyId);
	const days = conn.connected
		? await getAvailableSlots(companyId, {
				locations: (company as any).locations || [],
				days: 14,
				durationMin: 60
			})
		: [];

	// A requested time (?t=...) deep-links from an AI reply so the page opens pre-selected on it.
	const requestedTime = (url.searchParams.get('t') || '').slice(0, 16); // YYYY-MM-DDTHH:mm

	return {
		companyName: company.name || 'us',
		connected: conn.connected,
		days,
		requestedTime
	};
};

export const actions: Actions = {
	book: async ({ params, request }) => {
		const companyId = params.companyId;
		const form = await request.formData();
		const slot = ((form.get('slot') as string) || '').trim();
		const name = ((form.get('name') as string) || '').trim();
		const email = ((form.get('email') as string) || '').trim();
		const phone = ((form.get('phone') as string) || '').trim();

		if (!slot || !name) {
			return fail(400, { error: 'Please pick a time and enter your name.' });
		}

		const r = await bookAppointment(companyId, slot, {
			summary: `Appointment — ${name}`,
			description: `Booked via self-service page.${phone ? ` Phone: ${phone}.` : ''}${email ? ` Email: ${email}.` : ''}`,
			attendeeEmail: email || null
		});

		if (r.status === 'booked') return { success: true, meetLink: r.meetLink };
		if (r.status === 'busy') {
			return fail(409, { error: 'Sorry, that time was just taken — please pick another.' });
		}
		return fail(500, { error: 'Could not book that time. Please try again.' });
	}
};
