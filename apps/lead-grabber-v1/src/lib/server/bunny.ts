import { BUNNY_ACCESS_KEY, BUNNY_STORAGE_ZONE_NAME, BUNNY_REGION } from '$env/static/private';

const STORAGE_BASE_URL = `https://${BUNNY_REGION}/${BUNNY_STORAGE_ZONE_NAME}`;
const CDN_BASE_URL = `https://${BUNNY_STORAGE_ZONE_NAME}.b-cdn.net`;

export async function uploadToBunny(
	buffer: Buffer,
	filename: string,
	folder = 'ivr-audio'
): Promise<string> {
	const path = `${folder}/${filename}`;
	const uploadUrl = `${STORAGE_BASE_URL}/${path}`;

	const response = await fetch(uploadUrl, {
		method: 'PUT',
		headers: {
			AccessKey: BUNNY_ACCESS_KEY,
			'Content-Type': 'application/octet-stream'
		},
		body: buffer
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Bunny CDN upload failed: ${response.status} - ${text}`);
	}

	// Return the CDN URL for the uploaded file
	return `${CDN_BASE_URL}/${path}`;
}

export async function deleteFromBunny(fileUrl: string): Promise<void> {
	// Extract path from CDN URL
	const path = fileUrl.replace(`${CDN_BASE_URL}/`, '');
	const deleteUrl = `${STORAGE_BASE_URL}/${path}`;

	const response = await fetch(deleteUrl, {
		method: 'DELETE',
		headers: {
			AccessKey: BUNNY_ACCESS_KEY
		}
	});

	if (!response.ok && response.status !== 404) {
		const text = await response.text();
		throw new Error(`Bunny CDN delete failed: ${response.status} - ${text}`);
	}
}
