import { prisma } from '$lib/db';
import { isTimeFree, createEvent, getAvailableSlots } from './google-calendar';

const AFFIRMATIVE =
	/\b(yes|yep|yeah|yup|sure|ok|okay|sounds good|that works|works for me|works|confirm|confirmed|great|perfect|book it|let'?s do it)\b/i;

/** Heuristic: does an inbound reply affirm a proposed time? */
export function isAffirmative(message: string | null | undefined): boolean {
	return AFFIRMATIVE.test((message || '').toLowerCase());
}

export interface Proposal {
	requestedISO: string | null;
	proposedStartISO: string;
	proposedEndISO: string;
	proposedLabel: string;
	booked?: boolean;
	appointmentId?: string;
}

/**
 * Check the requested time against the live calendar. If it's free, propose it; if it's
 * taken (or none was given), propose the next open slot. Returns null proposal if the
 * calendar isn't connected or has no availability.
 */
export async function proposeAppointment(
	companyId: string,
	requestedISO: string | null,
	durationMin = 60
): Promise<{ requestedFree: boolean | null; proposal: Proposal | null }> {
	let requestedFree: boolean | null = null;
	if (requestedISO) {
		const end = new Date(new Date(requestedISO).getTime() + durationMin * 60000).toISOString();
		requestedFree = await isTimeFree(companyId, requestedISO, end);
		if (requestedFree === true) {
			return {
				requestedFree,
				proposal: {
					requestedISO,
					proposedStartISO: requestedISO,
					proposedEndISO: end,
					proposedLabel: labelFor(requestedISO)
				}
			};
		}
	}
	// Requested time is taken/unavailable (or none given) → next open slot.
	const days = await getAvailableSlots(companyId, { days: 14, durationMin });
	for (const day of days) {
		if (day.slots?.length) {
			const start = day.slots[0].value;
			const end = new Date(new Date(start).getTime() + durationMin * 60000).toISOString();
			return {
				requestedFree,
				proposal: {
					requestedISO,
					proposedStartISO: start,
					proposedEndISO: end,
					proposedLabel: `${day.label} ${day.slots[0].label}`
				}
			};
		}
	}
	return { requestedFree, proposal: null };
}

/** Find a recent, still-unbooked proposal we sent this caller (30-day window). */
export async function findPendingProposal(
	companyId: string,
	callerPhone: string
): Promise<{ commId: string; proposal: Proposal } | null> {
	const ten = (callerPhone || '').replace(/\D/g, '').slice(-10);
	if (!ten) return null;
	const rows = await prisma.communicationLog.findMany({
		where: {
			companyId,
			direction: 'outbound',
			created: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
		},
		orderBy: { created: 'desc' },
		take: 50,
		select: { id: true, destination: true, metadata: true }
	});
	for (const r of rows) {
		const p = (r.metadata as any)?.proposed_appointment as Proposal | undefined;
		if (p && !p.booked && (r.destination || '').replace(/\D/g, '').slice(-10) === ten) {
			return { commId: r.id, proposal: p };
		}
	}
	return null;
}

/**
 * Book a confirmed proposal: create the calendar event, persist the Appointment row,
 * mark the proposal booked, and notify the reps.
 */
export async function bookProposedAppointment(opts: {
	companyId: string;
	contactId: string;
	contactName?: string | null;
	phone: string;
	proposal: Proposal;
	proposalCommId: string;
}): Promise<{ booked: boolean; calendarEventId: string | null; appointmentId: string; message: string }> {
	const { companyId, contactId, phone, proposal } = opts;
	const summary = `Appointment — ${opts.contactName?.trim() || phone}`;
	const event = await createEvent(companyId, {
		summary,
		startISO: proposal.proposedStartISO,
		endISO: proposal.proposedEndISO,
		phone,
		addMeet: false
	});
	const appt = await prisma.appointment.create({
		data: {
			companyId,
			contactId,
			calendarEventId: event?.eventId ?? null,
			startTime: new Date(proposal.proposedStartISO),
			endTime: new Date(proposal.proposedEndISO),
			status: 'booked',
			source: 'sms_confirm'
		}
	});
	// Mark the originating proposal comm as booked so a later "yes" doesn't double-book.
	try {
		const c = await prisma.communicationLog.findUnique({
			where: { id: opts.proposalCommId },
			select: { metadata: true }
		});
		const md = (c?.metadata as any) || {};
		await prisma.communicationLog.update({
			where: { id: opts.proposalCommId },
			data: {
				metadata: {
					...md,
					proposed_appointment: { ...(md.proposed_appointment || {}), booked: true, appointmentId: appt.id }
				}
			}
		});
	} catch (e: any) {
		console.error('[appointment-flow] mark-booked failed:', e?.message || e);
	}
	// Notify reps (lazy import keeps firebase off the request module graph).
	try {
		const { notifyRepsOfBooking } = await import('./rep-notify');
		await notifyRepsOfBooking(companyId, `New appointment: ${opts.contactName || phone} — ${proposal.proposedLabel}`);
	} catch (e: any) {
		console.error('[appointment-flow] rep notify failed:', e?.message || e);
	}
	return {
		booked: true,
		calendarEventId: event?.eventId ?? null,
		appointmentId: appt.id,
		message: `You're all set — booked for ${proposal.proposedLabel}. See you then!`
	};
}

function labelFor(iso: string): string {
	try {
		return new Date(iso).toLocaleString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	} catch {
		return iso;
	}
}
