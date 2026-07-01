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

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export interface ConversationTurn {
	from: 'customer' | 'business';
	text: string;
}

export interface ConversationInput {
	message: string;
	history: ConversationTurn[];
	companyName: string;
	customerName?: string | null;
	locations?: any[];
	accountBalance?: number | null;
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

// Step 1 — extract any proposed appointment datetime from the reply.
async function extractReply(message: string, apiKey: string): Promise<Extracted | null> {
	try {
		const res = await fetch(OPENAI_URL, {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				temperature: 0,
				top_p: 1,
				response_format: {
					type: 'json_schema',
					json_schema: {
						name: 'reply_extract',
						strict: true,
						schema: {
							type: 'object',
							additionalProperties: false,
							properties: {
								contains_datetime: { type: 'boolean' },
								datetime_iso: { type: ['string', 'null'] },
								reply_type: {
									type: 'string',
									enum: ['proposing_time', 'confirming', 'declining', 'question', 'other']
								}
							},
							required: ['contains_datetime', 'datetime_iso', 'reply_type']
						}
					}
				},
				messages: [
					{
						role: 'system',
						content: `You extract appointment date/time from a customer's SMS reply for a trades business. ${todayContext()}
If the reply proposes/agrees to a specific day and/or time, set contains_datetime=true and datetime_iso to an ISO 8601 timestamp (YYYY-MM-DDTHH:mm:ss) resolving relative dates against today; if only a day is given, use 09:00:00; if unclear, contains_datetime=false and datetime_iso=null.
reply_type: proposing_time (offers a time), confirming (agrees/says yes), declining (says no/cancel), question (asks something), other.
Return ONLY JSON.`
					},
					{ role: 'user', content: message }
				],
			})
		});
		if (!res.ok) return null;
		const data = await res.json();
		const content = data?.choices?.[0]?.message?.content;
		return content ? (JSON.parse(content) as Extracted) : null;
	} catch (e) {
		console.error('[conversation.extractReply] failed:', e);
		return null;
	}
}

// Step 3 — generate a warm, natural reply that honours the availability facts.
async function generateReply(
	input: ConversationInput,
	facts: string,
	apiKey: string
): Promise<string | null> {
	try {
		const historyText = input.history
			.slice(-8)
			.map((t) => `${t.from === 'business' ? 'Us' : 'Customer'}: ${t.text}`)
			.join('\n');
		const res = await fetch(OPENAI_URL, {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				temperature: 0.5,
				messages: [
					{
						role: 'system',
						content: `You are a warm, friendly scheduling assistant for ${input.companyName}, a trades service business. You are replying by SMS to ${input.customerName || 'the customer'}.
Write ONE short, natural, human reply (1-2 sentences, conversational, no corporate stiffness, no markdown). Continue the conversation.
You MUST honour these facts exactly — never invent availability or promise a time that isn't available:
${facts}
If a proposed time is available, warmly confirm it. If it is not available, apologise briefly, state the real hours, and ask for another time. If they asked a question, answer helpfully.`
					},
					{
						role: 'user',
						content: `Conversation so far:\n${historyText}\n\nCustomer's latest message: "${input.message}"\n\nWrite our reply:`
					}
				],
			})
		});
		if (!res.ok) return null;
		const data = await res.json();
		const content = data?.choices?.[0]?.message?.content?.trim();
		return content ? content.replace(/^["']|["']$/g, '') : null;
	} catch (e) {
		console.error('[conversation.generateReply] failed:', e);
		return null;
	}
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

	if (extracted?.contains_datetime && extracted.datetime_iso) {
		datetime = extracted.datetime_iso;
		available = checkCalendarAvailability(datetime, input.locations || []);
		const pretty = formatDatetime(datetime);
		factLines.push(
			available
				? `The customer proposed ${pretty}, and that time IS available — confirm the appointment for ${pretty}.`
				: `The customer proposed ${pretty}, but that is OUTSIDE our business hours — do not book it; suggest a time within our hours instead.`
		);
	}

	const reply = await generateReply(input, factLines.join('\n'), input.apiKey);
	if (!reply) return null;

	return {
		reply,
		booked: !!(available && datetime),
		datetime,
		available
	};
}
