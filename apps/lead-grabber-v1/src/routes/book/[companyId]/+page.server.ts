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
	// ?reschedule= the EXACT event id being moved, ?cancel= the EXACT event id being cancelled.
	const requestedTime = (url.searchParams.get('t') || '').slice(0, 16); // YYYY-MM-DDTHH:mm
	const requestedName = (url.searchParams.get('n') || '').slice(0, 80);
	const requestedPhone = (url.searchParams.get('p') || '').slice(0, 30);
	const rescheduleId = (url.searchParams.get('reschedule') || '').slice(0, 1024);
	const cancelId = (url.searchParams.get('cancel') || '').slice(0, 1024);

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

	// Resolve the appointment being cancelled the SAME safe way: the id must belong to THIS phone
	// and still be upcoming. An invalid/expired link just falls through to the normal booking page.
	let cancelLabel = '';
	let cancelValid = false;
	if (cancelId && requestedPhone && conn.connected) {
		const mine = await getCustomerAppointments(companyId, { phone: requestedPhone });
		const match = mine.find((a) => a.id === cancelId && !a.isPast);
		if (match) {
			cancelValid = true;
			cancelLabel = formatDatetime(match.startISO);
		}
	}

	return {
		companyId,
		companyName: company.name || 'us',
		connected: conn.connected,
		days,
		requestedTime,
		requestedName,
		requestedPhone,
		rescheduleId: rescheduleValid ? rescheduleId : '',
		rescheduleLabel,
		cancelId: cancelValid ? cancelId : '',
		cancelLabel
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
	},

	// Self-service cancellation. Only cancels the EXACT event id, and ONLY after re-confirming it
	// belongs to THIS customer's phone — the same guard the reschedule path uses, so a tampered or
	// stale link can never cancel someone else's appointment.
	cancel: async ({ params, request }) => {
		const companyId = params.companyId;
		const form = await request.formData();
		const cancelId = ((form.get('cancel') as string) || '').trim();
		const phone = ((form.get('phone') as string) || '').trim();

		if (!cancelId || !phone) {
			return fail(400, { error: 'We could not verify which appointment to cancel.' });
		}

		try {
			const mine = await getCustomerAppointments(companyId, { phone });
			const match = mine.find((a) => a.id === cancelId);
			if (!match) {
				return fail(404, { error: "We couldn't find that appointment under your number." });
			}
			const ok = await deleteEvent(companyId, cancelId);
			if (!ok) {
				return fail(500, { error: 'Could not cancel that appointment. Please try again.' });
			}
			return { cancelled: true, cancelledLabel: formatDatetime(match.startISO) };
		} catch (e) {
			console.error('[book] cancel failed:', e);
			return fail(500, { error: 'Could not cancel that appointment. Please try again.' });
		}
	}
};
