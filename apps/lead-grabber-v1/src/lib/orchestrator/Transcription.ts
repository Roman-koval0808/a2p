import { OPEN_AI_KEY } from '$env/static/private';
// If DEEPGRAM_API_KEY is not in env, we can fallback to OpenAI or declare it later.
// For now, let's assume it might be available in process.env if not in $env/static/private.
import { env } from '$env/dynamic/private';

const DEEPGRAM_API_KEY = env.DEEPGRAM_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1';

export interface TranscriptionOptions {
	multichannel?: boolean; // True for bridged calls (channel 0 = internal, channel 1 = customer)
	language?: string; // e.g. 'en', 'fr'
}

/**
 * Transcribes an audio URL using Deepgram (Nova-3) by default.
 * Falls back to OpenAI Whisper if Deepgram is unavailable or for non-English audio,
 * based on the spec requirements.
 */
export async function transcribeAudio(audioUrl: string, options?: TranscriptionOptions): Promise<string> {
	const isFrench = options?.language === 'fr';
	
	// Fallback to OpenAI Whisper for French or if Deepgram key is missing
	if (isFrench || !DEEPGRAM_API_KEY) {
		console.log(`🎙️ Using OpenAI Whisper fallback (Language: ${options?.language || 'en'}, Deepgram key: ${!!DEEPGRAM_API_KEY})`);
		return transcribeWithOpenAI(audioUrl, isFrench);
	}

	return transcribeWithDeepgram(audioUrl, !!options?.multichannel);
}

async function transcribeWithDeepgram(audioUrl: string, multichannel: boolean): Promise<string> {
	console.log(`🎙️ Fetching audio for Deepgram from: ${audioUrl}`);
	const audioResponse = await fetch(audioUrl, { signal: AbortSignal.timeout(30000) });
	if (!audioResponse.ok) {
		throw new Error(`Failed to fetch audio: ${audioResponse.statusText}`);
	}
	const audioBlob = await audioResponse.blob();

	let url = 'https://api.deepgram.com/v1/listen?model=nova-3&punctuate=true&smart_format=true';
	
	if (multichannel) {
		url += '&multichannel=true';
	} else {
		// Only diarize if single channel (to detect multiple speakers on same line)
		url += '&diarize=true';
	}

	console.log(`🎙️ Sending to Deepgram (${multichannel ? 'multichannel' : 'diarized'})`);
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Token ${DEEPGRAM_API_KEY}`,
			'Content-Type': audioBlob.type || 'audio/mp3'
		},
		body: audioBlob,
		signal: AbortSignal.timeout(30000)
	});

	if (!response.ok) {
		const errorText = await response.text();
		console.error('Deepgram Transcription Error:', errorText);
		throw new Error(`Deepgram Transcription Failed: ${response.status} ${response.statusText}`);
	}

	const data = await response.json();
	return parseDeepgramResponse(data, multichannel);
}

function parseDeepgramResponse(data: any, multichannel: boolean): string {
	if (multichannel) {
		// Deepgram returns channels as an array
		const channels = data?.results?.channels || [];
		let transcript = '';
		
		// Map words by start time across all channels
		const allWords: { start: number; text: string; channel: number }[] = [];
		
		for (let i = 0; i < channels.length; i++) {
			const channelWords = channels[i]?.alternatives?.[0]?.words || [];
			for (const word of channelWords) {
				allWords.push({
					start: word.start,
					text: word.punctuated_word || word.word,
					channel: i
				});
			}
		}
		
		allWords.sort((a, b) => a.start - b.start);
		
		let currentChannel = -1;
		for (const word of allWords) {
			if (word.channel !== currentChannel) {
				currentChannel = word.channel;
				// Spec: channel 0 = internal, channel 1 = customer
				const speakerLabel = currentChannel === 0 ? 'Internal' : 'Customer';
				transcript += `\n[${speakerLabel}]: `;
			}
			transcript += word.text + ' ';
		}
		
		return transcript.trim();
	} else {
		// Diarized single channel
		const words = data?.results?.channels?.[0]?.alternatives?.[0]?.words || [];
		let transcript = '';
		let currentSpeaker = -1;
		
		for (const word of words) {
			if (word.speaker !== currentSpeaker) {
				currentSpeaker = word.speaker;
				transcript += `\n[Speaker ${currentSpeaker}]: `;
			}
			transcript += (word.punctuated_word || word.word) + ' ';
		}
		
		return transcript.trim();
	}
}

async function transcribeWithOpenAI(audioUrl: string, isFrench: boolean): Promise<string> {
	console.log(`🎙️ Fetching audio for OpenAI from: ${audioUrl}`);
	const audioResponse = await fetch(audioUrl, { signal: AbortSignal.timeout(30000) });
	if (!audioResponse.ok) {
		throw new Error(`Failed to fetch audio: ${audioResponse.statusText}`);
	}
	const audioBlob = await audioResponse.blob();

	const formData = new FormData();
	formData.append('file', audioBlob, 'recording.mp3');
	// Spec: Fallback: openai/whisper-large-v3-turbo for French
	const model = isFrench ? 'whisper-large-v3-turbo' : 'whisper-1';
	formData.append('model', model);
	formData.append('response_format', 'text');
	formData.append('prompt', 'ClearSky Software, support, bank account');

	if (isFrench) {
		formData.append('language', 'fr');
	}

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
	return transcript.trim();
}
