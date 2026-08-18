// Leadbox "Text Us" dispatch — the side-effecting half of text-message-routing.
//
// Everything that DECIDES lives in text-message-routing.ts and is unit-tested there. This only
// carries the decision out, reusing the same machinery the callback flow already established rather
// than growing a parallel copy (CLAUDE.md: grep for every writer before adding another):
//
//   • business hours → settings.autoReply.businessHours, the Settings → Auto-replies screen.
//   • the rep        → /representatives (CompanyMember.profileData.phone + .schedule), via the same
//                       `loadReps` + `buildRepRota` the callback ladder uses.
//   • the timezone   → `timeZoneFor`/`businessHoursFor`, shared with callback-dispatch.
//   • the SMS send   → `sendAutomatedSms`, gated on `pipelineBusinessConfig.smsAutoReplyAllowed`
//                       and transactional consent exactly like the callback after-hours ack.
//   • the task       → `prisma.task.create` with contactId + assignedToId + communicationThreadId,
//                       so it shows up in /tasks as a customer task on the responsible rep's list.

import { prisma } from '$lib/db';
import {
	parseCallbackPreference,
	buildRepRota,
	DEFAULT_BUSINESS_TIME_ZONE,
	type RepRotaItem
} from './callback-routing';
import { loadReps, timeZoneFor, businessHoursFor } from './callback-dispatch';
import { decideTextMessage, officeClosedReply } from './text-message-routing';

export interface TextMessageDispatchResult {
	handled: boolean;
	routed?: 'rep' | 'after_hours';
	rota?: RepRotaItem[];
	repUserId?: string | null;
	taskId?: string;
	ackSent?: boolean;
	reason: string;
}

/**
 * Entry point: a leadbox text message has arrived.
 *
 * Returns `handled: false` and does nothing when the message is not a plain text (a callback request
 * belongs to `dispatchCallbackRequest`; channel-click tracking carries no real text), so this is
 * safe to run on every inbound leadbox submission the callback flow declines.
 */
export async function dispatchTextMessageRequest(input: {
	companyId: string;
	customerName?: string | null;
	customerPhone?: string | null;
	message: string;
	/** Contact.id, when /api/messages resolved one. */
	contactId?: string | null;
	/** The CommunicationThread the inbound log created — the task hangs off it for its COM ref. */
	communicationThreadId?: string | null;
	/** The Message row, so we can assign the thread to the rep during business hours. */
	messageId?: string | null;
	now?: Date;
}): Promise<TextMessageDispatchResult> {
	if (parseCallbackPreference(input.message)) return { handled: false, reason: 'callback_request' };
	const text = input.message?.trim();
	if (!text || text.startsWith('Channel clicked:')) {
		return { handled: false, reason: 'not_a_text_message' };
	}

	const now = input.now ?? new Date();
	const company = await prisma.company.findUnique({
		where: { id: input.companyId },
		select: { id: true, name: true, settings: true }
	});
	if (!company) return { handled: false, reason: 'company_not_found' };

	const settings = (company.settings || {}) as Record<string, any>;
	const businessHours = businessHoursFor(settings);
	const timeZone = timeZoneFor(settings);
	const decision = decideTextMessage({ now, businessHours, timeZone });

	const reps = await loadReps(company.id);
	// Who is on duty at the moment the text must be answered: now, or at the next opening after
	// hours. This is "the person responsible for incoming texts".
	const rotaAt = decision.action === 'after_hours' ? (decision.openAt ?? now) : now;
	const rota = buildRepRota({ reps, at: rotaAt, timeZone });
	// Fall back to the first rep when nobody is rostered on, so the task lands on a named person
	// (Joe Sales) rather than on nobody. `reps` are already filtered to those with a phone.
	const responsible = rota[0] ?? reps[0] ?? null;

	const whenText =
		decision.action === 'route_to_rep'
			? 'now'
			: decision.openAt
				? decision.openAt.toLocaleString('en-US', {
						weekday: 'short',
						month: 'short',
						day: 'numeric',
						hour: 'numeric',
						minute: '2-digit',
						timeZone
					})
				: 'the next business day';

	// The rep gets the task whatever route the text itself takes, and BEFORE the reply is sent — a
	// customer who asked after hours must not be answered only if the reply succeeds.
	const taskId = await createRepTask({
		companyId: company.id,
		contactId: input.contactId,
		assignedToId: responsible?.userId ?? null,
		communicationThreadId: input.communicationThreadId,
		title: `Text from ${input.customerName?.trim() || 'a customer'} — reply ${whenText}`,
		description: text,
		dueDate: decision.action === 'after_hours' ? (decision.openAt ?? now) : now
	});

	// During business hours the text is routed to the responsible rep: the thread is assigned to
	// them so it lands in their inbox, not the shared one.
	if (decision.action === 'route_to_rep' && input.messageId) {
		await assignMessageToRep(input.messageId, responsible?.userId ?? null);
	}

	let ackSent = false;
	if (decision.action === 'after_hours' && input.customerPhone) {
		ackSent = await sendOfficeClosedAck({
			companyId: company.id,
			companyName: company.name,
			phone: input.customerPhone,
			template: settings?.autoReply?.afterHoursMessage,
			openAt: decision.openAt,
			timeZone
		});
	}

	return {
		handled: true,
		routed: decision.action === 'route_to_rep' ? 'rep' : 'after_hours',
		rota,
		repUserId: responsible?.userId ?? null,
		taskId,
		ackSent,
		reason: decision.reason
	};
}

