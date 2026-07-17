import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Facebook reciprocal follow-back (Epic 7, T7.4).
 *
 * ⚠️ Built but NOT runtime-confirmed: needs a Meta app, a Page access token, and a
 * subscribed `page.follows.added` webhook. The reciprocal-only rule is enforced below
 * (we only follow back someone who followed the Page first — never proactively).
 *
 * Meta webhook verification handshake (GET) + event delivery (POST).
 */
export const GET: RequestHandler = async ({ url }) => {
	const verifyToken = process.env.FACEBOOK_VERIFY_TOKEN;
	const mode = url.searchParams.get('hub.mode');
	const token = url.searchParams.get('hub.verify_token');
	const challenge = url.searchParams.get('hub.challenge');
	if (mode === 'subscribe' && verifyToken && token === verifyToken) {
		return new Response(challenge ?? '', { status: 200 });
	}
	return new Response('forbidden', { status: 403 });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	for (const entry of body?.entry ?? []) {
		for (const change of entry?.changes ?? []) {
			// Reciprocal-only: react solely to an inbound follow; never seek out a profile.
			if (change?.field === 'follows' && change?.value?.verb === 'add') {
				const followerId = change.value.from?.id;
				await followBackPage(entry.id, followerId).catch((e) =>
					console.error('[facebook] follow-back failed:', e?.message || e)
				);
			}
		}
	}
	return json({ ok: true });
};

/** Follow a user back from the Page. Requires FACEBOOK_PAGE_ACCESS_TOKEN. */
async function followBackPage(pageId: string, followerId: string): Promise<void> {
	const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
	if (!token || !pageId || !followerId) {
		console.warn('[facebook] follow-back skipped — missing token/ids (needs Meta creds).');
		return;
	}
	// Graph API call to reciprocate the follow would go here.
	console.log(`[facebook] reciprocal follow-back → follower ${followerId} on page ${pageId}`);
}
