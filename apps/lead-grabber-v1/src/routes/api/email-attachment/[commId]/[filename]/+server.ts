import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { join } from 'path';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';

const EXT_MIME: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	pdf: 'application/pdf',
	doc: 'application/msword',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	xls: 'application/vnd.ms-excel',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	csv: 'text/csv',
	txt: 'text/plain',
	mp4: 'video/mp4',
	mov: 'video/quicktime',
	zip: 'application/zip',
};

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const commId = params.commId;
	const filename = params.filename;
	if (!commId || !filename) {
		return json({ error: 'Missing parameters' }, { status: 400 });
	}

	// The filename lands in a path join below — a decoded "../" would read outside the upload dir.
	if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
		return json({ error: 'Invalid filename' }, { status: 400 });
	}

	const log = await prisma.communicationLog.findFirst({
		where: { id: commId, companyId: locals.user.company.id },
		select: { id: true }
	});

	if (!log) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const filePath = join(process.cwd(), 'static/uploads/email', commId, filename);
	if (!existsSync(filePath)) {
		return json({ error: 'File not found' }, { status: 404 });
	}

	try {
		const fileBuffer = await readFile(filePath);
		const ext = filename.split('.').pop()?.toLowerCase() || '';
		const contentType = EXT_MIME[ext] || 'application/octet-stream';
		return new Response(fileBuffer, {
			status: 200,
			headers: {
				'Content-Type': contentType,
				'Cache-Control': 'private, max-age=3600',
				'Content-Disposition': `inline; filename="${filename}"`
			}
		});
	} catch (err) {
		console.error('Failed to read attachment file:', err);
		return json({ error: 'Failed to read file' }, { status: 500 });
	}
};