/** Assign the message thread to a rep so it shows in their inbox rather than the shared one. */
async function assignMessageToRep(messageId: string, userId: string | null): Promise<void> {
	try {
		await prisma.message.update({
			where: { id: messageId },
			data: { assignedToId: userId }
		});
	} catch (e: any) {
		console.error('[TextMessage] assign message to rep failed:', e?.message || e);
	}
}

/** The rep-facing record: a task on their list, tied to the customer and the conversation. */
async function createRepTask(input: {
	companyId: string;
	contactId?: string | null;
	assignedToId?: string | null;
	communicationThreadId?: string | null;
	title: string;
	description: string;
	dueDate: Date;
}): Promise<string | undefined> {
	try {
		const task = await prisma.task.create({
			data: {
				companyId: input.companyId,
				contactId: input.contactId ?? null,
				assignedToId: input.assignedToId ?? null,
				communicationThreadId: input.communicationThreadId ?? null,
				title: input.title,
				description: input.description,
				status: 'todo',
				dueDate: input.dueDate
			}
		});
		return task.id;
	} catch (e: any) {
		console.error('[TextMessage] rep task create failed:', e?.message || e);
		return undefined;
	}
}

/**
 * The office-closed auto-reply: "we're shut, we'll get back to you in the morning."
 *
 * Same gates as the callback after-hours ack — the business must have opted in to unattended SMS
 * (`pipelineBusinessConfig.smsAutoReplyAllowed`) and the customer must have transactional consent.
 */
async function sendOfficeClosedAck(input: {
	companyId: string;
	companyName?: string | null;
	phone: string;
	template?: string | null;
	openAt: Date | null;
	timeZone?: string;
}): Promise<boolean> {
	const phone = (input.phone || '').replace(/[^\d+]/g, '');
	if (!phone) return false;

	try {
		const config = await prisma.pipelineBusinessConfig.findUnique({
			where: { companyId: input.companyId }
		});
		if (!config?.smsAutoReplyAllowed) {
			console.log(
				'[TextMessage] office-closed reply NOT sent: pipelineBusinessConfig.smsAutoReplyAllowed is off' +
					(config ? '' : ' (no config row for this company)')
			);
			return false;
		}

		const { hasSmsConsent } = await import('./consent');
		if (!(await hasSmsConsent(input.companyId, phone, 'transactional'))) {
			console.log(
				`[TextMessage] office-closed reply NOT sent: transactional consent revoked for ${phone}`
			);
			return false;
		}

		const { sendAutomatedSms } = await import('./sms');
		await sendAutomatedSms(
			phone,
			officeClosedReply({
				template: input.template,
				openAt: input.openAt,
				timeZone: input.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE
			})
		);
		return true;
	} catch (e: any) {
		console.error('[TextMessage] office-closed reply failed:', e?.message || e);
		return false;
	}
}
