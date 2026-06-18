import { uploadToBunny } from '$lib/server/bunny';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
	'audio/mpeg',
	'audio/mp3',
	'audio/wav',
	'audio/wave',
	'audio/x-wav',
	'audio/mp4',
	'audio/webm',
	'audio/ogg'
];

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	try {
		const formData = await request.formData();
		const file = formData.get('file') as File;
		const type = formData.get('type')?.toString() || 'audio';

		if (!file) {
			return json({ error: 'No file provided' }, { status: 400 });
		}

		if (file.size > MAX_FILE_SIZE) {
			return json({ error: 'File size exceeds 10MB limit' }, { status: 400 });
		}

		const fileType = file.type.toLowerCase();
		if (!ALLOWED_TYPES.includes(fileType) && !file.name.match(/\.(mp3|wav|mp4|webm|ogg|m4a)$/i)) {
			return json(
				{ error: 'Invalid file type. Allowed: MP3, WAV, MP4, WebM, OGG.' },
				{ status: 400 }
			);
		}

		const ext = file.name.split('.').pop() || 'mp3';
		const filename = `${type}-${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;

		const arrayBuffer = await file.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		const url = await uploadToBunny(buffer, filename, 'ivr-audio');
		return json({ url });
	} catch (err: unknown) {
		console.error('IVR upload error:', err);
		return json(
			{ error: err instanceof Error ? err.message : 'Failed to upload audio' },
			{ status: 500 }
		);
	}
};
