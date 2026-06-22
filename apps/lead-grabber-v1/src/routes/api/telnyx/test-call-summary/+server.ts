import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || !locals.user.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const { threadId, duration = 127, estimated_price, summary } = await request.json();

		if (!threadId) {
			return json({ error: 'threadId is required' }, { status: 400 });
		}

		const thread = await prisma.message.findFirst({
			where: {
				threadId,
				companyId: locals.user.company.id
			}
		});

		if (!thread) {
			return json({ error: 'Thread not found' }, { status: 404 });
		}

		const existingMsgs = Array.isArray(thread.messages)
			? thread.messages
			: typeof thread.messages === 'string'
				? JSON.parse(thread.messages as string)
				: [];

		const callSummaryEntry = {
			type: 'call_summary',
			content: `Call completed (${duration}s)`,
			timestamp: new Date().toISOString(),
			is_agent_reply: false,
			is_system: true,
			call_data: {
				direction: 'outbound',
				duration,
				...(estimated_price != null && { estimated_price }),
				...(summary && { summary }),
				call_control_id: `sim_${Date.now()}`
			}
		};

		await prisma.message.update({
			where: { id: thread.id },
			data: { messages: [...existingMsgs, callSummaryEntry] }
		});

		return json({ success: true });
	} catch (err: any) {
		console.error('[test-call-summary]', err);
		return json({ error: err.message || 'Failed' }, { status: 500 });
	}
};
