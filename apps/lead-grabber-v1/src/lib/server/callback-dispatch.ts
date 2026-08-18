// Leadbox "Request a Call" dispatch — the side-effecting half of callback-routing.
//
// Everything that DECIDES lives in callback-routing.ts and is unit-tested there. This only carries
// the decision out, and it deliberately reuses machinery that already exists rather than growing a
// parallel copy of it (CLAUDE.md: grep for every writer before adding another):
//
//   • the bridge      → `startDialLadder` + the `isDialLadderTechLeg` / `isDialLadderTechLegGather`
//                       branches in the Telnyx call webhook. Those already dial a rep, speak a
//                       whisper, gather one DTMF digit, bridge the customer on 1, and fall to the
//                       next rung on 2/no-answer. The only thing that differs for a callback is
//                       what the rep hears, which is `whisperText` on the work order.
//   • the rota        → the /representatives screen (CompanyMember.profileData.phone + .schedule).
//   • the booked slot → `writeScheduledIntent`, actor BUSINESS, exactly as orchestrator.ts already
//                       does for `wants_callback`. That buys the daily sweep and the
//                       retry-until-contact loop in callback-attempts.ts for free.
//   • business hours  → settings.autoReply.businessHours, the Settings → Auto-replies screen.

import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';
import { getFirstCompanyNumber } from '$lib/company-numbers';
import { getDefaultAutoReplySettings, type BusinessHoursConfig } from '$lib/utils/auto-reply';
import {
	decideCallback,
	parseCallbackPreference,
	buildRepRota,
	windowConfigFrom,
	callbackWhisperText,
	afterHoursAckText,
	nextOpening,
	DEFAULT_BUSINESS_TIME_ZONE,
	type CallbackPreference,
	type CallbackDecision,
	type RepRecord,
	type RepRotaItem
} from './callback-routing';

export interface CallbackDispatchResult {
	handled: boolean;
	preference?: CallbackPreference;
	decision?: CallbackDecision['action'];
	rota?: RepRotaItem[];
	bridgeStarted?: boolean;
	scheduledFor?: string;
	scheduledIntentId?: string;
	ackSent?: boolean;
	reason: string;
}

/**
 * The reps, from the /representatives screen.
 *
 * Ordered oldest-first so the dial ladder is stable between calls — the list page sorts newest
 * first for display, which would make the rung order shuffle as staff are added.
 */
export async function loadReps(companyId: string): Promise<RepRecord[]> {
	const members = await prisma.companyMember.findMany({
		where: { companyId, role: 'member', status: 'active' },
		include: { user: { select: { id: true, name: true } } },
		orderBy: { created: 'asc' }
	});

	return members
		.map((m) => {
			const pd = (m.profileData || {}) as Record<string, any>;
			return {
				id: m.id,
				userId: m.user?.id ?? null,
				name: m.user?.name || 'Representative',
				// The edit form saves both; cell is the one worth ringing when it is there.
				phone: String(pd.cell || pd.phone || '').trim(),
				schedule: (pd.schedule as RepRecord['schedule']) ?? null
			};
		})
		.filter((r) => !!r.phone);
}

/**
 * The BUSINESS's timezone, not the server's.
 *
 * The production host runs at +02:00 while the companies are North American — reading the server
 * clock put a 17:31 Toronto request (office open) into the after-hours branch and booked the call
 * for 02:00 Toronto. Honours `settings.timezone` when an admin has set one; otherwise the same
 * default the calendar integration uses (`BUSINESS_TIME_ZONE` in google-calendar.ts).
 */
export function timeZoneFor(settings: Record<string, any>): string {
	const tz = settings?.timezone ?? settings?.timeZone;
	if (typeof tz === 'string' && tz.trim()) {
		try {
			// Reject a malformed value here rather than throwing from deep inside the date maths.
			new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
			return tz;
		} catch {
			console.warn(`[Callback] ignoring invalid settings.timezone "${tz}"`);
		}
	}
	return DEFAULT_BUSINESS_TIME_ZONE;
}

export function businessHoursFor(settings: Record<string, any>): BusinessHoursConfig {
	const configured = settings?.autoReply?.businessHours;
	if (configured && typeof configured === 'object') return configured as BusinessHoursConfig;
	// Admin has never opened Settings → Auto-replies. Use the same defaults that screen ships with,
	// so callbacks schedule against Mon–Fri 8–6 rather than reading as permanently closed.
	return getDefaultAutoReplySettings().businessHours;
}

