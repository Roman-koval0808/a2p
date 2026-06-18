/**
 * Read-only access to A2P PostgreSQL (comm_events, contacts).
 * Set A2P_DATABASE_URL to enable. See docs/frontend-integration-a2p.md.
 */

import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
	const url = process.env.A2P_DATABASE_URL?.trim();
	if (!url) throw new Error('A2P_DATABASE_URL is not set');
	if (!pool) {
		pool = new Pool({
			connectionString: url,
			max: 4,
			idleTimeoutMillis: 30000
		});
	}
	return pool;
}

export function isA2pDbEnabled(): boolean {
	return !!process.env.A2P_DATABASE_URL?.trim();
}

export interface CommEventRow {
	id: number;
	channel: string;
	direction: string;
	contact_id: string | null;
	identity_kind: string | null;
	identity_value: string | null;
	external_id: string | null;
	thread_key: string | null;
	subject: string | null;
	body_text: string | null;
	summary_gpt: string | null;
	urgency_gpt: number | null;
	category_gpt: string | null;
	subcat_gpt: string | null;
	internal_ts: number | null;
	created_at: Date | null;
	contact_name: string | null;
	contact_company: string | null;
}

export interface QueryCommEventsOptions {
	limit?: number;
	offset?: number;
	contactId?: string;
	channel?: string;
	direction?: string;
	internalTsFrom?: number;
	internalTsTo?: number;
}

/** Last N comm events with contact names (read-only). */
export async function queryCommEvents(opts: QueryCommEventsOptions = {}): Promise<CommEventRow[]> {
	const {
		limit = 50,
		offset = 0,
		contactId,
		channel,
		direction,
		internalTsFrom,
		internalTsTo
	} = opts;
	const client = getPool();
	const conditions: string[] = ['1=1'];
	const params: unknown[] = [];
	let idx = 0;
	if (contactId) {
		idx++;
		conditions.push(`e.contact_id = $${idx}`);
		params.push(contactId);
	}
	if (channel) {
		idx++;
		conditions.push(`e.channel = $${idx}`);
		params.push(channel);
	}
	if (direction) {
		idx++;
		conditions.push(`e.direction = $${idx}`);
		params.push(direction);
	}
	if (internalTsFrom != null) {
		idx++;
		conditions.push(`e.internal_ts >= $${idx}`);
		params.push(internalTsFrom);
	}
	if (internalTsTo != null) {
		idx++;
		conditions.push(`e.internal_ts <= $${idx}`);
		params.push(internalTsTo);
	}
	idx++;
	params.push(limit);
	const limitIdx = idx;
	idx++;
	params.push(offset);
	const offsetIdx = idx;
	const sql = `
    SELECT
      e.id,
      e.channel,
      e.direction,
      e.contact_id,
      e.identity_kind,
      e.identity_value,
      e.external_id,
      e.thread_key,
      e.subject,
      e.body_text,
      e.summary_gpt,
      e.urgency_gpt,
      e.category_gpt,
      e.subcat_gpt,
      e.internal_ts,
      e.created_at,
      c.name AS contact_name,
      c.company AS contact_company
    FROM comm_events e
    LEFT JOIN contacts c ON c.contact_id = e.contact_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY e.internal_ts DESC NULLS LAST, e.id DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;
	const res = await client.query(sql, params);
	return res.rows as CommEventRow[];
}

export interface ContactRow {
	contact_id: string;
	name: string | null;
	company: string | null;
	notes: string | null;
	created_at: Date | null;
	updated_at: Date | null;
	last_seen_at: Date | null;
}

/** List contacts (read-only). */
export async function queryContacts(limit = 100): Promise<ContactRow[]> {
	const client = getPool();
	const res = await client.query(
		`SELECT contact_id, name, company, notes, created_at, updated_at, last_seen_at
     FROM contacts ORDER BY last_seen_at DESC NULLS LAST, updated_at DESC NULLS LAST LIMIT $1`,
		[limit]
	);
	return res.rows as ContactRow[];
}

// --- Write path: mirror our comm log into A2P so the A2P-driven comm log page shows them ---

function inferIdentityKindValue(
	source: string | null | undefined
): { kind: 'phone' | 'email'; value: string } | null {
	const s = (source ?? '').trim();
	if (!s) return null;
	if (s.includes('@') && s.includes('.')) return { kind: 'email', value: s };
	const normalized = s.replace(/\D/g, '');
	if (normalized.length >= 10) return { kind: 'phone', value: s };
	return { kind: 'email', value: s };
}

/** Get or create contact in A2P by identity; returns contact_id. */
export async function ensureA2pContact(params: {
	identityKind: 'phone' | 'email';
	identityValue: string;
	name?: string | null;
	company?: string | null;
}): Promise<string> {
	const client = getPool();
	const { identityKind, identityValue, name, company } = params;
	const existing = await client.query(
		`SELECT contact_id FROM contact_identities WHERE kind = $1 AND value = $2 LIMIT 1`,
		[identityKind, identityValue]
	);
	if (existing.rows.length > 0) {
		const contactId = existing.rows[0].contact_id as string;
		const now = new Date();
		await client.query(
			`UPDATE contacts SET updated_at = $1, last_seen_at = $1, name = COALESCE($2, name), company = COALESCE($3, company) WHERE contact_id = $4`,
			[now, name ?? null, company ?? null, contactId]
		);
		return contactId;
	}
	const contactId = crypto.randomUUID();
	const now = new Date();
	await client.query(
		`INSERT INTO contacts (contact_id, name, company, notes, created_at, updated_at, last_seen_at)
     VALUES ($1, $2, $3, NULL, $4, $4, $4)`,
		[contactId, name ?? null, company ?? null, now]
	);
	await client.query(
		`INSERT INTO contact_identities (contact_id, kind, value, is_primary, created_at) VALUES ($1, $2, $3, 1, $4)`,
		[contactId, identityKind, identityValue, now]
	);
	return contactId;
}

export interface InsertCommEventParams {
	channel: string;
	direction: 'in' | 'out';
	contact_id: string | null;
	identity_kind: 'phone' | 'email' | null;
	identity_value: string | null;
	thread_key?: string | null;
	subject?: string | null;
	body_text?: string | null;
	summary_gpt?: string | null;
	urgency_gpt?: number | null;
	category_gpt?: string | null;
	subcat_gpt?: string | null;
	external_id?: string | null;
}

/** Insert one row into comm_events (for leadbox/leadform/our app-originated events). */
export async function insertCommEvent(params: InsertCommEventParams): Promise<void> {
	const client = getPool();
	const internalTs = Date.now();
	await client.query(
		`INSERT INTO comm_events (channel, direction, contact_id, identity_kind, identity_value, thread_key, subject, body_text, summary_gpt, urgency_gpt, category_gpt, subcat_gpt, internal_ts, external_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
		[
			params.channel,
			params.direction,
			params.contact_id,
			params.identity_kind,
			params.identity_value,
			params.thread_key ?? null,
			params.subject ?? null,
			params.body_text ?? null,
			params.summary_gpt ?? null,
			params.urgency_gpt ?? null,
			params.category_gpt ?? null,
			params.subcat_gpt ?? null,
			internalTs,
			params.external_id ?? null
		]
	);
}

