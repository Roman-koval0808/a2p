import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { prisma } from '$lib/db';
import {
	getConnectionInfo,
	getAvailableSlots,
	bookAppointment,
	getCustomerAppointments,
	deleteEvent
} from '$lib/server/google-calendar';
import { formatDatetime } from '$lib/server/calendar';

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

	// Deep-link params from an AI reply: ?t= pre-selects the time, ?n= name, ?p= phone,
	// ?reschedule= the EXACT event id being moved.
	const requestedTime = (url.searchParams.get('t') || '').slice(0, 16); // YYYY-MM-DDTHH:mm
	const requestedName = (url.searchParams.get('n') || '').slice(0, 80);
	const requestedPhone = (url.searchParams.get('p') || '').slice(0, 30);
	const rescheduleId = (url.searchParams.get('reschedule') || '').slice(0, 1024);

	// Resolve the appointment being rescheduled (for a clear "moving your … appointment" banner).
	// Verified against the phone-matched list so the id can only be one of THIS customer's events.
	let rescheduleLabel = '';
	let rescheduleValid = false;
	if (rescheduleId && requestedPhone && conn.connected) {
		const mine = await getCustomerAppointments(companyId, { phone: requestedPhone });
		const match = mine.find((a) => a.id === rescheduleId);
		if (match) {
			rescheduleValid = true;
			rescheduleLabel = formatDatetime(match.startISO);
		}
	}

	return {
		companyName: company.name || 'us',
		connected: conn.connected,
		days,
		requestedTime,
		requestedName,
		requestedPhone,
		rescheduleId: rescheduleValid ? rescheduleId : '',
		rescheduleLabel
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
		const rescheduleId = ((form.get('reschedule') as string) || '').trim();

		if (!slot || !name) {
			return fail(400, { error: 'Please pick a time and enter your name.' });
		}

		const r = await bookAppointment(companyId, slot, {
			summary: `Appointment — ${name}`,
			description: `Booked via self-service page.${phone ? ` Phone: ${phone}.` : ''}${email ? ` Email: ${email}.` : ''}`,
			attendeeEmail: email || null,
			phone: phone || null
		});

		if (r.status === 'busy') {
			return fail(409, { error: 'Sorry, that time was just taken — please pick another.' });
		}
		if (r.status !== 'booked') {
			return fail(500, { error: 'Could not book that time. Please try again.' });
		}

		// Reschedule: cancel the OLD appointment — but ONLY the exact event id, and ONLY after
		// re-confirming it belongs to THIS customer's phone. Otherwise we never delete anything.
		let rescheduled = false;
		if (rescheduleId && phone) {
			try {
				const mine = await getCustomerAppointments(companyId, { phone });
				if (mine.some((a) => a.id === rescheduleId)) {
					rescheduled = await deleteEvent(companyId, rescheduleId);
				} else {
					console.warn('[book] reschedule id not among this phone’s appointments — not cancelling');
				}
			} catch (e) {
				console.error('[book] reschedule cancel failed (new booking kept):', e);
			}
		}

		return { success: true, meetLink: r.meetLink, rescheduled };
	}
};
