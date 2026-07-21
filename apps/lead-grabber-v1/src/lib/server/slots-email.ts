import { getAvailableSlots } from './google-calendar';
import { resolveBrand } from './brand';

/**
 * Available-slots scheduling EMAIL (Epic 5, T5.4) — the email counterpart to the
 * SMS booking-link flow (doc's ACT-CALL-011).
 *
 * ⚠️ Confirmable only with a connected Google Calendar (to return real open slots)
 * and configured email credentials to actually send. Composes the message here;
 * `send` is delegated to the caller's email transport.
 */
export interface SlotsEmail {
	subject: string;
	body: string;
	slotCount: number;
}

export async function buildAvailableSlotsEmail(opts: {
	companyId: string;
	customerName?: string | null;
	bookingUrl?: string;
	days?: number;
}): Promise<SlotsEmail> {
	const who = opts.customerName?.trim() || 'there';
	let slots: any[] = [];
	try {
		slots = (await getAvailableSlots(opts.companyId, { days: opts.days ?? 14 }) as any[]);
	} catch (e: any) {
		console.warn('[slots-email] could not read availability (needs connected calendar):', e?.message);
	}

	const lines: string[] = [];
	for (const day of slots.slice(0, 5)) {
		const times = (day?.slots ?? day?.times ?? []).slice(0, 4);
		if (times.length) lines.push(`• ${day?.date ?? day?.day ?? ''}: ${times.join(', ')}`);
	}

	const body =
		`Hi ${who},\n\nHere are some open times for your installation:\n\n` +
		(lines.length ? lines.join('\n') : '(No open slots found — reply and we\'ll find a time.)') +
		(opts.bookingUrl ? `\n\nOr pick a time here: ${opts.bookingUrl}` : '') +
		`\n\n— ${await resolveBrand(opts.companyId)}`;

	return { subject: 'Schedule your installation', body, slotCount: lines.length };
}
