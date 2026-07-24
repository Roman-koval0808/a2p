import { env } from '$env/dynamic/private';

export interface TranscribeOptions {
	model?: string;
	lang?: string;
}

export interface TranscriptionSegment {
	speaker: 'internal' | 'customer' | 'unknown';
	text: string;
	start?: number;
	end?: number;
	channel?: number;
}

export interface TranscriptionResult {
	text: string;
	segments: TranscriptionSegment[];
	raw?: any;
}

export async function transcribe(
	fileUrl: string,
	options: TranscribeOptions = {}
): Promise<TranscriptionResult> {
	const apiKey = env.TELNYX_API_KEY;
	const model = options.model || env.TELNYX_STT_MODEL || 'deepgram/nova-3';

	if (!apiKey) {
		console.warn('[Transcription] TELNYX_API_KEY missing, returning mock transcript');
		return {
			text: 'Mock transcript: Customer called regarding plumbing emergency.',
			segments: [
				{ speaker: 'customer', text: 'I have a burst pipe in the basement, water everywhere!' }
			]
		};
	}

	try {
		const res = await fetch('https://api.telnyx.com/v2/ai/audio/transcriptions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model,
				file_url: fileUrl,
				response_format: 'verbose_json',
				model_config: {
					smart_format: true,
					diarize: true,
					punctuate: true,
					...(options.lang ? { language: options.lang } : {})
				}
			})
		});

		if (!res.ok) {
			const errText = await res.text();
			throw new Error(`Telnyx STT API returned ${res.status}: ${errText}`);
		}

		const json = await res.json();
		const rawSegments = json.segments || json.words || [];

		const segments: TranscriptionSegment[] = rawSegments.map((seg: any) => {
			// On dual channel calls, channel 0 = internal rep, channel 1 = customer
			const channel = seg.channel !== undefined ? seg.channel : seg.speaker_channel;
			let speaker: 'internal' | 'customer' | 'unknown' = 'unknown';
			if (channel === 0) speaker = 'internal';
			else if (channel === 1) speaker = 'customer';

			return {
				speaker,
				text: seg.text || seg.word || '',
				start: seg.start,
				end: seg.end,
				channel
			};
		});

		const fullText = json.text || segments.map((s) => s.text).join(' ');

		return {
			text: fullText,
			segments,
			raw: json
		};
	} catch (err: any) {
		console.error('[Transcription] Error running transcription:', err?.message || err);
		throw err;
	}
}

export function formatDiarizedTranscript(segments: TranscriptionSegment[]): string {
	if (!segments || segments.length === 0) return '';
	return segments
		.map((s) => {
			const label = s.speaker === 'internal' ? 'Rep' : s.speaker === 'customer' ? 'Customer' : 'Speaker';
			return `[${label}]: ${s.text}`;
		})
		.join('\n');
}
