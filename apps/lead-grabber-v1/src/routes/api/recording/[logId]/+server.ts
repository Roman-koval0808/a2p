import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { TELNYX_API_KEY } from '$env/static/private';
import { join } from 'path';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';

const TELNYX_RECORDINGS_URL = 'https://api.telnyx.com/v2/recordings';

/** GET /api/recording/[logId] — stream call recording (fetches fresh URL from Telnyx to avoid expiry). */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const logId = params.logId;
	if (!logId) {
		return json({ error: 'Missing log ID' }, { status: 400 });
	}

	const log = await prisma.communicationLog.findFirst({
		where: {
			id: logId,
			companyId: locals.user.company.id
		},
		select: { metadata: true, type: true }
	});

	if (!log) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const meta = log.metadata as { recording_id?: string } | null;
	const recordingId = meta?.recording_id;
	if (!recordingId || log.type !== 'voice') {
		return json({ error: 'No recording for this log' }, { status: 404 });
	}

	// Check local filesystem first
	const localFilename = `${recordingId}.mp3`;
	const localFilePath = join(process.cwd(), 'static/uploads/recordings', localFilename);
	if (existsSync(localFilePath)) {
		try {
			const fileBuffer = await readFile(localFilePath);
			return new Response(fileBuffer, {
				status: 200,
				headers: {
					'Content-Type': 'audio/mpeg',
					'Cache-Control': 'private, max-age=3600'
				}
			});
		} catch (err) {
			console.error('Failed to read local recording file:', err);
		}
	}

	if (!TELNYX_API_KEY) {
		return json({ error: 'Server misconfiguration' }, { status: 500 });
	}

	const telnyxRes = await fetch(`${TELNYX_RECORDINGS_URL}/${encodeURIComponent(recordingId)}`, {
		headers: { Authorization: `Bearer ${TELNYX_API_KEY}` }
	});

	if (!telnyxRes.ok) {
		const err = await telnyxRes.text();
		console.error('Telnyx recording fetch failed:', telnyxRes.status, err);
		return json({ error: 'Failed to get recording' }, { status: 502 });
	}

	const data = await telnyxRes.json();
	const downloadUrls = data?.data?.download_urls ?? data?.download_urls;
	const audioUrl =
		typeof downloadUrls?.mp3 === 'string'
			? downloadUrls.mp3
			: typeof downloadUrls?.wav === 'string'
				? downloadUrls.wav
				: typeof downloadUrls === 'object' && downloadUrls !== null
					? (Object.values(downloadUrls).find(
							(v) => typeof v === 'string' && v.startsWith('http')
						) as string | undefined)
					: undefined;

	if (!audioUrl) {
		return json({ error: 'No download URL in recording' }, { status: 502 });
	}

	const audioRes = await fetch(audioUrl);
	if (!audioRes.ok) {
		console.error('Recording download failed:', audioRes.status);
		return json({ error: 'Failed to stream recording' }, { status: 502 });
	}

	const contentType = audioRes.headers.get('content-type') || 'audio/mpeg';
	const contentLength = audioRes.headers.get('content-length');

	const headers: Record<string, string> = {
		'Content-Type': contentType,
		'Cache-Control': 'private, max-age=3600'
	};
	if (contentLength) headers['Content-Length'] = contentLength;

	return new Response(audioRes.body, {
		status: 200,
		headers
	});
};
