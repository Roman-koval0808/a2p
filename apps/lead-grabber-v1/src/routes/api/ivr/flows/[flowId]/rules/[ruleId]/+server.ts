import { prisma } from '$lib/db';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

async function getRuleOr404(flowId: string, ruleId: string, companyId: string) {
	const rule = await prisma.callFlowRule.findFirst({
		where: { id: ruleId, callFlowId: flowId },
		include: { callFlow: true }
	});
	if (!rule || rule.callFlow.companyId !== companyId) return null;
	return rule;
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const rule = await getRuleOr404(params.flowId, params.ruleId, locals.user.company.id);
	if (!rule) return json({ error: 'Not found' }, { status: 404 });
	return json({ rule });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const rule = await getRuleOr404(params.flowId, params.ruleId, locals.user.company.id);
	if (!rule) return json({ error: 'Not found' }, { status: 404 });
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
	const updated = await prisma.callFlowRule.update({
		where: { id: params.ruleId },
		data: {
			...(ruleTitle !== undefined && { ruleTitle: String(ruleTitle).trim() }),
			...(schedule !== undefined && { schedule }),
			...(promptsAudioUrl !== undefined && { promptsAudioUrl: promptsAudioUrl || null }),
			...(keyPrompts !== undefined && {
				keyPrompts: Array.isArray(keyPrompts) ? keyPrompts : rule.keyPrompts
			}),
			...(failoverCount !== undefined && { failoverCount: Number(failoverCount) }),
			...(failoverDelayMinutes !== undefined && {
				failoverDelayMinutes: Number(failoverDelayMinutes)
			}),
			...(failoverAudioUrl !== undefined && { failoverAudioUrl: failoverAudioUrl || null }),
			...(hangupAudioUrl !== undefined && { hangupAudioUrl: hangupAudioUrl || null }),
			...(leaveMessageOnHash !== undefined && { leaveMessageOnHash: Boolean(leaveMessageOnHash) }),
			...(backDigit !== undefined && {
				backDigit: backDigit === '' || backDigit == null ? null : String(backDigit).trim()
			})
		}
	});
	return json({ rule: updated });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const rule = await getRuleOr404(params.flowId, params.ruleId, locals.user.company.id);
	if (!rule) return json({ error: 'Not found' }, { status: 404 });
	await prisma.callFlowRule.delete({ where: { id: params.ruleId } });
	return json({ ok: true });
};
