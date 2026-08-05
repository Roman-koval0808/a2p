// ClearSky Scheduled Intents — instant acknowledgment (spec §5).
//
// The customer wrote to a business and should hear something back; silence is
// its own message. This is a fixed, pre-approved template, so approval happened
// when it was written — it goes out without waiting for a human click.
//
// Three rules from the spec this module exists to enforce:
//   1. NO dates and nothing hallucinatable in the reply. "A couple of weeks" is
//      the customer's phrase, but it got here through AI reading their email —
//      if that reading grabbed the wrong words, a fixed template must not send
//      something they never said. (Same reason the emergency confirmation
//      carries no arrival time.)
//   2. Our reply must not count as the customer being in touch. Every follow-up
//      would otherwise cancel itself. The outbound log carries a flag the sweep
//      checks for.
//   3. Only the channel they actually used — never a channel they never gave us.

import { prisma } from '$lib/db';
import { hasSmsConsent } from './consent';
import { sendAutomatedSms } from './sms';
import { sendEmailViaConnectedGmail } from './gmail-send';
import { resolveBrand } from './brand';
import { logCommunication } from '$lib/utils/communication-log';

export interface ScheduledIntentAckResult {
	sent: boolean;
	reason?: 'no_destination' | 'voice_not_automated' | 'no_sms_consent' | 'send_failed';
	message?: string;
}

export const SCHEDULED_INTENT_ACK_SUBJECT = 'Thanks for getting in touch';

/** Fixed wording — the name is the only variable, and even it falls back neutrally. */
export function scheduledIntentAckText(customerName: string | null | undefined, brand: string): string {
	const name = (customerName || '').trim() || 'there';
	return `Thanks ${name} — we'll look forward to hearing from you when you're back. — ${brand}`;
}

export async function sendScheduledIntentAck(opts: {
	companyId: string;
	customerName?: string | null;
	contactId?: string | null;
	/** The channel the customer used — never something else (§11). */
	channel: 'email' | 'sms' | 'voice';
	/** Their email address or mobile number. */
	to: string;
}): Promise<ScheduledIntentAckResult> {
	const { channel } = opts;
	const cleanTo = channel === 'sms' ? (opts.to || '').replace(/[^\d+]/g, '') : (opts.to || '').trim();
	if (!cleanTo) return { sent: false, reason: 'no_destination' };
	// An automated voice reply would require ringing them on a number we may not
	// even know is theirs — that needs a person (§11 landline row), not a bot.
	if (channel === 'voice') return { sent: false, reason: 'voice_not_automated' };

	const brand = await resolveBrand(opts.companyId);
	const message = scheduledIntentAckText(opts.customerName, brand);

	try {
		if (channel === 'sms') {
			if (!(await hasSmsConsent(opts.companyId, cleanTo, 'transactional'))) {
				return { sent: false, reason: 'no_sms_consent' };
			}
			await sendAutomatedSms(cleanTo, message);
		} else {
			await sendEmailViaConnectedGmail(opts.companyId, {
				to: cleanTo,
				subject: SCHEDULED_INTENT_ACK_SUBJECT,
				htmlContent: `<p>${message.replace(/—/g, '&mdash;')}</p>`
			});
		}
	} catch (e: any) {
		console.error('[scheduled-intent-ack] send failed:', e?.message || e);
		return { sent: false, reason: 'send_failed' };
	}

	// Logged as an automated ack — `scheduled_intent_ack: true` is the flag the
	// daily sweep reads so our own reply never counts as the customer contacting us.
	await logCommunication({
		type: channel,
		direction: 'outbound',
		status: 'success',
		destination: cleanTo,
		company_id: opts.companyId,
		customer_id: opts.contactId || undefined,
		summary: 'Automated acknowledgment',
		content: message,
		metadata: { scheduled_intent_ack: true, auto_reply: true }
	});

	return { sent: true, message };
}

/** How recently this company sent an automated scheduled-intent ack to this customer (diagnostics). */
export async function lastScheduledIntentAck(
	companyId: string,
	contactId: string
): Promise<Date | null> {
	const log = await prisma.communicationLog.findFirst({
		where: {
			companyId,
			customerId: contactId,
			direction: 'outbound',
			metadata: { path: ['scheduled_intent_ack'], equals: true }
		},
		orderBy: { created: 'desc' },
		select: { created: true }
	});
	return log?.created ?? null;
}
