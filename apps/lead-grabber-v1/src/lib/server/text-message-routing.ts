// Leadbox "Text Us" routing — the pure decision half.
//
// Robert types a message and presses SEND. The first thing we need to know is the time: inside the
// admin's business hours the text is routed to the representative responsible for incoming texts;
// outside them the customer gets an automated "office is closed" reply and the responsible rep gets
// a task to answer it in the morning. Business hours come from Settings → Auto-replies; the rep
// comes from the /representatives schedule.
//
// Same split as callback-routing.ts: everything that DECIDES lives here and is unit-tested with no
// database, no Telnyx and no fixed clock; everything that carries the decision out lives in
// text-message-dispatch.ts.
//
// TIMEZONE: the open/closed check reuses `isOpenAt`/`nextOpening` from callback-routing, which read
// the clock in the BUSINESS's zone rather than the server's. A text that arrives at 23:31 on a +02:00
// host is 17:31 in Toronto and must route to the rep, not to the after-hours branch.

import type { BusinessHoursConfig } from '$lib/utils/auto-reply';
import { isOpenAt, nextOpening, DEFAULT_BUSINESS_TIME_ZONE } from './callback-routing';

export type TextMessageDecision =
	| { action: 'route_to_rep'; reason: string }
	| { action: 'after_hours'; openAt: Date | null; reason: string };

/**
 * The whole decision in one call: is the office open right now?
 *
 * Open → the text goes to the on-duty rep. Shut → the customer gets the office-closed reply and the
 * rep gets a task due at the next opening.
 */
export function decideTextMessage(input: {
	now: Date;
	businessHours: BusinessHoursConfig;
	timeZone?: string;
}): TextMessageDecision {
	const timeZone = input.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE;
	if (isOpenAt(input.now, input.businessHours, timeZone)) {
		return { action: 'route_to_rep', reason: 'during_business_hours' };
	}
	return {
		action: 'after_hours',
		openAt: nextOpening(input.now, input.businessHours, timeZone),
		reason: 'after_hours'
	};
}

/**
 * The customer's office-closed reply. Uses the admin's configured after-hours message
 * (`settings.autoReply.afterHoursMessage`) and substitutes its `{date}` placeholder with the next
 * opening, rendered in the business's zone — telling a customer "we open at 2:00 AM" because the
 * server sits in another country is the same class of bug the timezone note describes.
 */
export function officeClosedReply(input: {
	template?: string | null;
	openAt: Date | null;
	timeZone?: string;
}): string {
	const template =
		input.template?.trim() ||
		'Our office is closed right now. We will get back to you in the morning.';
	if (!template.includes('{date}')) return template;

	const timeZone = input.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE;
	const when = input.openAt
		? input.openAt.toLocaleString('en-US', {
				weekday: 'long',
				hour: 'numeric',
				minute: '2-digit',
				timeZone
			})
		: 'the next business day';
	return template.replace(/{date}/g, when);
}