/**
 * Entry point: a leadbox submission has arrived.
 *
 * Returns `handled: false` and does nothing when the message is not a callback request, so this is
 * safe to call on every inbound leadbox message.
 */
export async function dispatchCallbackRequest(input: {
	companyId: string;
	customerName?: string | null;
	customerPhone?: string | null;
	message: string;
	/** Contact.id, when /api/messages resolved one. */
	contactId?: string | null;
	/** The CommunicationLog this came from. */
	commLogId?: string | null;
	threadId?: string | null;
	now?: Date;
}): Promise<CallbackDispatchResult> {
	const preference = parseCallbackPreference(input.message);
	if (!preference) return { handled: false, reason: 'not_a_callback_request' };

	const now = input.now ?? new Date();
	const company = await prisma.company.findUnique({
		where: { id: input.companyId },
		select: { id: true, name: true, settings: true }
	});
	if (!company) return { handled: false, reason: 'company_not_found' };

	const settings = (company.settings || {}) as Record<string, any>;
	const businessHours = businessHoursFor(settings);
	const config = windowConfigFrom(settings);
	const timeZone = timeZoneFor(settings);

	const decision = decideCallback({ preference, now, businessHours, config, timeZone });

	// Who would take it at the moment the call is actually made — not at the moment he asked.
	const rotaAt = decision.action === 'schedule' ? decision.callAt : now;
	const rota = buildRepRota({ reps: await loadReps(company.id), at: rotaAt, timeZone });

	// "We add the message to the rep based on his requests." The rep gets it whatever route the
	// call itself takes, and BEFORE the dial is attempted — so a Telnyx failure or an empty rota
	// still leaves the request visible as work rather than losing it.
	await recordRepInstruction({
		companyId: company.id,
		customerName: input.customerName,
		customerPhone: input.customerPhone,
		message: input.message,
		preference,
		decision,
		rota,
		commLogId: input.commLogId,
		timeZone
	});

	if (decision.action === 'manual') {
		return { handled: true, preference, decision: 'manual', rota, reason: decision.reason };
	}

	if (decision.action === 'bridge_now') {
		const bridgeStarted = await startCallbackBridge({
			companyId: company.id,
			customerName: input.customerName,
			customerPhone: input.customerPhone,
			message: input.message,
			preference,
			rota,
			commLogId: input.commLogId
		});
		return {
			handled: true,
			preference,
			decision: 'bridge_now',
			rota,
			bridgeStarted,
			reason: bridgeStarted ? 'bridge_started' : 'bridge_not_started'
		};
	}

	const scheduledIntentId = await bookCallback({
		companyId: company.id,
		contactId: input.contactId ?? null,
		customerPhone: input.customerPhone,
		customerName: input.customerName,
		message: input.message,
		preference,
		callAt: decision.callAt,
		commLogId: input.commLogId,
		threadId: input.threadId ?? null
	});

	let ackSent = false;
	if (decision.afterHours && input.customerPhone) {
		ackSent = await sendAfterHoursAck({
			companyId: company.id,
			companyName: company.name,
			phone: input.customerPhone,
			openAt: nextOpening(now, businessHours, timeZone),
			timeZone
		});
	}

	return {
		handled: true,
		preference,
		decision: 'schedule',
		rota,
		scheduledFor: decision.callAt.toISOString(),
		scheduledIntentId,
		ackSent,
		reason: decision.reason
	};
}

/**
 * Ring the rota now, through the emergency dial ladder.
 *
 * Returns false rather than throwing when there is nobody on duty or no number to dial from. The
 * rep instruction is already written by then, so the request lands as work for a human.
 */
