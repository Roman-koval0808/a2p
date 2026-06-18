import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { draftResponse } from '$lib/ai/openai';

/** Generate a draft reply for a thread (human-in-the-loop). Auth required. */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = await request.json().catch(() => ({}));
		const id = body.id ?? body.messageId;
		const channel = (body.channel as 'email' | 'sms' | 'chatbot') || 'chatbot';

		if (!id) {
			return json({ error: 'Message id is required' }, { status: 400 });
		}

		const message = await prisma.message.findUnique({
			where: { id }
		});
		if (!message || message.companyId !== locals.user.company!.id) {
			return json({ error: 'Message not found' }, { status: 404 });
		}

		const messages = (Array.isArray(message.messages) ? message.messages : []) as any[];
		const lastInbound = [...messages]
			.reverse()
			.find((m: { is_agent_reply?: boolean }) => !m?.is_agent_reply);
		const latestContent = typeof lastInbound?.content === 'string' ? lastInbound.content : '';

		const threadContext = messages.map((m: { content?: string; is_agent_reply?: boolean }) => ({
			role: m?.is_agent_reply ? 'agent' : 'customer',
			content: typeof m?.content === 'string' ? m.content : ''
		}));

		const draft = await draftResponse(latestContent, threadContext, channel);
		if (!draft) {
			return json({ error: 'Could not generate draft' }, { status: 502 });
		}

		// Optionally persist draft so it shows as "Confirm" in the log
		await prisma.message.update({
			where: { id },
			data: { draftResponse: draft }
		});

		return json({ draft });
	} catch (e) {
		console.error('POST /api/messages/draft error:', e);
		return json(
			{ error: e instanceof Error ? e.message : 'Failed to generate draft' },
			{ status: 500 }
		);
	}
};
