import { json, type RequestHandler } from '@sveltejs/kit';
import { prisma } from '$lib/db';
import { resolveCompanyId } from '$lib/server/viewroom';
import { getAssistantForCompany, getTrainingFiles, storeTrainingFile } from '$lib/server/ai-assistants';

/** The assistant plus its knowledge-base files, resolved from the content library. */
export const GET: RequestHandler = async ({ locals, params }) => {
	const companyId = locals.user ? resolveCompanyId(locals.user) : null;
	if (!companyId) return json({ success: false, message: 'Unauthorized' }, { status: 401 });

	const assistant = await getAssistantForCompany(params.id as string, companyId);
	if (!assistant) return json({ success: false, message: 'Not found' }, { status: 404 });

	const files = await getTrainingFiles(assistant.trainingFiles, companyId);
	return json({ success: true, assistant, files });
};

export const PUT: RequestHandler = async ({ request, locals, params }) => {
	const companyId = locals.user ? resolveCompanyId(locals.user) : null;
	if (!companyId) return json({ success: false, message: 'Unauthorized' }, { status: 401 });

	try {
		const existing = await getAssistantForCompany(params.id as string, companyId);
		if (!existing) return json({ success: false, message: 'Not found' }, { status: 404 });

		const formData = await request.formData();

		// Explicit allowlist. The viewroom version spread every form key straight onto the record,
		// which let a caller write arbitrary columns — including the tenant.
		const data: Record<string, unknown> = {};

		const name = (formData.get('name') as string)?.trim();
		if (name) data.name = name;

		if (formData.has('system_prompt')) {
			data.systemPrompt = (formData.get('system_prompt') as string)?.trim() || null;
		}

		if (formData.has('status')) {
			const raw = formData.get('status');
			data.status = raw === 'true' || raw === '1' || raw === 'on';
		}

		if (formData.has('viewrooom_connections')) {
			data.viewroomConnections = [
				...new Set(
					formData
						.getAll('viewrooom_connections')
						.filter((v): v is string => typeof v === 'string' && v.length > 0)
				)
			];
		}

		// New uploads are APPENDED to the existing knowledge base. The viewroom version wrote raw
		// File objects into the column here, which could never round-trip — files have to be
		// uploaded and recorded in the content library first, same as on create.
		const incoming = formData
			.getAll('training_files')
			.filter((v): v is File => v instanceof File && v.size > 0);
		if (incoming.length) {
			const added: string[] = [];
			for (const file of incoming) {
				const id = await storeTrainingFile(file, companyId);
				if (id) added.push(id);
			}
			if (added.length) data.trainingFiles = [...existing.trainingFiles, ...added];
		}

		const assistant = await prisma.aiAssistant.update({
			where: { id: existing.id },
			data
		});

		return json({ success: true, assistant });
	} catch (error) {
		console.error('Error updating AI assistant:', error);
		return json({ success: false, message: 'Failed to update AI assistant' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const companyId = locals.user ? resolveCompanyId(locals.user) : null;
	if (!companyId) return json({ success: false, message: 'Unauthorized' }, { status: 401 });

	try {
		// Scoped delete: deleteMany with the company in the WHERE cannot remove another tenant's
		// assistant even if the id is guessed.
		const { count } = await prisma.aiAssistant.deleteMany({
			where: { id: params.id as string, companyId }
		});
		if (!count) return json({ success: false, message: 'Not found' }, { status: 404 });

		return json({ success: true, message: 'AI assistant deleted successfully' });
	} catch (error) {
		console.error('Error deleting AI assistant:', error);
		return json({ success: false, message: 'Failed to delete AI assistant' }, { status: 500 });
	}
};
