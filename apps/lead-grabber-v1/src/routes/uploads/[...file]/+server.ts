import { error } from '@sveltejs/kit';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import type { RequestHandler } from './$types';

function getMimeType(filePath: string): string {
	const ext = filePath.split('.').pop()?.toLowerCase();
	switch (ext) {
		case 'png': return 'image/png';
		case 'jpg':
		case 'jpeg': return 'image/jpeg';
		case 'webp': return 'image/webp';
		case 'gif': return 'image/gif';
		case 'mp3': return 'audio/mpeg';
		case 'wav': return 'audio/wav';
		case 'ogg': return 'audio/ogg';
		case 'mp4': return 'video/mp4';
		case 'webm': return 'video/webm';
		default: return 'application/octet-stream';
	}
}

export const GET: RequestHandler = async ({ params }) => {
	const fileParam = params.file;
	if (!fileParam) {
		throw error(400, 'Missing file parameter');
	}

	// Resolve the base upload path to prevent path traversal vulnerability (like ../)
	const baseDir = resolve(process.cwd(), 'static/uploads');
	const targetPath = resolve(baseDir, fileParam);

	// Security check: ensure targetPath is actually inside baseDir
	if (!targetPath.startsWith(baseDir)) {
		throw error(403, 'Access denied');
	}

	if (!existsSync(targetPath)) {
		throw error(404, 'File not found');
	}

	try {
		const data = readFileSync(targetPath);
		const mimeType = getMimeType(targetPath);

		return new Response(data, {
			headers: {
				'Content-Type': mimeType,
				'Cache-Control': 'public, max-age=31536000',
				'Access-Control-Allow-Origin': '*'
			}
		});
	} catch (err: any) {
		console.error(`Error serving file ${fileParam}:`, err);
		throw error(500, 'Error reading file');
	}
};
