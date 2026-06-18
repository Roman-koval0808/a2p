import { OPEN_AI_KEY } from '$env/static/private';

const OPENAI_API_URL = 'https://api.openai.com/v1';
const OPENAI_MODEL = 'gpt-4o-mini';

function getApiKey(): string | null {
	const key = OPEN_AI_KEY || process.env.OPEN_AI_KEY;
	if (!key?.trim()) {
		console.warn('[openai] OPEN_AI_KEY not set — AI classification/summary skipped');
		return null;
	}
	return key;
}

export type UrgencyLevel = 1 | 2 | 3 | 4 | 5;
export type UrgencyColor = 'green' | 'blue' | 'red';

export interface ClassificationResult {
	urgencyLevel: UrgencyLevel;
	urgency: UrgencyColor;
	sentiment: string;
	intent: string;
}

function levelToUrgency(level: number): UrgencyColor {
	if (level === 1) return 'green';
	if (level >= 4) return 'red';
	return 'blue'; // 2–3
}

/**
 * Helper to call OpenAI Chat Completions API
 */
async function callOpenAI(messages: any[], maxTokens = 150, temperature = 0.2, responseFormat?: any) {
	const apiKey = getApiKey();
	if (!apiKey) return null;

	try {
		const response = await fetch(`${OPENAI_API_URL}/chat/completions`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: OPENAI_MODEL,
				messages,
				max_tokens: maxTokens,
				temperature,
				...(responseFormat && { response_format: responseFormat })
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error('[openai] API error:', errorText);
			return null;
		}

		const data = await response.json();
		return data.choices?.[0]?.message?.content?.trim() || null;
	} catch (e) {
		console.error('[openai] fetch error:', e);
		return null;
	}
}

/**
 * Classify message: urgency (1-5 → green/blue/red), sentiment, intent.
 * Pre-configured categories: Sales vs Support; subcategories like inquiry, booking, complaint, follow-up.
 */
export async function classifyMessage(content: string): Promise<ClassificationResult | null> {
	try {
		const raw = await callOpenAI(
			[
				{
					role: 'system',
					content: `You are a classifier for customer communications. Respond with ONLY valid JSON, no markdown.
Rules:
- urgencyLevel: integer 1-5 (1=lowest, 5=urgent/critical).
- sentiment: one of "sales" or "support".
- intent: one of "inquiry", "booking", "complaint", "follow-up", "feedback", "request", "other".

Output format: {"urgencyLevel": N, "sentiment": "...", "intent": "..."}`
				},
				{
					role: 'user',
					content: content.slice(0, 4000)
				}
			],
			128,
			0.1,
			{ type: 'json_object' }
		);

		if (!raw) return null;

		const parsed = JSON.parse(raw.replace(/^```\w*\n?|\n?```$/g, '').trim()) as {
			urgencyLevel?: number;
			sentiment?: string;
			intent?: string;
		};
		const level = Math.min(5, Math.max(1, Number(parsed.urgencyLevel) || 1)) as UrgencyLevel;
		const result = {
			urgencyLevel: level,
			urgency: levelToUrgency(level),
			sentiment: typeof parsed.sentiment === 'string' ? parsed.sentiment : 'support',
			intent: typeof parsed.intent === 'string' ? parsed.intent : 'other'
		};
		console.log('[openai] classify:', result);
		return result;
	} catch (e) {
		console.error('[openai] classify error:', e);
		return null;
	}
}

/**
 * Generate a short human-readable summary of the message (and optional thread context).
 */
export async function summarizeMessage(
	content: string,
	threadContext?: { role: string; content: string }[]
): Promise<string | null> {
	try {
		const contextBlock = threadContext?.length
			? '\n\nPrevious messages in thread:\n' +
				threadContext
					.slice(-6)
					.map((m) => `${m.role}: ${(m.content || '').slice(0, 300)}`)
					.join('\n')
			: '';

		const summary = await callOpenAI(
			[
				{
					role: 'system',
					content:
						'Summarize the following message in 1-2 short sentences. Be factual and neutral. No preamble.'
				},
				{
					role: 'user',
					content: content.slice(0, 3000) + contextBlock
				}
			],
			150,
			0.2
		);

		if (summary) console.log('[openai] summary:', summary);
		return summary || null;
	} catch (e) {
		console.error('[openai] summarize error:', e);
		return null;
	}
}

/**
 * Draft a reply for human-in-the-loop. Nothing is sent automatically.
 * channel: 'email' | 'sms' | 'chatbot'
 */
export async function draftResponse(
	latestMessage: string,
	threadContext: { role: string; content: string }[],
	channel: 'email' | 'sms' | 'chatbot' = 'chatbot'
): Promise<string | null> {
	try {
		const contextBlock =
			threadContext.length > 0
				? 'Previous messages:\n' +
					threadContext
						.slice(-10)
						.map((m) => `${m.role}: ${(m.content || '').slice(0, 400)}`)
						.join('\n')
				: '';

		const draft = await callOpenAI(
			[
				{
					role: 'system',
					content: `You are a helpful agent drafting a reply. Channel: ${channel}.
- Be professional and concise.
- For SMS/chatbot keep it short. For email you can use 1-2 short paragraphs.
- Do not make promises you cannot keep. Suggest next steps (e.g. follow-up, confirmation) when appropriate.
- Output ONLY the draft reply text, no labels or meta.`
				},
				{
					role: 'user',
					content:
						contextBlock + '\n\nLatest message to respond to:\n' + latestMessage.slice(0, 2000)
				}
			],
			500,
			0.4
		);

		return draft || null;
	} catch (e) {
		console.error('[openai] draftResponse error:', e);
		return null;
	}
}

/**
 * Run classification + summarization for a new message. Returns fields to persist on Message.
 */
export async function analyzeIncomingMessage(
	content: string,
	threadMessages?: { content: string; is_agent_reply: boolean }[]
): Promise<{
	urgency?: ClassificationResult['urgency'];
	urgencyScore?: number;
	sentiment?: string;
	intent?: string;
	aiSummary?: string;
} | null> {
	const [classification, summary] = await Promise.all([
		classifyMessage(content),
		summarizeMessage(
			content,
			threadMessages?.map((m) => ({
				role: m.is_agent_reply ? 'agent' : 'customer',
				content: typeof m.content === 'string' ? m.content : ''
			}))
		)
	]);

	if (!classification && !summary) return null;

	const out = {
		...(classification && {
			urgency: classification.urgency,
			urgencyScore: classification.urgencyLevel,
			sentiment: classification.sentiment,
			intent: classification.intent
		}),
		...(summary && { aiSummary: summary })
	};
	console.log('[openai] analyzeIncomingMessage:', out);
	return out;
}
