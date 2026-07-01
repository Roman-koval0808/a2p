import { ANTHROPIC_AI_KEY } from '$env/static/private';
import { claudeText, claudeJSON, type ClaudeMessage } from '$lib/server/anthropic';

function getApiKey(): string | null {
	const key = ANTHROPIC_AI_KEY || process.env.ANTHROPIC_AI_KEY;
	if (!key?.trim()) {
		console.warn('[ai] ANTHROPIC_AI_KEY not set — AI classification/summary skipped');
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

const CLASSIFY_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	properties: {
		urgencyLevel: { type: 'integer', description: '1 (lowest) to 5 (urgent/critical)' },
		sentiment: { type: 'string', enum: ['sales', 'support'] },
		intent: {
			type: 'string',
			enum: ['inquiry', 'booking', 'complaint', 'follow-up', 'feedback', 'request', 'other']
		}
	},
	required: ['urgencyLevel', 'sentiment', 'intent']
};

function levelToUrgency(level: number): UrgencyColor {
	if (level === 1) return 'green';
	if (level >= 4) return 'red';
	return 'blue'; // 2–3
}

/**
 * Helper to call Claude with an OpenAI-style messages array (the system message is split out).
 */
async function callClaude(messages: any[], maxTokens = 150, temperature = 0.2): Promise<string | null> {
	const apiKey = getApiKey();
	if (!apiKey) return null;
	const system = messages.find((m) => m.role === 'system')?.content;
	const rest: ClaudeMessage[] = messages
		.filter((m) => m.role !== 'system')
		.map((m) => ({
			role: m.role === 'assistant' ? 'assistant' : 'user',
			content: String(m.content ?? '')
		}));
	return await claudeText({ apiKey, system, messages: rest, temperature, maxTokens });
}

/**
 * Classify message: urgency (1-5 → green/blue/red), sentiment, intent.
 * Pre-configured categories: Sales vs Support; subcategories like inquiry, booking, complaint, follow-up.
 */
export async function classifyMessage(content: string): Promise<ClassificationResult | null> {
	const apiKey = getApiKey();
	if (!apiKey) return null;
	try {
		const parsed = await claudeJSON<{ urgencyLevel?: number; sentiment?: string; intent?: string }>({
			apiKey,
			system: `You are a classifier for customer communications.
- urgencyLevel: integer 1-5 (1=lowest, 5=urgent/critical).
- sentiment: one of "sales" or "support".
- intent: one of "inquiry", "booking", "complaint", "follow-up", "feedback", "request", "other".`,
			user: content.slice(0, 4000),
			schema: CLASSIFY_SCHEMA,
			toolName: 'classify',
			temperature: 0.1,
			maxTokens: 128
		});

		if (!parsed) return null;

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

		const summary = await callClaude(
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

		const draft = await callClaude(
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
