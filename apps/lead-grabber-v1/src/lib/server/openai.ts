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

/**
 * Analyze call transcript using OpenAI GPT-4o-mini to generate summary, intent, urgency,
 * action items, caller name, and buying signals.
 */
export async function analyzeCallLog(transcript: string): Promise<{
	summary: string;
	intent: string;
	urgency: 'low' | 'medium' | 'high';
	actionItems: string[];
	sentiment: string;
	callerName: string | null;
	buyingSignals: string[];
}> {
	try {
		const prompt = `
    Analyze the following phone call transcript / voicemail message.
    Provide the output in valid JSON format with the following keys:
    - "summary": A concise summary of the call (2-3 sentences).
    - "intent": The main purpose or intent of the call (e.g., "Request information", "Complaint", "Booking", "Emergency").
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
							'You are an expert customer service analyst. You analyze phone calls and voicemails to extract the caller identity, sentiment, buying intent, and urgency. Return only valid JSON. For callerName, extract the exact name if the caller introduces themselves; otherwise return null.'
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
			urgency: result.urgency?.toLowerCase() || 'medium',
			actionItems: result.actionItems || [],
			sentiment: result.sentiment || 'Neutral',
			callerName: result.callerName || null,
			buyingSignals: result.buyingSignals || []
		};
	} catch (error) {
		console.error('Error in analyzeCallLog:', error);
		return {
			summary: 'Analysis failed',
			intent: '',
			urgency: 'medium',
			actionItems: [],
			sentiment: 'Unknown',
			callerName: null,
			buyingSignals: []
		};
	}
}
