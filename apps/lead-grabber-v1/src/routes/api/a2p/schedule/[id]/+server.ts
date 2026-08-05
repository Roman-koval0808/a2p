import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';

/**
 * PATCH /api/a2p/schedule/[id] — cancel or reschedule a schedule row.
 *
 * This is OUR plan, not the customer's words: cancelling or moving it never
 * touches the CRM note (spec §10 — the two records can never be merged).
 * Body: { status: 'CANCELLED' } or { dueAt, expiresAt? }.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const companyId = locals.user?.company?.id;
	if (!companyId) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const existing = await prisma.scheduledIntent.findFirst({
			where: { id: params.id, clientId: companyId },
			select: { id: true, status: true }
		});
		if (!existing) return json({ error: 'Not found' }, { status: 404 });

		const body = (await request.json().catch(() => ({}))) as {
			status?: string;
			dueAt?: string;
			expiresAt?: string | null;
		};

		if (body.status === 'CANCELLED') {
			const updated = await prisma.scheduledIntent.update({
				where: { id: existing.id },
				data: { status: 'CANCELLED' },
				select: { id: true, status: true }
			});
			return json({ ok: true, ...updated });
		}

		if (body.dueAt) {
			const dueAt = new Date(body.dueAt);
			if (isNaN(dueAt.getTime())) {
				return json({ error: 'dueAt must be a valid ISO date' }, { status: 400 });
			}
			const data: { dueAt: Date; expiresAt?: Date | null } = { dueAt };
			if (body.expiresAt) {
				const expiresAt = new Date(body.expiresAt);
				if (isNaN(expiresAt.getTime())) {
					return json({ error: 'expiresAt must be a valid ISO date' }, { status: 400 });
				}
				data.expiresAt = expiresAt;
			}
			const updated = await prisma.scheduledIntent.update({
				where: { id: existing.id },
				data,
				select: { id: true, status: true, dueAt: true, expiresAt: true }
			});
			return json({ ok: true, ...updated });
		}

		return json({ error: "Expected { status: 'CANCELLED' } or { dueAt }" }, { status: 400 });
	} catch (err) {
		console.error('A2P schedule update error:', err);
		return json({ error: err instanceof Error ? err.message : 'Update failed' }, { status: 500 });
	}
};
