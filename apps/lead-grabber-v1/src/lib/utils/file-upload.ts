import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const UPLOAD_DIR = 'static/uploads/logos';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

export async function saveUploadedFile(file: File, filename?: string): Promise<string> {
	// Validate file
	if (file.size > MAX_FILE_SIZE) {
		throw new Error('File size exceeds 5MB limit');
	}

	if (!ALLOWED_TYPES.includes(file.type)) {
		throw new Error('Invalid file type. Only PNG, JPEG, and WebP images are allowed.');
	}

	// Ensure upload directory exists
	const uploadPath = join(process.cwd(), UPLOAD_DIR);
	if (!existsSync(uploadPath)) {
		await mkdir(uploadPath, { recursive: true });
	}

	// Generate filename if not provided
	let finalFilename = filename;
	if (!finalFilename) {
		const ext = file.name.split('.').pop() || 'png';
		finalFilename = `${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
	} else if (!finalFilename.includes('.')) {
		// If filename provided without extension, add it
		const ext = file.name.split('.').pop() || 'png';
		finalFilename = `${finalFilename}.${ext}`;
	}
	const filePath = join(uploadPath, finalFilename);

	// Convert File to Buffer and save
	const arrayBuffer = await file.arrayBuffer();
	const buffer = Buffer.from(arrayBuffer);
	await writeFile(filePath, buffer);

	// Return the public URL path
	return `/uploads/logos/${finalFilename}`;
}

const IVR_UPLOAD_DIR = 'static/uploads/ivr';
const IVR_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB for audio
const IVR_ALLOWED_TYPES = [
	'audio/mpeg',
	'audio/mp3',
	'audio/wav',
	'audio/wave',
	'audio/x-wav',
	'audio/mp4',
	'audio/webm',
	'audio/ogg'
];

export async function saveIvrAudio(file: File, filename?: string): Promise<string> {
	if (file.size > IVR_MAX_FILE_SIZE) {
		throw new Error('Audio file size exceeds 10MB limit');
	}
	const type = file.type.toLowerCase();
	if (!IVR_ALLOWED_TYPES.includes(type) && !file.name.match(/\.(mp3|wav|mp4|webm|ogg|m4a)$/i)) {
		throw new Error('Invalid file type. Allowed: MP3, WAV, MP4, WebM, OGG.');
	}
	const uploadPath = join(process.cwd(), IVR_UPLOAD_DIR);
	if (!existsSync(uploadPath)) {
		await mkdir(uploadPath, { recursive: true });
	}
	let finalFilename = filename;
	if (!finalFilename) {
		const ext = file.name.split('.').pop() || 'mp3';
		finalFilename = `ivr-${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
	} else if (!finalFilename.includes('.')) {
		const ext = file.name.split('.').pop() || 'mp3';
		finalFilename = `${finalFilename}.${ext}`;
	}
	const filePath = join(uploadPath, finalFilename);
	const arrayBuffer = await file.arrayBuffer();
	const buffer = Buffer.from(arrayBuffer);
	await writeFile(filePath, buffer);
	return `/uploads/ivr/${finalFilename}`;
}

// Note: getFileUrl has been moved to file-url.ts for client-side compatibility
// Import it from there if needed in client code
