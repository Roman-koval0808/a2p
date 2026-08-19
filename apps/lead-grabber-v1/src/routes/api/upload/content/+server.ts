import { json, type RequestHandler } from '@sveltejs/kit';
import { join } from 'path';
import { prisma } from '$lib/db';
import { resolveCompanyId } from '$lib/server/viewroom';

function getContentType(filename: string): string {
	const ext = filename.split('.').pop()?.toLowerCase();
	switch (ext) {
		case 'pdf': return 'application/pdf';
		case 'doc':
		case 'docx': return 'application/msword';
		case 'xls':
		case 'xlsx': return 'application/vnd.ms-excel';
		case 'mp4': return 'video/mp4';
		case 'webm': return 'video/webm';
		case 'mov': return 'video/quicktime';
		case 'jpg':
		case 'jpeg': return 'image/jpeg';
		case 'png': return 'image/png';
		default: return 'application/octet-stream';
	}
}

async function uploadToBunnyCDN(file: File): Promise<string> {
	const { uploadToBunny } = await import('$lib/server/bunny');
	const buffer = Buffer.from(await file.arrayBuffer());
	return uploadToBunny(buffer, file.name, '');
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ success: false, message: 'Unauthorized' }, { status: 401 });
	}

	const companyId = resolveCompanyId(locals.user);
	if (!companyId) {
		return json({ success: false, message: 'Unauthorized' }, { status: 401 });
	}

	const formData = await request.formData();

	try {
		const type = formData.get('type') as string;
		const title = formData.get('title') as string;
		const description = formData.get('description') as string;
		const fileRef = formData.get('file_ref') as string;
		const libraryType = formData.get('library_type') as string;
		const representatives = formData.get('representatives') as string;
		const thumbnail = formData.get('thumbnail') as File | null;
		const repIds = representatives ? representatives.split(',') : [];

		if (!title || !type || !libraryType) {
			return json({ success: false, type: 'error', message: 'Missing required fields' }, { status: 400 });
		}

		let file: File | null = null;
		if (fileRef) {
			try {
				const tempPath = join('/tmp/upload', fileRef);
				try {
					const { readFile: fsReadFile } = await import('node:fs/promises');
					const { existsSync: fsExistsSync } = await import('node:fs');
					if (fsExistsSync(tempPath)) {
						const buffer = await fsReadFile(tempPath);
						const originalFilename = fileRef.split('-').slice(1).join('-');
						const contentType = getContentType(originalFilename);
						file = new File([buffer], originalFilename, { type: contentType });
					}
				} catch {}
				if (!file) {
					const chunkFormData = new FormData();
					chunkFormData.append('filename', fileRef);
					const requestUrl = new URL(request.url);
					const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
					const fileResponse = await fetch(`${baseUrl}/api/combine-chunks`, { method: 'POST', body: chunkFormData });
					if (!fileResponse.ok) throw new Error('Failed to get file from chunks');
					const responseFormData = await fileResponse.formData();
					file = responseFormData.get('file') as File;
					if (!file) throw new Error('No file returned from combine-chunks endpoint');
				}
			} catch (error) {
				console.error('Error getting file from chunks:', error);
				throw error;
			}
		}

		let fileBunnyCdnUrl: string | null = null;
		if (file) {
			try {
				fileBunnyCdnUrl = await uploadToBunnyCDN(file);
			} catch (error) {
				console.error('Bunny CDN upload failed:', error);
				throw error;
			}
		}

		let thumbnailUrl: string | null = null;
		if (thumbnail && thumbnail.size > 0) {
			try {
				thumbnailUrl = await uploadToBunnyCDN(thumbnail);
			} catch (error) {
				console.error('Bunny CDN thumbnail upload failed:', error);
			}
		}

		if (!fileBunnyCdnUrl) {
			return json({ success: false, type: 'error', message: 'File upload failed' }, { status: 400 });
		}

		const libraryTypes: string[] = libraryType === 'both' ? ['host', 'representative'] : [libraryType];

		await prisma.contentLibraryItem.create({
			data: {
				title,
				description: description ?? null,
				type,
				file: fileBunnyCdnUrl,
				thumbnail: thumbnailUrl,
				ownerCompanyId: companyId,
				libraryType: libraryTypes,
				active: formData.get('active') === 'true',
				sharedWith: repIds
			}
		});

		return json({ success: true, type: 'success' });
	} catch (err) {
		console.error('Error uploading content:', err);
		return json({ success: false, type: 'error', message: 'Failed to upload content' }, { status: 400 });
	}
};