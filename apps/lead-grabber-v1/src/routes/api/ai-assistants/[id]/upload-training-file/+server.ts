import { json, type RequestHandler } from '@sveltejs/kit';
import { prisma } from '$lib/db';
import { resolveCompanyId } from '$lib/server/viewroom';
import { getAssistantForCompany, storeTrainingFile } from '$lib/server/ai-assistants';

/** Add one file to an assistant's knowledge base. */
export const POST: RequestHandler = async ({ request, params, locals }) => {
	const companyId = locals.user ? resolveCompanyId(locals.user) : null;
	if (!companyId) return json({ success: false, message: 'Unauthorized' }, { status: 401 });

	const formData = await request.formData();
	const file = formData.get('file');
	if (!(file instanceof File) || file.size === 0) {
		return json({ success: false, message: 'No file provided' }, { status: 400 });
	}

	try {
		// Check the assistant BEFORE uploading, so a bad id cannot leave an orphaned file on the CDN
		// and an orphaned content-library row behind it.
		const assistant = await getAssistantForCompany(params.id as string, companyId);
		if (!assistant) {
			return json({ success: false, message: 'Assistant not found' }, { status: 404 });
		}

		const fileId = await storeTrainingFile(file, companyId);
		if (!fileId) throw new Error('File upload failed');

		await prisma.aiAssistant.update({
			where: { id: assistant.id },
			data: { trainingFiles: [...assistant.trainingFiles, fileId] }
		});

		const created = await prisma.contentLibraryItem.findUnique({
			where: { id: fileId },
			select: { id: true, title: true, type: true, file: true, created: true }
		});

		return json({ success: true, file: created });
	} catch (err) {
		console.error('Error uploading training file:', err);
		return json({ success: false, message: 'Failed to upload training file' }, { status: 500 });
	}
};
