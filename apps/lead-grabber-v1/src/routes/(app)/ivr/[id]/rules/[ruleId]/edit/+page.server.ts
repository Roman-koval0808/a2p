import { prisma } from '$lib/db';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user?.company) throw redirect(302, '/login');
	const rule = await prisma.callFlowRule.findFirst({
		where: { id: params.ruleId, callFlowId: params.id },
		include: { callFlow: true }
	});
	if (!rule || rule.callFlow.companyId !== locals.user.company.id) throw redirect(302, '/ivr');
	return { flow: rule.callFlow, rule, flowId: params.id, ruleId: params.ruleId };
};
