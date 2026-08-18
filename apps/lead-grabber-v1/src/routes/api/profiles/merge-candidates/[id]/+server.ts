import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';
import { mergeProfiles, dismissMergeCandidate } from '$lib/server/identity/merge-service';

/**
 * Resolve one merge candidate.
 *
 * body: { action: 'merge' | 'dismiss', survivorId?: string }
 *
 * `survivorId` picks which of the two profiles is kept — the reviewer decides, since the
 * detection order says nothing about which record is the better one. Defaults to the candidate's
 * primary.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const candidateId = params.id;
	let body: { action?: string; survivorId?: string };
	try {
		body = await request.json();
	} catch {
		return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
	}

	const candidate = await prisma.profileMergeCandidate.findFirst({
		where: { id: candidateId, companyId: auth.companyId }
	});
	if (!candidate) {
		return json({ success: false, error: 'Merge candidate not found' }, { status: 404 });
	}
	if (candidate.status !== 'pending') {
		return json(
			{ success: false, error: `Candidate already ${candidate.status}` },
			{ status: 400 }
		);
	}

	try {
		if (body.action === 'dismiss') {
			const dismissed = await dismissMergeCandidate({
				companyId: auth.companyId,
				candidateId,
				userId: auth.id
			});
			return json({ success: true, data: dismissed });
		}

		if (body.action === 'merge') {
			const pair = [candidate.primaryProfileId, candidate.duplicateProfileId];
			const survivorId = body.survivorId || candidate.primaryProfileId;
			if (!pair.includes(survivorId)) {
				return json(
					{ success: false, error: 'survivorId must be one of the two candidate profiles' },
					{ status: 400 }
				);
			}
			const duplicateId = pair.find((id) => id !== survivorId)!;

			const result = await mergeProfiles({
				companyId: auth.companyId,
				survivorId,
				duplicateId,
				userId: auth.id,
				candidateId
			});
			return json({ success: true, data: result });
		}

		return json({ success: false, error: 'action must be "merge" or "dismiss"' }, { status: 400 });
	} catch (err: any) {
		console.error('[merge-candidates] Resolve failed:', err);
		return json({ success: false, error: err?.message || 'Internal error' }, { status: 500 });
	}
};