export async function startCallbackBridge(input: {
	companyId: string;
	customerName?: string | null;
	customerPhone?: string | null;
	message: string;
	preference: CallbackPreference;
	rota: RepRotaItem[];
	commLogId?: string | null;
}): Promise<boolean> {
	if (!input.rota.length) {
		console.warn(`[Callback] No rep on duty for ${input.companyId} — left as a task only.`);
		return false;
	}
	if (!input.customerPhone) {
		console.warn('[Callback] No customer number to bridge to.');
		return false;
	}

	// Returns a row, not a string — passing the object straight through would send Telnyx
	// "[object Object]" as the caller ID.
	const companyNumber = (await getFirstCompanyNumber(prisma as any, input.companyId))?.phoneNumber;
	if (!companyNumber) {
		console.warn(`[Callback] Company ${input.companyId} has no number to dial out from.`);
		return false;
	}

	// Shaped as an EmergencyBridgeWorkOrder because the webhook's ladder branches read that shape.
	// Unlike an emergency, no sla_breach timer is registered: a callback has no comm container to
	// hang one off, and the booked retry is the safety net instead.
	// The widget sends the number exactly as the customer typed it ("+1 (672) 238-7319").
	// bridgeCustomer posts customerNumber straight to Telnyx as the dial target, which
	// rejects anything that is not E.164 — so the rep would accept the call and then never
	// be connected. Normalise here, at the last point before it becomes a dial.
	const { formatPhoneForDialing } = await import('$lib/utils/phone');
	const dialableCustomer = formatPhoneForDialing(input.customerPhone);
	if (!dialableCustomer) {
		console.warn(`[Callback] customer number ${input.customerPhone} is not dialable.`);
		return false;
	}

	const workOrder = {
		commId: input.commLogId || `callback-${crypto.randomUUID()}`,
		personId: null,
		customerNumber: dialableCustomer,
		dialLadder: input.rota,
		currentRung: 1,
		maxAttemptsPerRung: 1,
		whisperText: callbackWhisperText({
			customerName: input.customerName,
			message: input.message,
			preference: input.preference
		}),
		emergencySummary: `Callback request (${input.preference})`,
		slaDeadline: new Date(Date.now() + 10 * 60 * 1000),
		escalationPolicy: 'ladder_with_dtmf',
		// Distinguishes this from a real emergency wherever the shared ladder labels itself.
		// It must never gate the dialling logic — see the note on the field.
		kind: 'callback' as const
	};

	try {
		const { startDialLadder } = await import('./emergency-dial');
		return await startDialLadder(workOrder as any, companyNumber);
	} catch (e: any) {
		console.error('[Callback] startDialLadder failed:', e?.message || e);
		return false;
	}
}

/**
 * Book a future window as a ScheduledIntent, the same way orchestrator.ts books `wants_callback`.
 *
 * actor BUSINESS → intentType CUSTOMER_COMMITMENT_B → the daily sweep picks it up and the mode-B
 * retry loop applies, so a missed callback is tried again rather than dropped.
 * `payload.kind` marks it as a callback so the handoff dials instead of drafting a message.
 */
async function bookCallback(input: {
	companyId: string;
	contactId: string | null;
	customerPhone?: string | null;
	customerName?: string | null;
	message: string;
	preference: CallbackPreference;
	callAt: Date;
	commLogId?: string | null;
	threadId?: string | null;
}): Promise<string | undefined> {
	// The row is filed under a profile id. With no resolved contact there is nothing to file it
	// against, so the rep task written by the caller is the record. Better a task than a row keyed
	// to a customer we cannot identify.
	if (!input.contactId) return undefined;

	try {
		const { writeScheduledIntent } = await import('./scheduled-intent-writer');
		const written = await writeScheduledIntent({
			companyId: input.companyId,
			contactId: input.contactId,
			profileId: input.contactId,
			extraction: {
				hasFutureIntent: true,
				schedulable: true,
				// BUSINESS is what makes this a CUSTOMER_COMMITMENT_B row and what the daily
				// callback loop looks for. It also means no 7-day customer grace is added — he
				// asked for a specific window, so waiting a week would just be late.
				actor: 'BUSINESS',
				whatHeWants: 'a call back',
				rawTimeframe: input.preference,
				timeframeDays: null,
				exactDateIso: input.callAt.toISOString(),
				calculatedTargetDate: input.callAt.toISOString(),
				confidence: 'HIGH',
				preferredChannel: 'phone'
			} as any,
			channel: 'web',
			originalTarget: input.customerPhone || null,
			conversationId: input.threadId ?? null,
			commLogId: input.commLogId ?? null,
			// Distinct prefix from orch_callback_ so the leadbox path and the orchestrator's own
			// wants_callback path can never collide on one message.
			idempotencyKey: `leadbox_callback_${input.commLogId || input.threadId || input.contactId}_${input.callAt.toISOString()}`
		});

		if (!written.recorded && written.reason !== 'already_exists') {
			console.warn(`[Callback] slot not booked: ${written.reason}`);
		}

		// The writer owns the row's shape, so the callback marker is stamped on afterwards.
		// Without it the handoff would treat this as an ordinary follow-up and draft an SMS.
		if (written.scheduledIntentId) {
			const row = await prisma.scheduledIntent.findUnique({
				where: { id: written.scheduledIntentId },
				select: { payload: true }
			});
			await prisma.scheduledIntent.update({
				where: { id: written.scheduledIntentId },
				data: {
					payload: {
						...((row?.payload as object) || {}),
						kind: 'callback_request',
						preference: input.preference,
						customerName: input.customerName ?? null,
						customerMessage: input.message
					}
				}
			});
		}

		return written.scheduledIntentId;
	} catch (e: any) {
		console.error('[Callback] failed to book slot:', e?.message || e);
		return undefined;
	}
}

