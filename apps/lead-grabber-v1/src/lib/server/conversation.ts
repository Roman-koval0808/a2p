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
	const system = `You are a warm, friendly scheduling assistant for ${input.companyName}, a trades service business. You are replying by SMS to ${input.customerName || 'the customer'}.
Write ONE short, natural, human reply (1-2 sentences, conversational, no corporate stiffness, no markdown). Continue the conversation.
You MUST honour these facts exactly — never invent availability or promise a time that isn't available:
${facts}
If a proposed time is available, warmly confirm it. If it is not available, apologise briefly, state the real hours, and ask for another time. If they asked a question, answer helpfully.`;
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

	const extracted = await extractReply(message, input.apiKey);

	let available: boolean | null = null;
	let datetime: string | null = null;
	const factLines: string[] = [`Our business hours are: ${describeBusinessHours(input.locations || [])}.`];
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

	const bookingUrl = (input.bookingUrl || '').trim();

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
