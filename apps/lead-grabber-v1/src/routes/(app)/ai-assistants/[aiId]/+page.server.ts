import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { prisma } from '$lib/db';
import { resolveCompanyId } from '$lib/server/viewroom';
import { getAssistantForCompany, getTrainingFiles, getAllTrainingFilesForCompany, storeTrainingFile } from '$lib/server/ai-assistants';

/**
 * AI assistant detail, ported from the standalone viewroom app.
 *
 * The actions here go through `$lib/server/ai-assistants` rather than repeating the upload and
 * detach logic that `/api/ai-assistants/[id]/...` already implements — the viewroom had two
 * divergent copies of it, and the form-action copy pushed raw File objects into the training-files
 * column, which could never round-trip.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	const companyId = resolveCompanyId(locals.user);
	if (!companyId) throw redirect(303, '/create-company');

	const aiId = params.aiId;
	if (!aiId) throw error(404, 'AI Assistant not found');

	const aiAssistant = await getAssistantForCompany(aiId, companyId);
	if (!aiAssistant) throw error(404, 'AI Assistant not found');

	// Resolve training file ids to content-library rows, preserving the assistant's own ordering.
	const records = await getTrainingFiles(aiAssistant.trainingFiles, companyId);
	const byId = new Map(records.map((r) => [r.id, r]));
	const trainingFilesResolved = aiAssistant.trainingFiles
		.map((id) => byId.get(id))
		.filter((r): r is NonNullable<typeof r> => !!r);

	const viewrooms = await prisma.viewRoom.findMany({
		where: { ownerCompanyId: companyId },
		select: { id: true, title: true },
		orderBy: { title: 'asc' }
	});

	const viewroomMap: Record<string, string> = {};
	for (const room of viewrooms) viewroomMap[room.id] = room.title;

	const allTrainingFiles = await getAllTrainingFilesForCompany(companyId);

	return { aiAssistant, trainingFilesResolved, allTrainingFiles, viewrooms, viewroomMap };
};

export const actions: Actions = {
	uploadFiles: async ({ request, locals }) => {
		const companyId = locals.user ? resolveCompanyId(locals.user) : null;
		if (!companyId) return fail(401, { success: false, message: 'Unauthorized' });

		try {
			const formData = await request.formData();
			const id = formData.get('id')?.toString();
			if (!id) return fail(400, { success: false, message: 'AI assistant ID is required' });

			const assistant = await getAssistantForCompany(id, companyId);
			if (!assistant) return fail(404, { success: false, message: 'AI assistant not found' });

			const files = formData
				.getAll('trainingFiles')
				.filter((f): f is File => f instanceof File && f.size > 0);
			if (!files.length) return fail(400, { success: false, message: 'No files provided' });

			const added: string[] = [];
			for (const file of files) {
				const fileId = await storeTrainingFile(file, companyId);
				if (fileId) added.push(fileId);
			}
			if (!added.length) {
				return fail(500, { success: false, message: 'Files could not be uploaded' });
			}

			await prisma.aiAssistant.update({
				where: { id: assistant.id },
				data: { trainingFiles: [...assistant.trainingFiles, ...added] }
			});

			return { success: true, message: 'Files uploaded successfully' };
		} catch (err) {
			console.error('Error uploading files:', err);
			return fail(400, {
				success: false,
				message: err instanceof Error ? err.message : 'Failed to upload files'
			});
		}
	},

	/**
	 * Save the viewroom picker. The form posts one hidden `viewroomConnections` input per selected
	 * room, so an empty selection posts none — which is a real "disconnect everything", not a
	 * no-op, and is stored as such.
	 */
	updateViewrooms: async ({ request, locals }) => {
		const companyId = locals.user ? resolveCompanyId(locals.user) : null;
		if (!companyId) return fail(401, { success: false, message: 'Unauthorized' });

		try {
			const formData = await request.formData();
			const id = formData.get('id')?.toString();
			if (!id) return fail(400, { success: false, message: 'AI assistant ID is required' });

			const assistant = await getAssistantForCompany(id, companyId);
			if (!assistant) return fail(404, { success: false, message: 'AI assistant not found' });

			const submitted = [
				...new Set(
					formData
						.getAll('viewroomConnections')
						.filter((v): v is string => typeof v === 'string' && v.length > 0)
				)
			];

			// Only rooms this company owns. The ids come from a form, so a crafted post could
			// otherwise attach an assistant to another tenant's room.
			const owned = await prisma.viewRoom.findMany({
				where: { id: { in: submitted }, ownerCompanyId: companyId },
				select: { id: true }
			});
			const viewroomConnections = owned.map((r) => r.id);

			await prisma.aiAssistant.update({
				where: { id: assistant.id },
				data: { viewroomConnections }
			});

			return { success: true, message: 'ViewRoom connections updated successfully' };
		} catch (err) {
			console.error('Error updating viewroom connections:', err);
			return fail(400, {
				success: false,
				message: err instanceof Error ? err.message : 'Failed to update connections'
			});
		}
	},

	removeFile: async ({ request, locals }) => {
		const companyId = locals.user ? resolveCompanyId(locals.user) : null;
		if (!companyId) return fail(401, { success: false, message: 'Unauthorized' });

		try {
			const formData = await request.formData();
			const id = formData.get('id')?.toString();
			const fileId = formData.get('fileId')?.toString();
			const rawIndex = formData.get('fileIndex');
			if (!id) return fail(400, { success: false, message: 'AI assistant ID is required' });

			const assistant = await getAssistantForCompany(id, companyId);
			if (!assistant) return fail(404, { success: false, message: 'AI assistant not found' });

			// Prefer the id; index is positional and goes wrong the moment the list shifts.
			let next: string[];
			if (fileId) {
				if (!assistant.trainingFiles.includes(fileId)) {
					return fail(400, { success: false, message: 'File is not attached' });
				}
				next = assistant.trainingFiles.filter((f) => f !== fileId);
			} else {
				const index = parseInt(rawIndex as string, 10);
				if (isNaN(index) || index < 0 || index >= assistant.trainingFiles.length) {
					return fail(400, { success: false, message: 'Invalid file index' });
				}
				next = assistant.trainingFiles.filter((_, i) => i !== index);
			}

			await prisma.aiAssistant.update({
				where: { id: assistant.id },
				data: { trainingFiles: next }
			});

			return { success: true, message: 'File removed successfully' };
		} catch (err) {
			console.error('Error removing file:', err);
			return fail(400, {
				success: false,
				message: err instanceof Error ? err.message : 'Failed to remove file'
			});
		}
	},

	deleteFile: async ({ request, locals }) => {
		const companyId = locals.user ? resolveCompanyId(locals.user) : null;
		if (!companyId) return fail(401, { success: false, message: 'Unauthorized' });

		try {
			const formData = await request.formData();
			const fileId = formData.get('fileId')?.toString();
			if (!fileId) return fail(400, { success: false, message: 'File ID is required' });

			// Delete from the content library
			await prisma.contentLibraryItem.deleteMany({
				where: { id: fileId, ownerCompanyId: companyId }
			});

			// Cleanup the file ID from any assistants that had it attached
			const assistants = await prisma.aiAssistant.findMany({
				where: { companyId }
			});
			for (const assistant of assistants) {
				if (assistant.trainingFiles.includes(fileId)) {
					await prisma.aiAssistant.update({
						where: { id: assistant.id },
						data: {
							trainingFiles: assistant.trainingFiles.filter(id => id !== fileId)
						}
					});
				}
			}

			return { success: true, message: 'File deleted completely' };
		} catch (err) {
			console.error('Error deleting file:', err);
			return fail(400, {
				success: false,
				message: err instanceof Error ? err.message : 'Failed to delete file'
			});
		}
	}
};
