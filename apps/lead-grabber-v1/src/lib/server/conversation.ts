// Conversational SMS reply handler.
//
// Given an ongoing thread and the customer's new reply, this:
//  1. Extracts any proposed appointment date/time (strict schema, temperature 0).
//  2. Checks it deterministically against the company's business hours (checkCalendarAvailability).
//  3. Writes a warm, natural, human reply that honours the availability result — e.g. confirms
//     the slot, or (if outside hours) apologises and suggests the real hours.
//
// The key is passed in so this stays a plain, testable unit.

import { checkCalendarAvailability, formatDatetime, describeBusinessHours } from './calendar';
import { claudeJSON, claudeText, CLAUDE_FAST } from './anthropic';
import { bookingLinkWith } from '$lib/utils/booking';

export interface ConversationTurn {
	from: 'customer' | 'business';
	text: string;
}

export interface ConversationInput {
	message: string;
	history: ConversationTurn[];
	companyName: string;
	customerName?: string | null;
	customerPhone?: string | null;
	locations?: any[];
	accountBalance?: number | null;
	bookingUrl?: string | null;
	/** The customer's appointments on record (from the calendar). undefined = not looked up. */
	appointments?: { startISO: string; title: string; isPast: boolean }[];
	/** Reschedule resolution (target link, or ask-which, or none). */
	reschedule?: { mode: 'link' | 'ask' | 'none'; link?: string; targetLabel?: string; options?: string[] };
	/** Live open slots from the connected calendar (for "what times are you free?"). undefined = not looked up. */
	availableSlots?: { label: string; slots: { label: string }[] }[];
	/** When we can't see live bookings, the open hours for the specific day the customer asked about. */
	openHoursNote?: string | null;
	/** Business facts for answering general questions ("what is this business", "where are you"). */
	businessInfo?: { website?: string | null; address?: string | null; services?: string | null };
	/** Urgent message — reply with an urgent ack + a SAFE, self-mitigation tip while help is coming. */
	emergency?: boolean;
	apiKey: string;
}

export interface ConversationResult {
	reply: string;
	booked: boolean;
	datetime: string | null;
	available: boolean | null;
}

interface Extracted {
	contains_datetime: boolean;
	datetime_iso: string | null;
	reply_type: 'proposing_time' | 'confirming' | 'declining' | 'question' | 'other';
}

