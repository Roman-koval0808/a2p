import { OPEN_AI_KEY } from '$env/static/private';

const OPENAI_API_URL = 'https://api.openai.com/v1';

/**
 * Transcribe audio using OpenAI's whisper-1 model.
 * Note: OpenAI requires a file upload, so we fetch the audio first and send it as FormData.
 */
export async function transcribeAudio(audioUrl: string): Promise<string> {
	try {
		console.log(`🎙️ Fetching audio from: ${audioUrl}`);
		const audioResponse = await fetch(audioUrl);
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
			body: formData
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
}> {
	try {
		const calendarReference = getReferenceCalendar();
		const prompt = `
    Analyze the following phone call transcript / voicemail message.
    ${department ? `\nDepartment selected by caller via IVR: ${department}\nUse this as context for determining intent, priority, and response.\n` : ''}
    ${calendarReference}
    Provide the output in valid JSON format with the following keys:
    - "summary": A concise summary of the call (2-3 sentences).
    - "intent": The main purpose or intent of the call (e.g., "Billing", "Sales", "Support", "Emergency").
    - "sub_intent": A more specific category. E.g. if Billing, is it "Accounts Receivable" or "Accounts Payable"? If not applicable, return null.
    - "urgency": One of "low", "medium", "high" based on the customer's tone and request.
    - "actionItems": A list of action items or next steps.
    - "sentiment": One of "Positive", "Negative", "Neutral", "Angry", "Anxious" based on the overall tone.
    - "callerName": Extract the caller's full name if they introduce themselves (e.g., "Hi, this is John Smith" → "John Smith"). If no name is mentioned, return null.
    - "buyingSignals": An array of detected buying intent signals. Look for phrases like:
      - Wanting to book an appointment → "appointment_request"
      - Wanting to speak to a representative → "rep_request"
      - Asking for a quote or estimate → "quote_request"
      - Mentioning a specific project or renovation → "active_project"
      - Mentioning urgency or emergency → "emergency"
      - Asking about pricing or availability → "pricing_inquiry"
      - Mentioning a competitor or comparison → "comparison_shopping"
      Return an empty array if no buying signals are detected.
    - "estimatedPrice": A number representing the estimated dollar value or price for the job if discussed or can be reasonably estimated based on the type of work described (e.g., water heater replacement: 1500, repair burst pipe: 500, simple leak: 200, faucet install: 150, standard inspection: 99). If the caller mentions a specific budget, price, or quote amount, use that value. If no specific service is described to estimate a price, return null.
    - "datetime": If the caller mentions a specific date or time they want to book an appointment for (e.g. "July 1 at 2pm" or "Saturday at 8am"), resolve it to the exact date using the Reference Calendar and output it in YYYY-MM-DDTHH:mm:ss format (e.g. "2026-06-27T08:00:00"). If no time is specified but a day is, set time to "12:00:00". If no appointment datetime is mentioned, return null.

    Transcript:
    "${transcript}"
    `;

		console.log('🧠 Sending to OpenAI for analysis...');
		const response = await fetch(`${OPENAI_API_URL}/chat/completions`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${OPEN_AI_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages: [
					{
						role: 'system',
						content:
							'You are an expert customer service analyst. You analyze phone calls and voicemails to extract the caller identity, sentiment, buying intent, sub-intent, and requested appointment datetime. Return only valid JSON.'
					},
					{ role: 'user', content: prompt }
				],
				temperature: 0.1, // Low temperature for deterministic output
				response_format: { type: 'json_object' }
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error('OpenAI Analysis Error:', errorText);
			throw new Error(`OpenAI Analysis Failed: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		const content = data.choices[0]?.message?.content;

		if (!content) {
			throw new Error('No content received from OpenAI analysis');
		}

		const result = JSON.parse(content);
		console.log('✅ Analysis complete:', result);

		return {
			summary: result.summary || 'No summary generated',
			intent: result.intent ?? '',
			sub_intent: result.sub_intent || null,
			urgency: result.urgency?.toLowerCase() || 'medium',
			actionItems: result.actionItems || [],
			sentiment: result.sentiment || 'Neutral',
			callerName: result.callerName || null,
			buyingSignals: result.buyingSignals || [],
			estimatedPrice: typeof result.estimatedPrice === 'number' ? result.estimatedPrice : null,
			datetime: result.datetime || null
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
			datetime: null
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

Output a JSON object with a single key "matched_id". If the new message belongs to one of the recent message threads, set "matched_id" to its ID. If it is a completely new and unrelated topic, set "matched_id" to null.
`;
		const response = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [{ role: 'user', content: prompt }],
			response_format: { type: 'json_object' },
			temperature: 0.1
		});

		const content = response.choices[0]?.message?.content || '{}';
		const result = JSON.parse(content);
		return result.matched_id || null;
	} catch (error) {
		console.error('Error in matchThreadOpenAI:', error);
		return null;
	}
}
