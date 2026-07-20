// Agentic reply "skills": real data-lookup tools the model can call to complete a customer's
// request itself, instead of deferring to a human. Each tool is backed by a genuine data source
// (calendar, comm log, balance) and returns short factual text that grounds the final SMS.
//
// This is the general path — the model decides which skills a message needs, so we don't have to
// hand-gate every scenario with keywords.

import { prisma } from '$lib/db';
import { claudeAgentReply, type ClaudeTool } from './anthropic';
import {
	describeBusinessHours,
	describeLocations,
	describeDayHours,
	resolveDayName,
	formatDatetime
} from './calendar';
import { resolveBalanceByPhone } from './balance';
import { isUnsendableDraft } from './reply-sanity';
import { bookingLinkWith } from '$lib/utils/booking';
import {
	getAvailableSlots,
	getCustomerAppointments,
	resolveReschedule,
	resolveCancel
} from './google-calendar';

export interface AgenticReplyInput {
	companyId: string;
	companyName: string;
	locations: any[];
	website?: string | null;
	customerName?: string | null;
	customerPhone?: string | null;
	customerEmail?: string | null;
	message: string;
	history: { from: 'customer' | 'business'; text: string }[];
	/** A booking link (pasted Appointment Schedule link, or our booking page when connected). */
	bookingUrl?: string | null;
	/** Whether Google Calendar is connected for this company (enables live slots / appointments). */
	connected: boolean;
	/** The customer's balance if already known on their record. */
	knownBalance?: number | null;
	apiKey: string;
}

function last10(phone?: string | null): string | null {
	const d = (phone || '').replace(/\D/g, '');
	return d.length >= 10 ? d.slice(-10) : null;
}

/** Recent real interactions for this customer (from the communication log) over the last N days. */
async function recentActivity(companyId: string, phone: string | null | undefined, days = 14) {
	const l10 = last10(phone);
	if (!l10) return [];
	const since = new Date(Date.now() - days * 86400000);
	const rows = await prisma.communicationLog.findMany({
		where: {
			companyId,
			created: { gte: since },
			OR: [{ source: { contains: l10 } }, { destination: { contains: l10 } }]
		},
		orderBy: { created: 'desc' },
		take: 12,
		select: { created: true, type: true, direction: true, summary: true, content: true }
	});
	return rows;
}

