import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { draftResponse } from '$lib/ai/openai';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = await request.json().catch(() => ({}));
		const { content, channel = 'email' } = body;

		if (!content) {
			return json({ error: 'Content is required to generate a draft' }, { status: 400 });
		}

		const draft = await draftResponse(content, [], channel);
		if (!draft) {
			return json({ error: 'Could not generate draft response from OpenAI' }, { status: 502 });
		}

		return json({ draft });
	} catch (e) {
		console.error('POST /api/notifications/draft error:', e);
		return json(
			{ error: e instanceof Error ? e.message : 'Failed to generate draft' },
			{ status: 500 }
		);
	}
};
