import { OPEN_AI_KEY, ANTHROPIC_AI_KEY } from '$env/static/private';
import { claudeJSON } from './anthropic';

// OpenAI is kept ONLY for Whisper audio transcription (Anthropic has no audio API).
// All text analysis/classification uses Anthropic (Claude) via ./anthropic.
const OPENAI_API_URL = 'https://api.openai.com/v1';

const ANALYSIS_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	properties: {
		summary: { type: 'string', description: 'concise 2-3 sentence summary' },
		intent: { type: 'string', description: 'e.g. Billing, Sales, Support, Emergency' },
		sub_intent: { type: 'string', description: 'more specific category, or empty string if N/A' },
		urgency: { type: 'string', enum: ['low', 'medium', 'high'] },
		actionItems: { type: 'array', items: { type: 'string' } },
		sentiment: {
			type: 'string',
			enum: ['Positive', 'Negative', 'Neutral', 'Angry', 'Anxious']
		},
		callerName: { type: 'string', description: "caller's full name, or empty string if not stated" },
		buyingSignals: { type: 'array', items: { type: 'string' } },
		estimatedPrice: { type: 'number', description: 'estimated dollar value, or 0 if none' },
		datetime: {
			type: 'string',
			description: 'appointment time as YYYY-MM-DDTHH:mm:ss, or empty string if none'
		}
	},
	required: [
		'summary',
		'intent',
		'sub_intent',
		'urgency',
		'actionItems',
		'sentiment',
		'callerName',
		'buyingSignals',
		'estimatedPrice',
		'datetime'
	]
};

const THREAD_MATCH_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	properties: {
		matched_id: {
			type: 'string',
			description: 'ID of the recent message this belongs to, or empty string if unrelated'
		}
	},
	required: ['matched_id']
};

/**
 * Transcribe audio using OpenAI's whisper-1 model.
 * Note: OpenAI requires a file upload, so we fetch the audio first and send it as FormData.
 */
