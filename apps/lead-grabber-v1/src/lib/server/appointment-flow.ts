import { prisma } from '$lib/db';
import { isTimeFree, createEvent, getAvailableSlots, toUtcInstant } from './google-calendar';

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
		// Start AND end must use the SAME naive wall-clock representation. If start stays naive
		// (Google reads it in the calendar's timezone) while end is a UTC .toISOString() built
		// with the server's clock, the two land in different timezones and Google rejects the
		// insert as an empty/inverted range ("timeRangeEmpty"). Keep both naive → consistent.
		const startNaive = naiveWallClock(requestedISO);
		const endNaive = naiveWallClock(requestedISO, durationMin);
		requestedFree = await isTimeFree(companyId, requestedISO, endNaive);
		// Honor the time the customer actually asked for unless it's DEFINITIVELY taken.
		// isTimeFree returns null when we can't check (calendar disconnected / freeBusy API
		// error) — in that case we must NOT silently propose some other earlier slot; we
		// propose the requested time and let them confirm (the team sees it before it's sent).
		if (requestedFree !== false) {
			return {
				requestedFree,
				proposal: {
					requestedISO,
					proposedStartISO: startNaive,
					proposedEndISO: endNaive,
					proposedLabel: labelFor(startNaive)
				}
			};
		}
	}
	// Requested time is definitively taken → next open slot.
	const days = await getAvailableSlots(companyId, { days: 14, durationMin });
	for (const day of days) {
		if (day.slots?.length) {
			const start = day.slots[0].value; // getAvailableSlots already emits naive wall-clock
			return {
				requestedFree,
				proposal: {
					requestedISO,
					proposedStartISO: naiveWallClock(start),
					proposedEndISO: naiveWallClock(start, durationMin),
					proposedLabel: `${day.label} ${day.slots[0].label}`
				}
			};
		}
	}
	return { requestedFree, proposal: null };
}

/**
 * Return a NAIVE local wall-clock string ('YYYY-MM-DDTHH:mm:ss'), optionally shifted by minutes.
 * Both ends of an appointment must share this representation so Google Calendar interprets them in
 * the same (calendar) timezone — otherwise a naive start + a UTC end invert into an empty range.
 */
function naiveWallClock(iso: string, addMinutes = 0): string {
	const d = new Date(new Date(iso).getTime() + addMinutes * 60000);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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
	// A calendar outage (freeBusy/insert 4xx, disconnected) must NOT block the booking: we still
	// record the Appointment and confirm to the customer, then reps can sync the calendar manually.
	let event: { eventId: string } | null = null;
	try {
		event = await createEvent(companyId, {
			summary,
			startISO: proposal.proposedStartISO,
			endISO: proposal.proposedEndISO,
			phone,
			addMeet: false
		});
	} catch (e: any) {
		console.error('[appointment-flow] createEvent failed; booking without calendar sync:', e?.message || e);
	}
	const appt = await prisma.appointment.create({
		data: {
			companyId,
			contactId,
			calendarEventId: event?.eventId ?? null,
			// Resolve the naive wall-clock time in the BUSINESS zone, not the server's — otherwise a
			// Europe-hosted box stores an Ontario 10am appointment as the wrong absolute instant,
			// which would break reminders and "upcoming appointment" queries.
			startTime: toUtcInstant(proposal.proposedStartISO),
			endTime: toUtcInstant(proposal.proposedEndISO),
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
