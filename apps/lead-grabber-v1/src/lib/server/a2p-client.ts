/**
 * A2P backend client. Uses AI_BASE_URL (env) as base.
 * See docs/backend-api.md for endpoint contract.
 */

function getBaseUrl(): string | null {
	const url = process.env.AI_BASE_URL?.trim();
	return url || null;
}

function url(path: string): string {
	const base = getBaseUrl();
	if (!base) throw new Error('AI_BASE_URL is not set');
	const normalized = base.replace(/\/$/, '');
	const p = path.startsWith('/') ? path : `/${path}`;
	return `${normalized}${p}`;
}

/** Forward Telnyx voice webhook body to A2P. Returns response and ok status. */
export async function forwardVoiceWebhook(
	rawBody: string
): Promise<{ ok: boolean; status: number; body: unknown }> {
	const target = url('/api/signals/telnyx/a2p');
	console.log(`[A2P] Forwarding Voice to: ${target}`);
	const res = await fetch(target, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: rawBody
	});
	let body: unknown;
	const ct = res.headers.get('content-type');
	try {
		body = ct?.includes('application/json') ? await res.json() : await res.text();
	} catch {
		body = null;
	}
	return { ok: res.ok, status: res.status, body };
}

/** Forward Telnyx SMS webhook body to A2P. */
export async function forwardSmsWebhook(
	rawBody: string
): Promise<{ ok: boolean; status: number; body: unknown }> {
	const target = url('/api/signals/telnyx/sms');
	console.log(`[A2P] Forwarding SMS to: ${target}`);
	const res = await fetch(target, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: rawBody
	});
	let body: unknown;
	const ct = res.headers.get('content-type');
	try {
		body = ct?.includes('application/json') ? await res.json() : await res.text();
	} catch {
		body = null;
	}
	return { ok: res.ok, status: res.status, body };
}

/**
 * Whether A2P webhook forwarding is enabled. OFF by default.
 *
 * The A2P backend was retired — all of its logic now lives in this app. Forwarding nevertheless
 * stayed on because AI_BASE_URL was still present in .env, so EVERY inbound SMS and voice webhook
 * paid a failed TCP connect and dumped a full stack trace. A single phone call produced ~20 of
 * them, which buried the real pipeline output and made logs unreadable.
 *
 * It is therefore opt-IN: a leftover AI_BASE_URL can no longer silently resurrect it. To bring
 * A2P back, set A2P_FORWARDING_ENABLED=true alongside AI_BASE_URL.
 */
export function isA2pEnabled(): boolean {
	if (process.env.A2P_FORWARDING_ENABLED?.trim().toLowerCase() !== 'true') return false;
	return !!getBaseUrl();
}

// --- Email service (port 5100). Use AI_BASE_URL_EMAIL when set. ---

function getEmailBaseUrl(): string | null {
	const u = process.env.AI_BASE_URL_EMAIL?.trim() || process.env.AI_BASE_URL?.trim();
	return u || null;
}

function urlEmail(path: string): string {
	const base = getEmailBaseUrl();
	if (!base) throw new Error('AI_BASE_URL_EMAIL or AI_BASE_URL is not set');
	const normalized = base.replace(/\/$/, '');
	const p = path.startsWith('/') ? path : `/${path}`;
	return `${normalized}${p}`;
}

export interface A2pIncomingEmail {
	msg_id: string;
	thread_id: string;
	from: string;
	to: string;
	subject: string;
	snippet: string;
	summary?: string;
	urgency?: number;
	category?: string;
	subcat?: string;
	internal_ts?: number;
	created_at?: string;
}

export interface A2pEmailsIncomingResponse {
	emails: A2pIncomingEmail[];
}

export async function getEmailsIncoming(): Promise<A2pEmailsIncomingResponse> {
	const target = urlEmail('/api/emails/incoming');
	const res = await fetch(target);
	if (!res.ok) throw new Error(`A2P emails/incoming: ${res.status}`);
	return res.json();
}

export interface A2pThread {
	thread_id: string;
	status: string;
	proposed_slots: string[];
	selected_slot_iso?: string | null;
	calendar_event_id?: string | null;
	contact_email?: string | null;
	updated_at?: string;
}

export interface A2pThreadsResponse {
	threads: A2pThread[];
}

export async function getThreads(): Promise<A2pThreadsResponse> {
	const target = urlEmail('/api/threads');
	const res = await fetch(target);
	if (!res.ok) throw new Error(`A2P threads: ${res.status}`);
	return res.json();
}

export interface A2pOrchestratorRunOnceResponse {
	ok: boolean;
	processed: number;
	watermark_ms?: number;
}

export async function runOrchestratorOnce(limit?: number): Promise<A2pOrchestratorRunOnceResponse> {
	const target = urlEmail('/api/orchestrator/run_once');
	const res = await fetch(target, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: limit != null ? JSON.stringify({ limit }) : undefined
	});
	if (!res.ok) throw new Error(`A2P orchestrator/run_once: ${res.status}`);
	return res.json();
}

/** GET /healthz (email) or /health (calls/SMS). */
export async function healthCheck(
	path: '/healthz' | '/health' = '/health'
): Promise<{ ok: boolean; error?: string }> {
	try {
		const target = url(path);
		const res = await fetch(target);
		const data = res.ok ? await res.json().catch(() => ({})) : {};
		return res.ok
			? { ok: (data as { ok?: boolean }).ok !== false }
			: { ok: false, error: (data as { error?: string }).error ?? `HTTP ${res.status}` };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

// --- Comm log from external API (no DB required when A2P exposes GET /api/comm-events or similar) ---

function getCommLogApiUrl(): string | null {
	const u = process.env.A2P_COMMLOG_API_URL?.trim();
	return u || null;
}

/** True when comm log can be loaded from A2P (either API URL or DB). */
export function isA2pCommLogEnabled(): boolean {
	return !!getCommLogApiUrl() || !!process.env.A2P_DATABASE_URL?.trim();
}

/** Fetch comm log from A2P HTTP API. Expects response like { logs: [...] } or { events: [...] } with items having id, channel/direction, body_text/content, etc. */
export async function getCommLogFromApi(opts: {
	limit?: number;
	offset?: number;
	contactId?: string;
	channel?: string;
	direction?: string;
	internalTsFrom?: number;
	internalTsTo?: number;
}): Promise<{ logs: unknown[] }> {
	const base = getCommLogApiUrl();
	if (!base) throw new Error('A2P_COMMLOG_API_URL is not set');
	const params = new URLSearchParams();
	if (opts.limit != null) params.set('limit', String(opts.limit));
	if (opts.offset != null) params.set('offset', String(opts.offset));
	if (opts.contactId) params.set('contactId', opts.contactId);
	if (opts.channel) params.set('channel', opts.channel);
	if (opts.direction) params.set('direction', opts.direction);
	if (opts.internalTsFrom != null) params.set('internalTsFrom', String(opts.internalTsFrom));
	if (opts.internalTsTo != null) params.set('internalTsTo', String(opts.internalTsTo));
	const url = base.includes('?') ? `${base}&${params}` : `${base}?${params}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`A2P comm-log API: ${res.status}`);
	const data = (await res.json()) as { logs?: unknown[]; events?: unknown[] };
	const list = Array.isArray(data.logs) ? data.logs : Array.isArray(data.events) ? data.events : [];
	return { logs: list };
}
