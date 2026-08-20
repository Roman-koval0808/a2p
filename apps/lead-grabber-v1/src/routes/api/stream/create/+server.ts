import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { PUBLIC_ANT_MEDIA_URL } from '$env/static/public';

interface EncoderSettings {
	height: number;
	videoBitrate: number;
	audioBitrate: number;
	forceEncode: boolean;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ success: false, message: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = await request.json();
		const { streamId, name, description, camera = true, publish = true, encoderSettings } = body;

		if (!streamId || !name) {
			return json({ success: false, message: 'Stream ID and name are required' }, { status: 400 });
		}

		const serverUrl = PUBLIC_ANT_MEDIA_URL || '54.198.58.66:5080';
		const host = serverUrl.replace(/^(wss?:\/\/|https?:\/\/)/, '');
		const apiUrl = `http://${host}/WebRTCAppEE/rest/v2/broadcasts/create`;

		const defaultEncoderSettings: EncoderSettings = {
			height: 720,
			videoBitrate: 1000000,
			audioBitrate: 128000,
			forceEncode: true
		};

		const streamData: Record<string, any> = {
			streamId,
			name,
			description: description || '',
			type: 'liveStream',
			publishType: 'WebRTC',
			publish,
			publicStream: true,
			status: 'created',
			date: Date.now(),
			webRTCViewerLimit: 100,
			hlsViewerLimit: 100,
			dashViewerLimit: 100,
			mp4Enabled: 1,
			webMEnabled: 0,
			encoderSettingsList: [encoderSettings || defaultEncoderSettings],
			autoStartStopEnabled: true,
			hlsParameters: {
				hlsTime: '2',
				hlsListSize: '5',
				hlsPlayListType: 'EVENT'
			},
			...(camera && {
				is360: false,
				conferenceMode: 'play',
				quality: '720p'
			})
		};

		const response = await fetch(apiUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(streamData)
		});

		const result = await response.json();

		if (!response.ok) {
			if (result.message?.includes('already being used')) {
				return json({
					success: false,
					message: 'Stream ID is already in use. Please choose a different stream ID.',
					error: 'STREAM_ID_CONFLICT'
				}, { status: 409 });
			}
			return json({ success: false, message: result.message || 'Failed to create stream', error: result }, { status: response.status });
		}

		return json({ success: true, stream: result });
	} catch (error: any) {
		console.error('Error creating stream:', error);
		return json({ success: false, message: 'Failed to create stream', error: error.message }, { status: 500 });
	}
};