export async function transcribeAudio(audioUrl: string): Promise<string> {
	try {
		console.log(`🎙️ Fetching audio from: ${audioUrl}`);
		const audioResponse = await fetch(audioUrl, { signal: AbortSignal.timeout(30000) });
		if (!audioResponse.ok) {
			throw new Error(`Failed to fetch audio: ${audioResponse.statusText}`);
		}
		const audioBlob = await audioResponse.blob();

		const formData = new FormData();
		formData.append('file', audioBlob, 'recording.mp3');
		formData.append('model', 'whisper-1');
		formData.append('response_format', 'text');
		formData.append('prompt', 'ClearSky Software, support, bank account');

		console.log('🎙️ Sending to OpenAI for transcription...');
		const response = await fetch(`${OPENAI_API_URL}/audio/transcriptions`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${OPEN_AI_KEY}`
			},
			body: formData,
			signal: AbortSignal.timeout(30000)
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error('OpenAI Transcription Error:', errorText);
			throw new Error(`OpenAI Transcription Failed: ${response.status} ${response.statusText}`);
		}

		const transcript = await response.text();
		console.log('✅ Transcription complete (length:', transcript.length, ')');
		return transcript;
	} catch (error) {
		console.error('Error in transcribeAudio:', error);
		throw error;
	}
}


export function getReferenceCalendar(): string {
	const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	const now = new Date();
	
	let calendarPrompt = `Today's current date and time: ${now.toLocaleString()} (timezone of the server).
Reference Calendar for resolving relative days (like "saturday", "tomorrow", "next week Monday", etc.):\n`;
	
	for (let i = 0; i < 10; i++) {
		const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
		const dayName = daysOfWeek[d.getDay()];
		const dateString = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
		const label = i === 0 ? ' (Today)' : i === 1 ? ' (Tomorrow)' : '';
		calendarPrompt += `- ${dayName}${label}: ${dateString}\n`;
	}
	return calendarPrompt;
}

/**
 * Analyze call transcript using OpenAI GPT-4o-mini to generate summary, intent, urgency,
 * action items, caller name, and buying signals.
 */
export async function analyzeCallLog(
	transcript: string,
	department?: string | null
): Promise<{
	summary: string;
	intent: string;
	sub_intent: string | null;
	urgency: 'low' | 'medium' | 'high';
	actionItems: string[];
	sentiment: string;
	callerName: string | null;
	buyingSignals: string[];
	estimatedPrice: number | null;
	datetime: string | null;
	analysisSucceeded: boolean;
}> {
	try {
		const calendarReference = getReferenceCalendar();
		const prompt = `
    Analyze the following phone call transcript / voicemail message.
    IMPORTANT: The transcript may START with an automated IVR greeting/menu spoken by the system,
    e.g. "Welcome to [Company], for billing press 1, for sales press 2..." or "Thank you for
    calling...". That greeting text is NOT spoken by the caller — do NOT treat its menu wording as
    the caller's intent. Ignore the greeting text and base the summary and intent on the caller's
    OWN words. (The department the caller selected via the menu is provided separately below and is
    valid routing context — but the caller's actual words decide the true intent if they differ.)
    If the caller said nothing meaningful beyond the greeting, say so in the summary.
    ${department ? `\nDepartment selected by caller via IVR: ${department}\nUse this as context for determining intent, priority, and response.\n` : ''}
    ${calendarReference}
    Provide the output in valid JSON format with the following keys:
    - "summary": A concise summary of the call (2-3 sentences).
    - "intent": The main purpose or intent of the call (e.g., "Billing", "Sales", "Support", "Emergency").
    - "sub_intent": A more specific category. E.g. if Billing, is it "Accounts Receivable" or "Accounts Payable"? If not applicable, return an empty string.
    - "urgency": One of "low", "medium", "high" based on the customer's tone and request.
    - "actionItems": A list of action items or next steps.
    - "sentiment": One of "Positive", "Negative", "Neutral", "Angry", "Anxious" based on the overall tone.
    - "callerName": Extract the caller's full name if they introduce themselves (e.g., "Hi, this is John Smith" → "John Smith"). If no name is mentioned, return an empty string.
    - "buyingSignals": An array of detected buying intent signals. Look for phrases like:
      - Wanting to book an appointment → "appointment_request"
      - Wanting to speak to a representative → "rep_request"
      - Asking for a quote or estimate → "quote_request"
      - Mentioning a specific project or renovation → "active_project"
      - Mentioning urgency or emergency → "emergency"
      - Asking about pricing or availability → "pricing_inquiry"
      - Mentioning a competitor or comparison → "comparison_shopping"
      Return an empty array if no buying signals are detected.
    - "estimatedPrice": A number representing the estimated dollar value or price for the job if discussed or can be reasonably estimated based on the type of work described (e.g., water heater replacement: 1500, repair burst pipe: 500, simple leak: 200, faucet install: 150, standard inspection: 99). If the caller mentions a specific budget, price, or quote amount, use that value. If no specific service is described to estimate a price, return 0.
    - "datetime": If the caller mentions a specific date or time they want to book an appointment for (e.g. "July 1 at 2pm" or "Saturday at 8am"), resolve it to the exact date using the Reference Calendar and output it in YYYY-MM-DDTHH:mm:ss format (e.g. "2026-06-27T08:00:00"). If no time is specified but a day is, set time to "12:00:00". If no appointment datetime is mentioned, return an empty string.

    Transcript:
    "${transcript}"
    `;

		console.log('🧠 Sending to Claude for analysis...');
		const result = await claudeJSON<any>({
			apiKey: ANTHROPIC_AI_KEY,
			system:
				'You are an expert customer service analyst. You analyze phone calls and voicemails to extract the caller identity, sentiment, buying intent, sub-intent, and requested appointment datetime.',
			user: prompt,
			schema: ANALYSIS_SCHEMA,
			toolName: 'analyze_call',
			temperature: 0.1,
			maxTokens: 1024
		});

		if (!result) {
			throw new Error('No content received from Claude analysis');
		}
		console.log('✅ Analysis complete:', result);

		const validUrgencies = ['low', 'medium', 'high'];
		const parsedUrgency = result.urgency?.toLowerCase();

		return {
			summary: result.summary || 'No summary generated',
			intent: result.intent ?? '',
			sub_intent: result.sub_intent || null,
			urgency: validUrgencies.includes(parsedUrgency) ? parsedUrgency : 'medium',
			actionItems: result.actionItems || [],
			sentiment: result.sentiment || 'Neutral',
			callerName: result.callerName || null,
			buyingSignals: result.buyingSignals || [],
			estimatedPrice:
				typeof result.estimatedPrice === 'number' && result.estimatedPrice > 0
					? result.estimatedPrice
					: null,
			datetime: result.datetime || null,
			analysisSucceeded: true
		};
	} catch (error) {
		console.error('Error in analyzeCallLog:', error);
		return {
			summary: 'Analysis failed',
			intent: '',
			sub_intent: null,
			urgency: 'medium',
			actionItems: [],
			sentiment: 'Unknown',
			callerName: null,
			buyingSignals: [],
			estimatedPrice: null,
			datetime: null,
			analysisSucceeded: false
		};
	}
}

export async function matchThreadOpenAI(currentMessage: string, recentMessages: { id: string; content: string }[]): Promise<string | null> {
	if (!recentMessages || recentMessages.length === 0) return null;

	try {
		const prompt = `
You are an AI assistant determining if a new message belongs to the same conversation thread as any of the recent past messages.
Compare the new message against the list of recent messages and determine if it conceptually belongs to the same ongoing issue, inquiry, or topic.

New Message: "${currentMessage}"

Recent Messages:
${recentMessages.map((m, i) => `[${i}] (ID: ${m.id}): "${m.content}"`).join('\n')}

Set "matched_id" to the ID of the recent message this belongs to. If it is a completely new and unrelated topic, set "matched_id" to an empty string.
`;
		const result = await claudeJSON<{ matched_id: string }>({
			apiKey: ANTHROPIC_AI_KEY,
			user: prompt,
			schema: THREAD_MATCH_SCHEMA,
			toolName: 'match_thread',
			temperature: 0.1,
			maxTokens: 128
		});
		return result?.matched_id || null;
	} catch (error) {
		console.error('Error in matchThreadOpenAI:', error);
		return null;
	}
}