function todayContext(): string {
	const now = new Date();
	const fmt = now.toLocaleString('en-US', {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
	return `Today is ${fmt}. The current year is ${now.getFullYear()}.`;
}

const EXTRACT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	properties: {
		contains_datetime: { type: 'boolean' },
		datetime_iso: {
			type: 'string',
			description: 'ISO 8601 timestamp (YYYY-MM-DDTHH:mm:ss), or an empty string if none'
		},
		reply_type: {
			type: 'string',
			enum: ['proposing_time', 'confirming', 'declining', 'question', 'other']
		}
	},
	required: ['contains_datetime', 'datetime_iso', 'reply_type']
};

// Step 1 — extract any proposed appointment datetime from the reply.
async function extractReply(message: string, apiKey: string): Promise<Extracted | null> {
	const system = `You extract appointment date/time from a customer's SMS reply for a trades business. ${todayContext()}
If the reply proposes/agrees to a specific day and/or time, set contains_datetime=true and datetime_iso to an ISO 8601 timestamp (YYYY-MM-DDTHH:mm:ss) resolving relative dates against today; if only a day is given, use 09:00:00; if unclear, contains_datetime=false and datetime_iso as an empty string.
reply_type: proposing_time (offers a time), confirming (agrees/says yes), declining (says no/cancel), question (asks something), other.`;
	const result = await claudeJSON<Extracted>({
		apiKey,
		system,
		user: message,
		schema: EXTRACT_SCHEMA,
		toolName: 'extract_reply',
		model: CLAUDE_FAST,
		temperature: 0,
		maxTokens: 256
	});
	if (result && !result.datetime_iso) result.datetime_iso = null; // normalize "" → null
	return result;
}

// Step 3 — generate a warm, natural reply that honours the availability facts.
async function generateReply(
	input: ConversationInput,
	facts: string,
	apiKey: string
): Promise<string | null> {
	const historyText = input.history
		.slice(-8)
		.map((t) => `${t.from === 'business' ? 'Us' : 'Customer'}: ${t.text}`)
		.join('\n');
	const system = input.emergency
		? `You are an assistant for ${input.companyName}, a local trades / home-services business. The customer just left an URGENT message. Write ONE short, calm, human SMS (2-3 sentences, no markdown):
1. Warmly acknowledge the urgency and say someone from ${input.companyName} will call them back right away.
2. IF — and only if — there is a SIMPLE, SAFE step a non-expert can take to limit damage or stay safe while they wait, briefly suggest it. Adapt to what they actually described (works for ANY trade): burst/leaking pipe → shut off the main water valve; roof leak → move valuables and put a bucket under the drip; backed-up drain → stop running water; appliance leaking/overflowing → turn it off at its own valve/switch if easily reachable.
3. SAFETY FIRST: NEVER suggest anything involving gas, live electricity, fire, heights, structural collapse, or physical danger. For anything hazardous (gas smell, sparks/smoke/fire, water near outlets, etc.) tell them to get to safety and call 911 or the relevant utility — do not have them attempt anything. If you're unsure a step is safe, or there's no obvious safe step, SKIP the tip and just reassure them.
Use ONLY these facts; never invent details:
${facts}`
		: `You are a warm, friendly assistant for ${input.companyName}, a local trades / home-services business, replying by SMS to ${input.customerName || 'the customer'}.
Write ONE short, natural, human reply (1-2 sentences, conversational, no corporate stiffness, no markdown). Continue the conversation.
Use ONLY these facts — never invent availability, prices, services or details you weren't given:
${facts}
How to handle different messages:
- Booking / times: if a proposed time is available, warmly confirm it; if not, apologise briefly and give the real hours or the booking link.
- General questions (what the business is/does, hours, location, services, "who are you?"): answer helpfully from the facts above. If you genuinely don't have that detail, say a team member will follow up shortly — do NOT make things up.
- Service requests ("I need my roof fixed", "my sink is leaking"): acknowledge warmly, say you can help, and move toward booking or connecting them with the team.
- If the message is unclear, vague, or off-topic: be friendly and ask how you can help.
Keep it brief and human.`;
	const content = await claudeText({
		apiKey,
		system,
		messages: [
			{
				role: 'user',
				content: `Conversation so far:\n${historyText}\n\nCustomer's latest message: "${input.message}"\n\nWrite our reply:`
			}
		],
		model: CLAUDE_FAST,
		temperature: 0.5,
		maxTokens: 300
	});
	return content ? content.replace(/^["']|["']$/g, '') : null;
}

export async function draftConversationalReply(
	input: ConversationInput
): Promise<ConversationResult | null> {
	const message = (input.message || '').trim();
	if (!message) return null;

	// Emergency: skip all scheduling logic — reply with an urgent ack + a safe self-mitigation tip.
	if (input.emergency) {
		const facts = `Business hours: ${describeBusinessHours(input.locations || [])}.`;
		const reply = await generateReply(input, facts, input.apiKey);
		return reply ? { reply, booked: false, datetime: null, available: null } : null;
	}

	const extracted = await extractReply(message, input.apiKey);

	let available: boolean | null = null;
	let datetime: string | null = null;
	const factLines: string[] = [`Our business hours are: ${describeBusinessHours(input.locations || [])}.`];
	if (input.businessInfo) {
		const b = input.businessInfo;
		const parts = [`This business is ${input.companyName}, a local trades / home-services company.`];
		if (b.services) parts.push(`Services offered: ${b.services}.`);
		if (b.address) parts.push(`Location: ${b.address}.`);
		if (b.website) parts.push(`Website: ${b.website}.`);
		factLines.push(`About the business (for general questions): ${parts.join(' ')}`);
	}
	if (input.accountBalance != null) {
		factLines.push(`The customer's outstanding balance is $${Number(input.accountBalance).toFixed(2)}.`);
	}

	if (input.appointments !== undefined) {
		if (input.appointments.length > 0) {
			const sorted = [...input.appointments].sort(
				(a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime()
			);
			const past = sorted.filter((a) => a.isPast);
			const upcoming = sorted.filter((a) => !a.isPast);
			const lines = sorted
				.map((a) => `- ${formatDatetime(a.startISO)} — ${a.title}${a.isPast ? ' [past]' : ' [upcoming]'}`)
				.join('\n');
			const lastAppt = past.length ? formatDatetime(past[past.length - 1].startISO) : 'none';
			const nextAppt = upcoming.length ? formatDatetime(upcoming[0].startISO) : 'none';
			factLines.push(
				`The customer's appointments on record:\n${lines}\nTheir LAST (most recent past) appointment was: ${lastAppt}. Their NEXT (soonest upcoming) appointment is: ${nextAppt}. When they ask about their appointment history (e.g. "when was my last appointment", "do I have anything on Tuesday", "what's my next appointment"), answer specifically and conversationally using these facts — give the exact date/time.`
			);
		} else {
			factLines.push(
				`The customer has NO appointments on record. If they ask about past or upcoming appointments, tell them you don't see any on file and offer to book one.`
			);
		}
	}

	// Availability ("what times are you free on Monday?"). We mix two sources so the reply is
	// never dead: live calendar slots are authoritative when we have them; otherwise fall back
	// to the day's business hours; only if we have neither do we say "nothing open". Exactly ONE
	// of these fires so the reply can't contradict itself.
	const liveDays = (input.availableSlots || []).filter((d) => d.slots.length > 0);
	if (liveDays.length > 0) {
		const lines = liveDays
			.map((d) => `- ${d.label}: ${d.slots.map((s) => s.label).join(', ')}`)
			.join('\n');
		factLines.push(
			`Real open appointment times from our calendar (already filtered to what the customer asked about):\n${lines}\nWhen they ask what times we're available, list these ACTUAL open times conversationally and offer to book one. Do NOT invent other times or say you'll "check and get back" — these ARE the open times.`
		);
	} else if (input.openHoursNote) {
		factLines.push(
			`The customer asked about availability. ${input.openHoursNote} Give them those open hours conversationally and ask what time works so we can get them booked (offer the booking link if one is provided). Do NOT invent specific open time-slots or claim a slot is free — we haven't confirmed the live calendar.`
		);
	} else if (input.availableSlots !== undefined) {
		factLines.push(
			`We have no open appointment times for the day the customer asked about (either fully booked or closed that day). Say so gently and offer the nearest days you can book instead.`
		);
	}

	// Reschedule takes priority over normal booking (it must cancel the right old appointment).
	if (input.reschedule) {
		if (input.reschedule.mode === 'link' && input.reschedule.link) {
			factLines.push(
				`The customer wants to RESCHEDULE their ${input.reschedule.targetLabel || 'existing'} appointment. Warmly acknowledge it, then give them THIS link to pick a new time — their current appointment is cancelled automatically ONLY when they confirm the new one, so nothing is lost meanwhile: ${input.reschedule.link}. Do NOT confirm a new time yourself, and do NOT say it's already moved.`
			);
		} else if (input.reschedule.mode === 'ask') {
			factLines.push(
				`The customer wants to reschedule but has MORE THAN ONE upcoming appointment: ${(input.reschedule.options || []).join('; ')}. Ask which ONE they'd like to move (by its date). Do NOT send a booking link or cancel anything yet.`
			);
		} else {
			factLines.push(
				`The customer mentioned rescheduling but has no upcoming appointment on file. Let them know gently and offer to book a new one.`
			);
		}
	}

	const bookingUrl = input.reschedule?.mode === 'link' ? '' : (input.bookingUrl || '').trim();

	if (extracted?.contains_datetime && extracted.datetime_iso) {
		datetime = extracted.datetime_iso;
		available = checkCalendarAvailability(datetime, input.locations || []);
		const pretty = formatDatetime(datetime);
		if (bookingUrl) {
			// Self-service booking is configured — acknowledge their time, then deep-link the page to
			// it (page opens pre-selected on that slot). Never claim it's booked; the link does that.
			const link = bookingLinkWith(bookingUrl, {
				time: datetime,
				name: input.customerName,
				phone: input.customerPhone
			});
			factLines.push(
				`The customer asked for ${pretty}. Warmly acknowledge that time, then give them THIS link to confirm it — the page opens on that time so they just tap confirm (they can also pick another slot or cancel there): ${link}. Do NOT say it's booked; the link does the booking.`
			);
		} else {
			factLines.push(
				available
					? `The customer proposed ${pretty}, and that time IS available — confirm the appointment for ${pretty}.`
					: `The customer proposed ${pretty}, but that is OUTSIDE our business hours — do not book it; suggest a time within our hours instead.`
			);
		}
	} else if (bookingUrl) {
		// No specific time given, but a booking link exists — offer it for any scheduling.
		const link = bookingLinkWith(bookingUrl, { name: input.customerName, phone: input.customerPhone });
		factLines.push(
			`If the customer wants to book, reschedule, or asks about appointment availability, share this booking link so they can pick an open slot themselves (it books both sides and lets them cancel): ${link}. Do not invent or promise specific times.`
		);
	}

	const reply = await generateReply(input, factLines.join('\n'), input.apiKey);
	if (!reply) return null;

	return {
		// When a self-service booking link is used, the customer books it themselves — we don't
		// auto-confirm a slot here.
		reply,
		booked: !bookingUrl && !!(available && datetime),
		datetime,
		available
	};
}
