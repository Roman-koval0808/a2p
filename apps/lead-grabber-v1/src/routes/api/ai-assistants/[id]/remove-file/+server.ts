import { json, type RequestHandler } from '@sveltejs/kit';
import { prisma } from '$lib/db';
import { resolveCompanyId } from '$lib/server/viewroom';
import { getAssistantForCompany } from '$lib/server/ai-assistants';

/**
 * Detach a file from an assistant's knowledge base.
 *
 * Prefers `fileId`. `fileIndex` is accepted only for compatibility with the ported UI: removing by
 * position is racy — two tabs removing different files both send an index computed against a list
 * that has since shifted, and the wrong file is dropped.
 *
 * The content-library row and the CDN object are intentionally left alone. The file may be shared
 * with another assistant, and deleting a library item to satisfy a detach is the kind of
 * destructive shortcut that loses data.
 */
export const POST: RequestHandler = async ({ request, locals, params }) => {
	const companyId = locals.user ? resolveCompanyId(locals.user) : null;
	if (!companyId) return json({ success: false, message: 'Unauthorized' }, { status: 401 });

	try {
		const assistant = await getAssistantForCompany(params.id as string, companyId);
		if (!assistant) {
			return json({ success: false, message: 'AI assistant not found' }, { status: 404 });
		}

		const formData = await request.formData();
		const fileId = (formData.get('fileId') as string)?.trim();
		const rawIndex = formData.get('fileIndex');

		let next: string[];
		if (fileId) {
			if (!assistant.trainingFiles.includes(fileId)) {
				return json({ success: false, message: 'File is not attached' }, { status: 400 });
			}
			next = assistant.trainingFiles.filter((id) => id !== fileId);
		} else {
			const index = parseInt(rawIndex as string, 10);
			if (isNaN(index) || index < 0 || index >= assistant.trainingFiles.length) {
				return json({ success: false, message: 'Invalid file index' }, { status: 400 });
			}
			next = assistant.trainingFiles.filter((_, i) => i !== index);
		}

		await prisma.aiAssistant.update({
			where: { id: assistant.id },
			data: { trainingFiles: next }
		});

		return json({ success: true, message: 'File removed successfully' });
	} catch (error) {
		console.error('Error removing file:', error);
		return json({ success: false, message: 'Failed to remove file' }, { status: 500 });
	}
};