/** Build the skill set for one reply context. */
function buildSkills(input: AgenticReplyInput): ClaudeTool[] {
	const { companyId, locations, connected } = input;
	const ident = {
		phone: input.customerPhone,
		email: input.customerEmail,
		name: input.customerName
	};

	const tools: ClaudeTool[] = [
		{
			name: 'get_business_info',
			description:
				'Get this business\'s hours, location(s) and website. Use for "what are your hours", "where are you", "what is this business", "what do you do". If the customer asks about a specific day ("what time do you open tomorrow", "are you open Monday"), pass that day in `when` to get that exact day\'s hours instead of the whole week.',
			input_schema: {
				type: 'object',
				properties: {
					when: {
						type: 'string',
						description:
							'The specific day the customer asked about: "today", "tonight", "tomorrow", or a weekday name like "monday". Omit for a general hours question.'
					}
				}
			},
			run: async ({ when }: { when?: string }) => {
				// If they named a specific day (incl. "tomorrow"), give that day's exact hours.
				const resolved = when ? resolveDayName(when) : null;
				const dayHours = resolved ? describeDayHours(locations, [resolved]) : null;
				const parts = [dayHours ? dayHours : `Hours: ${describeBusinessHours(locations)}.`];
				const addr = describeLocations(locations);
				if (addr) parts.push(`Location(s): ${addr}.`);
				if (input.website) parts.push(`Website: ${input.website}.`);
				return parts.join(' ');
			}
		},
		{
			name: 'get_account_summary',
			description:
				'Look up the customer\'s account: current balance and their recent activity with us (recent calls/texts and appointments). Use for balance questions and "how has my account changed", "what\'s my account status", "recent activity".',
			input_schema: { type: 'object', properties: {} },
			run: async () => {
				const balance = await resolveBalanceByPhone(
					companyId,
					input.customerPhone,
					input.knownBalance ?? null
				);
				const lines: string[] = [];
				lines.push(
					balance != null
						? `Current outstanding balance: $${Number(balance).toFixed(2)}.`
						: `No outstanding balance on record.`
				);
				const acts = await recentActivity(companyId, input.customerPhone, 14);
				if (acts.length) {
					const items = acts
						.slice(0, 6)
						.map((a) => {
							const when = a.created
								? new Date(a.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
								: '';
							const what = (a.summary || a.content || a.type || 'interaction')
								.toString()
								.slice(0, 60);
							return `${when} — ${a.direction || ''} ${a.type || ''}: ${what}`.trim();
						})
						.join('; ');
					lines.push(`Recent activity (last 14 days): ${items}.`);
				} else {
					lines.push('No recorded activity in the last 14 days.');
				}
				if (connected) {
					const appts = await getCustomerAppointments(companyId, ident);
					const past = appts.filter((a) => a.isPast);
					const upcoming = appts.filter((a) => !a.isPast);
					if (past.length)
						lines.push(`Last appointment: ${formatDatetime(past[past.length - 1].startISO)}.`);
					if (upcoming.length) lines.push(`Next appointment: ${formatDatetime(upcoming[0].startISO)}.`);
				}
				// Be explicit about the data we DON'T have so the model doesn't invent it.
				lines.push(
					'NOTE: We do not have itemized billing/transaction history here — for a detailed statement of charges, offer to have the billing team send one. Do not invent specific charges or week-over-week figures.'
				);
				return lines.join(' ');
			}
		},
		{
			name: 'get_appointments',
			description:
				'Look up the customer\'s appointments on record (past and upcoming), matched by their phone. Use for "when is my appointment", "when did you last come out", "do I have anything booked".',
			input_schema: { type: 'object', properties: {} },
			run: async () => {
				if (!connected) return 'Calendar is not connected, so I cannot look up specific appointments.';
				const appts = await getCustomerAppointments(companyId, ident);
				if (!appts.length) return 'No appointments found on record for this customer.';
				const sorted = [...appts].sort(
					(a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime()
				);
				const past = sorted.filter((a) => a.isPast);
				const upcoming = sorted.filter((a) => !a.isPast);
				const list = sorted
					.map((a) => `- ${formatDatetime(a.startISO)} — ${a.title}${a.isPast ? ' [past]' : ' [upcoming]'}`)
					.join('\n');
				const last = past.length ? formatDatetime(past[past.length - 1].startISO) : 'none';
				const next = upcoming.length ? formatDatetime(upcoming[0].startISO) : 'none';
				return `Appointments:\n${list}\nLAST (most recent past): ${last}. NEXT (soonest upcoming): ${next}.`;
			}
		},
		{
			name: 'check_availability',
			description:
				'Find open appointment times. Pass the weekday the customer asked about (e.g. "monday") if any. Use for "what times are you free", "any openings Tuesday", "when can you come out".',
			input_schema: {
				type: 'object',
				properties: {
					day: {
						type: 'string',
						description:
							'The day the customer asked about: "today", "tonight", "tomorrow", or a weekday name like "monday". Omit if none.'
					}
				}
			},
			run: async ({ day }: { day?: string }) => {
				const resolved = day ? resolveDayName(day) : null;
				const named = resolved ? [resolved] : [];
				if (connected) {
					try {
						const all = await getAvailableSlots(companyId, { locations, days: 14 });
						const filtered =
							named.length > 0
								? all.filter((d) => named.some((n) => new RegExp(`\\b${n}\\b`, 'i').test(d.label)))
								: all.slice(0, 3);
						const nonEmpty = filtered.filter((d) => d.slots.length > 0);
						if (nonEmpty.length > 0) {
							return (
								'Open times from our live calendar:\n' +
								nonEmpty
									.map((d) => `- ${d.label}: ${d.slots.map((s) => s.label).join(', ')}`)
									.join('\n')
							);
						}
					} catch (e) {
						console.error('[reply-skills] check_availability live lookup failed:', e);
					}
				}
				// Not connected, or no live slots / lookup failed → answer from business hours.
				const hours = describeDayHours(locations, named);
				return hours
					? `We couldn't confirm live open slots, but here are our open hours: ${hours} Ask what time works and we'll book it.`
					: `We're closed on the day asked about, or hours aren't set. Offer the nearest open day.`;
			}
		},
		{
			name: 'reschedule_appointment',
			description:
				'Start rescheduling the customer\'s existing appointment. Use when they want to move/change/push an existing booking.',
			input_schema: { type: 'object', properties: {} },
			run: async () => {
				if (!connected) return 'Calendar is not connected; offer to have someone help them reschedule.';
				const r = await resolveReschedule(companyId, { message: input.message, ...ident });
				if (r.mode === 'link' && r.link)
					return `They have one upcoming appointment (${r.targetLabel || 'existing'}). Give them THIS link to pick a new time — the old one is cancelled only when they confirm the new one: ${r.link}. Do not say it's already moved.`;
				if (r.mode === 'ask')
					return `They have MORE THAN ONE upcoming appointment: ${(r.options || []).join('; ')}. Ask which one to move. Do not send a link yet.`;
				return 'No upcoming appointment on file to reschedule; offer to book a new one.';
			}
		},
		{
			name: 'cancel_appointment',
			description:
				'Cancel the customer\'s existing upcoming appointment on our calendar. Use when they clearly want to cancel / call off / are no longer coming to an existing booking (NOT when they want to move it — use reschedule_appointment for that).',
			input_schema: { type: 'object', properties: {} },
			run: async () => {
				if (!connected) return 'Calendar is not connected; offer to have someone cancel it for them.';
				const r = await resolveCancel(companyId, { message: input.message, ...ident });
				if (r.mode === 'cancelled')
					return `Done — their appointment (${r.cancelledLabel}) is now cancelled on our calendar. Confirm it's cancelled and warmly offer to rebook whenever they're ready.`;
				if (r.mode === 'ask')
					return `They have MORE THAN ONE upcoming appointment: ${(r.options || []).join('; ')}. Ask which one to cancel. Do NOT cancel any yet.`;
				if (r.mode === 'error')
					return `We tried to cancel their appointment (${r.cancelledLabel}) but it didn't go through. Apologize and offer to have someone cancel it manually. Do NOT claim it's cancelled.`;
				return 'No upcoming appointment on file to cancel; let them know there is nothing currently booked.';
			}
		}
	];

	if (input.bookingUrl) {
		tools.push({
			name: 'get_booking_link',
			description:
				'Get a self-service booking link the customer can use to pick and confirm an open slot themselves. Use when they want to book a new appointment.',
			input_schema: { type: 'object', properties: {} },
			run: async () =>
				`Booking link (books both sides, they can cancel there): ${bookingLinkWith(input.bookingUrl!, { name: input.customerName, phone: input.customerPhone })}`
		});
	}

	return tools;
}

/**
 * Draft a reply by letting the model call real skills. Returns the SMS text, or null if it
 * couldn't (caller should fall back to the fact-based reply).
 */
export async function draftAgenticReply(input: AgenticReplyInput): Promise<string | null> {
	const message = (input.message || '').trim();
	if (!message) return null;

	const historyText = (input.history || [])
		.slice(-8)
		.map((t) => `${t.from === 'business' ? 'Us' : 'Customer'}: ${t.text}`)
		.join('\n');

	// Only advertise capabilities that are actually registered — naming a "booking link" tool that
	// wasn't built (no bookingUrl configured) is what makes the model invent
	// "[booking link will be provided]" placeholders.
	const toolBlurb = input.bookingUrl
		? 'appointments, account summary, availability, business info, booking link'
		: 'appointments, account summary, availability, business info';
	const bookingRule = input.bookingUrl
		? '- To share the booking link, CALL get_booking_link and paste the EXACT url it returns. Never retype or shorten it.'
		: '- You have NO booking link available. Never offer, promise, or hint at one. Instead ask them to reply with a time that works and we will confirm it for them.';

	const system = `You are a warm, friendly assistant for ${input.companyName}, a local trades / home-services business, replying by SMS to ${input.customerName || 'the customer'}.

You have TOOLS that look up REAL data (${toolBlurb}). Your job is to actually COMPLETE the customer's request yourself using these tools, not to say "someone will get back to you" when a tool can answer.

Rules:
- If a tool can answer the message, CALL it and answer specifically from what it returns. You may call several.
- NEVER invent availability, prices, balances, appointment times, services, or account details. Only state what the tools return or what's in the conversation.
- If a tool reports it has no data (no billing history, no appointments, etc.), say so honestly and offer the best real next step (send a statement, have the team follow up) — don't make things up.
- If the customer confirms an appointment ("yes", "that works") but you have no tool to book it, DO NOT explain your limitations. Just warmly confirm: "You're all set — see you then!" and the team handles the calendar.
${bookingRule}
- Reply in ONE short, natural, human SMS (1-2 sentences, no markdown, no corporate stiffness).

CRITICAL: Your entire output is sent VERBATIM to the customer as a text message. Output ONLY that message. Never write meta-commentary, never explain your reasoning or your tools, never address "the developer"/"the team", never write "Suggested reply:", "I need to clarify", or "I don't have a tool". If you're unsure, send a brief warm acknowledgement that the team will follow up.

NEVER write a fill-in-the-blank placeholder. No square brackets, no angle brackets, no "TBD", no "will be provided", no "[link]"/"[name]"/"[time]". If you don't have a real value, leave it out and rephrase the sentence without it — a customer must never receive a template.`;

	const tools = buildSkills(input);
	const reply = await claudeAgentReply({
		apiKey: input.apiKey,
		system,
		tools,
		messages: [
			{
				role: 'user',
				content: `Conversation so far:\n${historyText || '(none)'}\n\nCustomer's latest message: "${message}"\n\nUse your tools as needed, then write our reply (customer-facing text only):`
			}
		],
		maxSteps: 4,
		maxTokens: 400,
		temperature: 0.4
	});
	// Sanity guard: meta-commentary about its own tools, or a fill-in-the-blank placeholder, is
	// unsendable — discard it so the caller falls back to the deterministic reply.
	if (isUnsendableDraft(reply)) {
		console.warn('[reply-skills] discarded unsendable agentic draft:', (reply || '').slice(0, 160));
		return null;
	}
	return reply;
}
