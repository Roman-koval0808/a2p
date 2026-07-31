import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuth, unauthorized } from '$lib/api/spec';
import { listMergeCandidates } from '$lib/server/identity/merge-service';

/** Pending duplicate-profile pairs awaiting a human decision. */
export const GET: RequestHandler = async ({ locals, url }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const status = url.searchParams.get('status') || 'pending';
	try {
		const candidates = await listMergeCandidates(auth.companyId, status);
		return json({ success: true, data: candidates });
	} catch (err: any) {
		console.error('[merge-candidates] List failed:', err);
		return json({ success: false, error: err?.message || 'Internal error' }, { status: 500 });
	}
};
