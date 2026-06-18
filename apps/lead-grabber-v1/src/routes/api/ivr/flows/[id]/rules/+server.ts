import { prisma } from '$lib/db';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

async function getFlowOr404(flowId: string, companyId: string) {
	return prisma.callFlow.findFirst({
		where: { id: flowId, companyId }
	});
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const flow = await getFlowOr404(params.id, locals.user.company.id);
	if (!flow) return json({ error: 'Flow not found' }, { status: 404 });
	const rules = await prisma.callFlowRule.findMany({
		where: { callFlowId: params.id },
		orderBy: { created: 'asc' }
	});
	return json({ rules });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const flow = await getFlowOr404(params.id, locals.user.company.id);
	if (!flow) return json({ error: 'Flow not found' }, { status: 404 });
	const body = await request.json();
	const {
		ruleTitle,
		schedule,
		promptsAudioUrl,
		keyPrompts,
		failoverCount,
		failoverDelayMinutes,
		failoverAudioUrl,
		hangupAudioUrl,
		leaveMessageOnHash,
		backDigit
	} = body;
	if (!ruleTitle || typeof ruleTitle !== 'string') {
		return json({ error: 'ruleTitle is required' }, { status: 400 });
	}
	if (!schedule || typeof schedule !== 'object') {
		return json({ error: 'schedule is required (object)' }, { status: 400 });
	}
	const keyPromptsArray = Array.isArray(keyPrompts) ? keyPrompts : [];
	const rule = await prisma.callFlowRule.create({
		data: {
			callFlowId: params.id,
			ruleTitle: ruleTitle.trim(),
			schedule,
			promptsAudioUrl: promptsAudioUrl ?? null,
			keyPrompts: keyPromptsArray,
			failoverCount: typeof failoverCount === 'number' ? failoverCount : 2,
			failoverDelayMinutes: typeof failoverDelayMinutes === 'number' ? failoverDelayMinutes : 2,
			failoverAudioUrl: failoverAudioUrl ?? null,
			hangupAudioUrl: hangupAudioUrl ?? null,
			leaveMessageOnHash: leaveMessageOnHash !== false,
			backDigit: backDigit === '' || backDigit == null ? null : String(backDigit).trim()
		}
	});
	return json({ rule });
};
