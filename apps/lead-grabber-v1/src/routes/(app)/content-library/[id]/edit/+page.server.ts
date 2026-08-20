import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { join } from 'path';
import { prisma } from '$lib/db';
import { resolveCompanyId, getContentById, getCompanyReps } from '$lib/server/viewroom';

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

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) {
		throw error(401, 'Unauthorized');
	}
	const companyId = resolveCompanyId(locals.user);
	try {
		const content = await getContentById(params.id);
		const representatives = companyId ? await getCompanyReps(companyId) : [];
		return {
			user: locals.user,
			content,
			representatives
		};
	} catch (err) {
		console.error('Error fetching content:', err);
		throw error(404, 'Content not found');
	}
};

export const actions: Actions = {
	updateContent: async ({ request, locals, params }) => {
		if (!locals.user) {
			throw error(401, 'Unauthorized');
		}
		const companyId = resolveCompanyId(locals.user);
		const formData = await request.formData();
		try {
			const type = formData.get('type') as string;
			const title = formData.get('title') as string;
			const description = formData.get('description') as string;
			const libraryType = formData.get('library_type') as string;
			const fileRef = formData.get('file_ref') as string;

			const existing = await prisma.contentLibraryItem.findUnique({ where: { id: params.id } });
			if (!existing || existing.ownerCompanyId !== companyId) {
				throw error(404, 'Content not found');
			}

			const contentData: Record<string, any> = {
				title,
				description,
				type,
				libraryType: libraryType === 'both' ? ['host', 'representative'] : [libraryType],
				active: formData.get('active') === 'true'
			};

			if (fileRef) {
				let file: File | null = null;
				try {
					const tempPath = join('/tmp/upload', fileRef);
					try {
						const { readFile } = await import('node:fs/promises');
						const { existsSync } = await import('node:fs');
						if (existsSync(tempPath)) {
							const buffer = await readFile(tempPath);
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

				const { uploadToBunny } = await import('$lib/server/bunny');
				const buffer = Buffer.from(await file.arrayBuffer());
				contentData.file = await uploadToBunny(buffer, file.name, '');
			}

			const thumbnail = formData.get('thumbnail') as File | null;
			if (thumbnail?.size > 0) {
				const { uploadToBunny } = await import('$lib/server/bunny');
				const buffer = Buffer.from(await thumbnail.arrayBuffer());
				contentData.thumbnail = await uploadToBunny(buffer, thumbnail.name, '');
			}

			await prisma.contentLibraryItem.update({ where: { id: params.id }, data: contentData });

			return { type: 'success' };
		} catch (err) {
			console.error('Error updating content:', err);
			return fail(400, { type: 'error', message: 'Failed to update content' });
		}
	},

	deleteContent: async ({ locals, params }) => {
		if (!locals.user) {
			throw error(401, 'Unauthorized');
		}
		const companyId = resolveCompanyId(locals.user);
		try {
			const content = await prisma.contentLibraryItem.findUnique({ where: { id: params.id } });
			if (!content || content.ownerCompanyId !== companyId) {
				throw error(404, 'Content not found');
			}

			try {
				const { deleteFromBunny } = await import('$lib/server/bunny');
				if (content.file && content.file.includes('.b-cdn.net')) await deleteFromBunny(content.file).catch(() => {});
				if (content.thumbnail && content.thumbnail.includes('.b-cdn.net')) await deleteFromBunny(content.thumbnail).catch(() => {});
			} catch (e) {
				console.warn('bunny cleanup failed', e);
			}

			await prisma.contentLibraryItem.delete({ where: { id: params.id } });

			return { type: 'success' };
		} catch (err) {
			console.error('Error deleting content:', err);
			return fail(400, { type: 'error', message: 'Failed to delete content' });
		}
	}
};