/** Map our CommunicationLogEntry into A2P comm_events + contact. Call when A2P_DATABASE_URL is set. */
export async function mirrorToA2p(entry: {
	type: string;
	direction: string;
	source?: string | null;
	destination?: string | null;
	summary?: string | null;
	content?: string | null;
	metadata?: Record<string, unknown> | null;
	contact_name?: string | null;
	contact_company?: string | null;
}): Promise<void> {
	const identity = inferIdentityKindValue(entry.source);
	const direction = entry.direction === 'inbound' ? 'in' : 'out';
	const channel = entry.type; // voice, sms, email, leadbox, leadform, etc.
	const meta = entry.metadata ?? {};
	const urgencyMap: Record<string, number> = { red: 5, blue: 3, green: 1 };
	const urgencyGpt = typeof meta.urgency === 'string' ? (urgencyMap[meta.urgency] ?? 2) : 2;
	let contactId: string | null = null;
	let identityKind: 'phone' | 'email' | null = null;
	let identityValue: string | null = null;
	if (identity) {
		identityKind = identity.kind;
		identityValue = identity.value;
		contactId = await ensureA2pContact({
			identityKind,
			identityValue,
			name: entry.contact_name ?? undefined,
			company: entry.contact_company ?? undefined
		});
	}
	await insertCommEvent({
		channel,
		direction: direction as 'in' | 'out',
		contact_id: contactId,
		identity_kind: identityKind,
		identity_value: identityValue ?? entry.source ?? null,
		thread_key: (meta.thread_id as string) ?? undefined,
		subject: entry.destination ?? `Inbound ${channel}`,
		body_text: entry.content ?? null,
		summary_gpt: entry.summary ?? null,
		urgency_gpt: urgencyGpt,
		category_gpt: (meta.sentiment as string) ?? null,
		subcat_gpt: (meta.intent as string) ?? null
	});
}
