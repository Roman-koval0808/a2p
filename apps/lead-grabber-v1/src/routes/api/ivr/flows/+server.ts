import { prisma } from '$lib/db';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	try {
		const flows = await prisma.callFlow.findMany({
			where: { companyId: locals.user.company.id },
			include: { rules: true },
			orderBy: { updated: 'desc' }
		});
		return json({ flows });
	} catch (e) {
		console.error('IVR flows list:', e);
		return json({ error: 'Failed to list flows' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	try {
		const body = await request.json();
		const {
			title,
			greetingAudioUrl,
			queueHoldAudioUrl,
			allUnavailableAudioUrl,
			backupCellAudioUrl,
			failoverConfig
		} = body;
		if (!title || typeof title !== 'string') {
			return json({ error: 'title is required' }, { status: 400 });
		}
		const flow = await prisma.callFlow.create({
			data: {
				companyId: locals.user.company.id,
				title: title.trim(),
				greetingAudioUrl: greetingAudioUrl ?? null,
				queueHoldAudioUrl: queueHoldAudioUrl ?? null,
				allUnavailableAudioUrl: allUnavailableAudioUrl ?? null,
				backupCellAudioUrl: backupCellAudioUrl ?? null,
				failoverConfig: failoverConfig ?? undefined
			}
		});
		return json({ flow });
	} catch (e) {
		console.error('IVR flow create:', e);
		return json({ error: 'Failed to create flow' }, { status: 500 });
	}
};
