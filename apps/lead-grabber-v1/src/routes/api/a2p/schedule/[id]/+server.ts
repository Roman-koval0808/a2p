import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';

/**
 * Valid ScheduledIntent statuses from the schema enum.
 */
const SCHEDULE_INTENTS_STATUSES = ['PENDING', 'DONE', 'SKIPPED', 'CANCELLED', 'EXPIRED'] as const;

type ScheduledIntentStatus = (typeof SCHEDULE_INTENTS_STATUSES)[number];

/**
 * PATCH /api/a2p/schedule/[id] — edit a schedule row (status, dueAt, expiresAt).
 *
 * This is OUR plan, not the customer's words: cancelling or moving it never
 * touches the CRM note (spec §10 — the two records can never be merged).
 * Body: { status?: ScheduledIntentStatus, dueAt?: ISO, expiresAt?: ISO | null }.
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

		const data: { status?: ScheduledIntentStatus; dueAt?: Date; expiresAt?: Date | null } = {};

		if (body.status !== undefined && body.status !== '') {
			if (!SCHEDULE_INTENTS_STATUSES.includes(body.status as ScheduledIntentStatus)) {
				return json({ error: `Invalid status. Must be one of ${SCHEDULE_INTENTS_STATUSES.join(', ')}` }, { status: 400 });
			}
			data.status = body.status as ScheduledIntentStatus;
		}

		if (body.dueAt) {
			const dueAt = new Date(body.dueAt);
			if (isNaN(dueAt.getTime())) {
				return json({ error: 'dueAt must be a valid ISO date' }, { status: 400 });
			}
			data.dueAt = dueAt;
		}

		if (body.expiresAt !== undefined) {
			if (body.expiresAt === null || body.expiresAt === '') {
				data.expiresAt = null;
			} else {
				const expiresAt = new Date(body.expiresAt);
				if (isNaN(expiresAt.getTime())) {
					return json({ error: 'expiresAt must be a valid ISO date or null' }, { status: 400 });
				}
				data.expiresAt = expiresAt;
			}
		}

		if (Object.keys(data).length === 0) {
			return json({ error: "Expected { status, dueAt, expiresAt } with at least one field" }, { status: 400 });
		}

		const updated = await prisma.scheduledIntent.update({
			where: { id: existing.id },
			data,
			select: { id: true, status: true, dueAt: true, expiresAt: true, intentType: true, actor: true, payload: true }
		});
		return json({ ok: true, ...updated });
	} catch (err) {
		console.error('A2P schedule update error:', err);
		return json({ error: err instanceof Error ? err.message : 'Update failed' }, { status: 500 });
	}
};
