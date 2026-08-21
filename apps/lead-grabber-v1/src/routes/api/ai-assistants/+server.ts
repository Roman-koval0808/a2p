import { json, type RequestHandler } from '@sveltejs/kit';
import { prisma } from '$lib/db';
import { resolveCompanyId } from '$lib/server/viewroom';
import { storeTrainingFile } from '$lib/server/ai-assistants';

/** List the company's assistants. */
export const GET: RequestHandler = async ({ locals }) => {
	const companyId = locals.user ? resolveCompanyId(locals.user) : null;
	if (!companyId) return json({ success: false, message: 'Unauthorized' }, { status: 401 });

	const assistants = await prisma.aiAssistant.findMany({
		where: { companyId },
		orderBy: { created: 'desc' }
	});
	return json({ success: true, assistants });
};

/** Create an assistant, optionally with training files uploaded in the same request. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const companyId = locals.user ? resolveCompanyId(locals.user) : null;
	if (!companyId) return json({ success: false, message: 'Unauthorized' }, { status: 401 });

	try {
		const formData = await request.formData();

		const name = (formData.get('name') as string)?.trim();
		if (!name) {
			return json({ success: false, message: 'Name is required' }, { status: 400 });
		}

		const viewroomIds = [
			...new Set(
				formData
					.getAll('viewrooom_connections')
					.filter((v): v is string => typeof v === 'string' && v.length > 0)
			)
		];

		const trainingFileList = formData
			.getAll('training_files')
			.filter((v): v is File => v instanceof File && v.size > 0);

		// A file that fails to upload is skipped, not fatal — the assistant is still worth creating
		// and the file can be added again from the detail page.
		const trainingFileIds: string[] = [];
		for (const file of trainingFileList) {
			const id = await storeTrainingFile(file, companyId);
			if (id) trainingFileIds.push(id);
		}

		const systemPrompt = (formData.get('system_prompt') as string)?.trim() || null;

		const assistant = await prisma.aiAssistant.create({
			data: {
				companyId,
				name,
				systemPrompt,
				viewroomConnections: viewroomIds,
				trainingFiles: trainingFileIds,
				status: true
			}
		});

		return json({ success: true, assistant });
	} catch (err) {
		console.error('Error creating AI assistant:', err);
		return json(
			{
				success: false,
				message: err instanceof Error ? err.message : 'Failed to create AI assistant'
			},
			{ status: 500 }
		);
	}
};
