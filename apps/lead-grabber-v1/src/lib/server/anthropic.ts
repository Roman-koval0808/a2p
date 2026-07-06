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

/**
 * Strip artifacts a model sometimes adds around an SMS reply: a leading "SMS Reply:" / "Response:"
 * label (optionally bolded), surrounding quotes, and stray markdown bold. Keeps the message text.
 */
function cleanReplyText(raw: string): string {
	let s = raw.trim();
	// Leading label line, e.g. "**SMS Reply:**\n\n" or "Reply:".
	s = s.replace(/^\**\s*(sms\s*)?(reply|response|draft|message|answer)\s*:?\**\s*\n+/i, '');
	s = s.replace(/^\**\s*(sms\s*)?(reply|response|draft|message|answer)\s*:\s*/i, '');
	// Surrounding quotes and stray bold markers.
	s = s.replace(/\*\*/g, '').trim();
	s = s.replace(/^["']|["']$/g, '').trim();
	return s;
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

/**
 * A "skill" the model can invoke during an agentic reply. `run` receives the model's tool input
 * and returns a plain-text result that is fed back to the model. Keep results short and factual —
 * they become the grounding for the final reply.
 */
export interface ClaudeTool {
	name: string;
	description: string;
	input_schema: Record<string, any>;
	run: (input: any) => Promise<string>;
}

interface ClaudeAgentOpts {
	apiKey: string;
	system: string;
	/** The conversation so far. Usually a single user turn with history baked into the text. */
	messages: ClaudeMessage[];
	tools: ClaudeTool[];
	model?: string;
	temperature?: number;
	maxTokens?: number;
	/** Max tool-call rounds before we force a text answer. Guards against loops. */
	maxSteps?: number;
}

/**
 * Agentic reply: the model can call the supplied tools (skills) as many rounds as it needs to
 * gather real data, then writes a final text answer. Returns that text, or null on failure.
 *
 * This is the "let the AI complete the task itself" path — rather than pre-computing every fact,
 * we hand the model lookups (appointments, account summary, availability, …) and let it decide
 * which to use for the specific message.
 */
export async function claudeAgentReply(opts: ClaudeAgentOpts): Promise<string | null> {
	const {
		apiKey,
		system,
		tools,
		model = CLAUDE_FAST,
		temperature = 0.4,
		maxTokens = 512,
		maxSteps = 4
	} = opts;
	if (!apiKey) {
		console.error('[anthropic] ANTHROPIC_AI_KEY is not set');
		return null;
	}
	// Messages accumulate assistant tool_use + user tool_result blocks across rounds. Content is a
	// union of string | block[], so we type loosely here.
	const messages: any[] = opts.messages.map((m) => ({ role: m.role, content: m.content }));
	const toolDefs = tools.map((t) => ({
		name: t.name,
		description: t.description,
		input_schema: t.input_schema
	}));
	const byName = new Map(tools.map((t) => [t.name, t]));

	try {
		for (let step = 0; step < maxSteps; step++) {
			// On the final allowed step, drop the tools so the model is forced to answer in text.
			const lastStep = step === maxSteps - 1;
			const res = await fetch(ANTHROPIC_URL, {
				method: 'POST',
				headers: headers(apiKey),
				body: JSON.stringify({
					model,
					max_tokens: maxTokens,
					temperature,
					system,
					...(lastStep ? {} : { tools: toolDefs }),
					messages
				}),
				signal: AbortSignal.timeout(30000)
			});
			if (!res.ok) {
				console.error('[anthropic.claudeAgentReply] error:', await res.text());
				return null;
			}
			const data = await res.json();
			const content: any[] = Array.isArray(data?.content) ? data.content : [];

			if (data?.stop_reason === 'tool_use') {
				const toolUses = content.filter((b) => b.type === 'tool_use');
				// Record the assistant's turn (tool_use blocks), then run each tool and reply with results.
				messages.push({ role: 'assistant', content });
				const results: any[] = [];
				for (const tu of toolUses) {
					const tool = byName.get(tu.name);
					let out = '';
					try {
						out = tool ? await tool.run(tu.input || {}) : `Unknown tool: ${tu.name}`;
					} catch (e) {
						console.error(`[claudeAgentReply] tool ${tu.name} threw:`, e);
						out = 'That lookup failed just now.';
					}
					results.push({
						type: 'tool_result',
						tool_use_id: tu.id,
						content: out || 'No data found.'
					});
				}
				messages.push({ role: 'user', content: results });
				continue;
			}

			// No tool call → final answer.
			const text = content.find((b) => b.type === 'text')?.text;
			return typeof text === 'string' ? cleanReplyText(text) : null;
		}
		return null;
	} catch (e) {
		console.error('[anthropic.claudeAgentReply] failed:', e);
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
