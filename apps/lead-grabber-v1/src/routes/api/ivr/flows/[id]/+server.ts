import { prisma } from '$lib/db';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

async function getFlowOr404(flowId: string, companyId: string) {
	const flow = await prisma.callFlow.findFirst({
		where: { id: flowId, companyId },
		include: { rules: true }
	});
	return flow;
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const flow = await getFlowOr404(params.id, locals.user.company.id);
	if (!flow) return json({ error: 'Not found' }, { status: 404 });
	return json({ flow });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const flow = await getFlowOr404(params.id, locals.user.company.id);
	if (!flow) return json({ error: 'Not found' }, { status: 404 });
	const body = await request.json();
	const {
		title,
		greetingAudioUrl,
		queueHoldAudioUrl,
		allUnavailableAudioUrl,
		backupCellAudioUrl,
		failoverConfig
	} = body;
	const updated = await prisma.callFlow.update({
		where: { id: params.id },
		data: {
			...(title !== undefined && { title: String(title).trim() }),
			...(greetingAudioUrl !== undefined && { greetingAudioUrl: greetingAudioUrl || null }),
			...(queueHoldAudioUrl !== undefined && { queueHoldAudioUrl: queueHoldAudioUrl || null }),
			...(allUnavailableAudioUrl !== undefined && {
				allUnavailableAudioUrl: allUnavailableAudioUrl || null
			}),
			...(backupCellAudioUrl !== undefined && { backupCellAudioUrl: backupCellAudioUrl || null }),
			...(failoverConfig !== undefined && { failoverConfig })
		}
	});
	return json({ flow: updated });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const flow = await getFlowOr404(params.id, locals.user.company.id);
	if (!flow) return json({ error: 'Not found' }, { status: 404 });
	await prisma.callFlow.delete({ where: { id: params.id } });
	return json({ ok: true });
};