/**
 * The after-hours auto-reply: "a rep will call you when we open."
 *
 * Same gates as `sendCallbackAck` — the business must have opted in to unattended SMS and the
 * customer must have transactional consent — but deliberately WITHOUT that function's office-hours
 * check, since being outside office hours is the entire reason this message exists.
 */
export async function sendAfterHoursAck(input: {
	companyId: string;
	companyName?: string | null;
	phone: string;
	openAt: Date | null;
	timeZone?: string;
}): Promise<boolean> {
	const phone = (input.phone || '').replace(/[^\d+]/g, '');
	if (!phone) return false;

	try {
		const config = await prisma.pipelineBusinessConfig.findUnique({
			where: { companyId: input.companyId }
		});
		// Say why, not just no. A silent false here is indistinguishable from "never ran" when
		// you are watching a dev console to see whether the customer got their reply.
		if (!config?.smsAutoReplyAllowed) {
			console.log(
				'[Callback] after-hours ack NOT sent: pipelineBusinessConfig.smsAutoReplyAllowed is off' +
					(config ? '' : ' (no config row for this company)')
			);
			return false;
		}

		const { hasSmsConsent } = await import('./consent');
		if (!(await hasSmsConsent(input.companyId, phone, 'transactional'))) {
			console.log(`[Callback] after-hours ack NOT sent: transactional consent revoked for ${phone}`);
			return false;
		}

		const { resolveBrand } = await import('./brand');
		const brand = await resolveBrand(input.companyId, input.companyName || undefined);

		const { sendAutomatedSms } = await import('./sms');
		await sendAutomatedSms(
			phone,
			afterHoursAckText({ openAt: input.openAt, brand, timeZone: input.timeZone })
		);
		return true;
	} catch (e: any) {
		console.error('[Callback] after-hours ack failed:', e?.message || e);
		return false;
	}
}

/** The rep-facing record: a task they will see, plus a line in the comm log. */
async function recordRepInstruction(input: {
	companyId: string;
	customerName?: string | null;
	customerPhone?: string | null;
	message: string;
	preference: CallbackPreference;
	decision: CallbackDecision;
	rota: RepRotaItem[];
	commLogId?: string | null;
	timeZone?: string;
}): Promise<void> {
	const who = input.customerName?.trim() || 'A customer';
	const phone = input.customerPhone || 'no number given';

	const when =
		input.decision.action === 'bridge_now'
			? 'now — bridging the on-duty rep'
			: input.decision.action === 'schedule'
				? input.decision.callAt.toLocaleString('en-US', {
						weekday: 'short',
						month: 'short',
						day: 'numeric',
						hour: 'numeric',
						minute: '2-digit',
						// The rep reads this; show it in their working day, not the server's.
						timeZone: input.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE
					})
				: 'UNSCHEDULED — no open slot found, arrange manually';

	const assigned = input.rota.length
		? input.rota.map((r) => r.name).join(' → ')
		: 'nobody on duty — unassigned';

	const title = `Callback (${input.preference}): ${who} — ${when}`;

	try {
		await prisma.task.create({ data: { companyId: input.companyId, title } });
	} catch (e: any) {
		console.error('[Callback] rep task create failed:', e?.message || e);
	}

	try {
		await logCommunication({
			type: 'web',
			direction: 'outbound',
			status: 'success',
			source: 'callback-router',
			destination: input.rota.map((r) => r.phone).join(', ') || undefined,
			company_id: input.companyId,
			summary: title,
			content: `${who} (${phone}) requested a call back.\nPreference: ${input.preference}\nWhen: ${when}\nRota: ${assigned}\nMessage: ${input.message}`,
			metadata: {
				callback_request: true,
				preference: input.preference,
				decision: input.decision.action,
				rota: input.rota,
				source_comm_id: input.commLogId ?? null
			}
		});
	} catch (e: any) {
		console.error('[Callback] rep log failed:', e?.message || e);
	}
}
