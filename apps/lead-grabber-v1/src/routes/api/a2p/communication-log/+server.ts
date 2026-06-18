import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isA2pCommLogEnabled, getCommLogFromApi } from '$lib/server/a2p-client';
import { isA2pDbEnabled, queryCommEvents } from '$lib/server/a2p-db';

/** Normalize external API event to our log shape. */
function normalizeLog(e: Record<string, unknown>): Record<string, unknown> {
	const dir = (e.direction as string) ?? '';
	const channel = (e.channel as string) ?? (e.type as string) ?? '';
	const body = (e.body_text as string) ?? (e.content as string) ?? '';
	const identityValue = (e.identity_value as string) ?? (e.source as string) ?? '';
	const identityKind =
		(e.identity_kind as string) ?? (identityValue?.includes('@') ? 'email' : 'phone');
	return {
		id: String(e.id ?? ''),
		type: channel,
		direction: dir === 'in' ? 'inbound' : dir === 'out' ? 'outbound' : dir || 'inbound',
		status: 'completed',
		source: identityValue,
		destination: (e.thread_key as string) ?? (e.subject as string) ?? '',
		summary: (e.summary_gpt as string) ?? (e.subject as string) ?? body.slice(0, 80),
		content: body,
		metadata: {
			urgency_gpt: e.urgency_gpt,
			category_gpt: e.category_gpt,
			subcat_gpt: e.subcat_gpt,
			thread_key: e.thread_key,
			external_id: e.external_id
		},
		created: e.created_at ?? e.created,
		updated: e.created_at ?? e.updated ?? e.created,
		expand: {
			customer_id: {
				id: e.contact_id,
				name: e.contact_name ?? undefined,
				phone: identityKind === 'phone' ? identityValue : undefined,
				email: identityKind === 'email' ? identityValue : undefined
			},
			assigned_members: []
		}
	};
}

/** GET /api/a2p/communication-log — from A2P API (if A2P_COMMLOG_API_URL) or A2P DB (if A2P_DATABASE_URL). */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user?.company) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	if (!isA2pCommLogEnabled()) {
		return json(
			{ error: 'A2P comm log not configured (set A2P_COMMLOG_API_URL or A2P_DATABASE_URL)' },
			{ status: 503 }
		);
	}
	try {
		const limit = Math.min(
			200,
			Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50)
		);
		const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
		const contactId = url.searchParams.get('contactId') || undefined;
		const channel = url.searchParams.get('channel') || undefined;
		const direction = url.searchParams.get('direction') || undefined;
		const internalTsFrom = url.searchParams.get('internalTsFrom');
		const internalTsTo = url.searchParams.get('internalTsTo');

		// Prefer external API (no DB required)
		if (process.env.A2P_COMMLOG_API_URL?.trim()) {
			const { logs } = await getCommLogFromApi({
				limit,
				offset,
				contactId,
				channel,
				direction,
				internalTsFrom: internalTsFrom ? parseInt(internalTsFrom, 10) : undefined,
				internalTsTo: internalTsTo ? parseInt(internalTsTo, 10) : undefined
			});
			return json({ logs: logs.map((e) => normalizeLog(e as Record<string, unknown>)) });
		}

		const rows = await queryCommEvents({
			limit,
			offset,
			contactId,
			channel,
			direction,
			internalTsFrom: internalTsFrom ? parseInt(internalTsFrom, 10) : undefined,
			internalTsTo: internalTsTo ? parseInt(internalTsTo, 10) : undefined
		});
		const logs = rows.map((e) => ({
			id: String(e.id),
			type: e.channel,
			direction: e.direction === 'in' ? 'inbound' : 'outbound',
			status: 'completed',
			source: e.identity_value ?? '',
			destination: e.thread_key ?? e.subject ?? '',
			summary: e.summary_gpt ?? e.subject ?? e.body_text?.slice(0, 80) ?? '',
			content: e.body_text ?? '',
			metadata: {
				urgency_gpt: e.urgency_gpt,
				category_gpt: e.category_gpt,
				subcat_gpt: e.subcat_gpt,
				thread_key: e.thread_key,
				external_id: e.external_id
			},
			created: e.created_at,
			updated: e.created_at,
			expand: {
				customer_id: {
					id: e.contact_id,
					name: e.contact_name ?? undefined,
					phone: e.identity_kind === 'phone' ? (e.identity_value ?? undefined) : undefined,
					email: e.identity_kind === 'email' ? (e.identity_value ?? undefined) : undefined
				},
				assigned_members: []
			}
		}));
		return json({ logs });
	} catch (err) {
		console.error('A2P communication-log error:', err);
		return json({ error: err instanceof Error ? err.message : 'Query failed' }, { status: 500 });
	}
};
