// Shared Anthropic (Claude) API helpers — the app's single place for LLM calls.
// Replaces the previous direct OpenAI chat-completions usage.
//
//  - claudeText: free-form text reply (system + messages).
//  - claudeJSON: strict structured output via a forced tool call (the Anthropic equivalent
//    of OpenAI's json_schema mode). Returns the parsed tool input.
//
// The API key is passed in so these stay plain, testable units.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Fast/cheap tier — the drop-in replacement for gpt-4o-mini across extraction, classification
// and conversational replies.
export const CLAUDE_FAST = 'claude-haiku-4-5-20251001';

export interface ClaudeMessage {
	role: 'user' | 'assistant';
	content: string;
}

interface ClaudeTextOpts {
	apiKey: string;
	messages: ClaudeMessage[];
	system?: string;
	model?: string;
	temperature?: number;
	maxTokens?: number;
}

function headers(apiKey: string) {
	return {
		'x-api-key': apiKey,
		'anthropic-version': ANTHROPIC_VERSION,
		'content-type': 'application/json'
	};
}

/** Free-form text completion. Returns the text, or null on any failure. */
export async function claudeText(opts: ClaudeTextOpts): Promise<string | null> {
	const { apiKey, messages, system, model = CLAUDE_FAST, temperature = 0, maxTokens = 1024 } = opts;
	if (!apiKey) {
		console.error('[anthropic] ANTHROPIC_AI_KEY is not set');
		return null;
	}
	try {
		const res = await fetch(ANTHROPIC_URL, {
			method: 'POST',
			headers: headers(apiKey),
			body: JSON.stringify({
				model,
				max_tokens: maxTokens,
				temperature,
				...(system ? { system } : {}),
				messages
			}),
			signal: AbortSignal.timeout(30000)
		});
		if (!res.ok) {
			console.error('[anthropic.claudeText] error:', await res.text());
			return null;
		}
		const data = await res.json();
		const text = data?.content?.find((b: any) => b.type === 'text')?.text;
		return typeof text === 'string' ? text.trim() : null;
	} catch (e) {
		console.error('[anthropic.claudeText] failed:', e);
		return null;
	}
}

interface ClaudeJSONOpts {
	apiKey: string;
	user: string;
	schema: Record<string, any>;
	system?: string;
	toolName?: string;
	model?: string;
	temperature?: number;
	maxTokens?: number;
}

/**
 * Structured output: the model is forced to call a single tool whose input_schema is `schema`,
 * so the returned value always matches the shape. Returns the parsed input, or null on failure.
 */
export async function claudeJSON<T = any>(opts: ClaudeJSONOpts): Promise<T | null> {
	const {
		apiKey,
		user,
		schema,
		system,
		toolName = 'extract',
		model = CLAUDE_FAST,
		temperature = 0,
		maxTokens = 1024
	} = opts;
	if (!apiKey) {
		console.error('[anthropic] ANTHROPIC_AI_KEY is not set');
		return null;
	}
	try {
		const res = await fetch(ANTHROPIC_URL, {
			method: 'POST',
			headers: headers(apiKey),
			body: JSON.stringify({
				model,
				max_tokens: maxTokens,
				temperature,
				...(system ? { system } : {}),
				tools: [{ name: toolName, description: 'Return the structured result.', input_schema: schema }],
				tool_choice: { type: 'tool', name: toolName },
				messages: [{ role: 'user', content: user }]
			}),
			signal: AbortSignal.timeout(30000)
		});
		if (!res.ok) {
			console.error('[anthropic.claudeJSON] error:', await res.text());
			return null;
		}
		const data = await res.json();
		const toolUse = data?.content?.find((b: any) => b.type === 'tool_use');
		return (toolUse?.input as T) ?? null;
	} catch (e) {
		console.error('[anthropic.claudeJSON] failed:', e);
		return null;
	}
}
