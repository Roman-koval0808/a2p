// Browser telemetry client. Batches deterministic signals and posts them to the
// lead-grabber intake endpoint. Designed to be imported once per page and shared via
// a singleton so the viewroom, leadform, leadbox and marketing site all emit through
// the same pipeline.

import { isKnownSignal, type SignalPayload, type TelemetrySignal } from './signals';
import { captureBrowserAttribution, type Attribution } from './attribution';
import { readFingerprint } from './fingerprint';

export interface TelemetryOptions {
	endpoint?: string;
	tenantSlug?: string | null;
	sessionId?: string | null;
	fingerprintId?: string | null;
	/** Flush when the buffer reaches this many signals. */
	flushSize?: number;
	/** Flush after this many milliseconds even if the buffer is not full. */
	flushIntervalMs?: number;
}

const DEFAULT_ENDPOINT = '/api/v1/telemetry/signals';

/**
 * One session id per BROWSER TAB, under the same sessionStorage key the marketing-site client and
 * the leadbox/leadform embeds use. sessionStorage is per-tab and is cleared when the tab closes,
 * which is the visit boundary: reopening the tab starts a new session and the backend opens a new
 * comm log.
 */
function randomSessionId(): string {
	const t = Date.now().toString(36);
	const r = Math.random().toString(36).slice(2, 8);
	const fresh = `sess_${t}${r}`;
	if (typeof window === 'undefined') return fresh;
	try {
		const existing = window.sessionStorage.getItem('clearsky_session');
		if (existing) return existing;
		window.sessionStorage.setItem('clearsky_session', fresh);
		return fresh;
	} catch {
		return fresh; // private mode / storage blocked
	}
}

export class TelemetryClient {
	private endpoint: string;
	private tenantSlug: string | null;
	private sessionId: string;
	private fingerprintId: string | null;
	private name: string | null = null;
	private email: string | null = null;
	private phone: string | null = null;
	private attribution: Attribution | null;
	private buffer: TelemetrySignal[] = [];
	private flushSize: number;
	private flushIntervalMs: number;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private flushing = false;

	constructor(options: TelemetryOptions = {}) {
		this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
		this.tenantSlug = options.tenantSlug ?? null;
		this.fingerprintId = options.fingerprintId ?? readFingerprint();
		this.sessionId = options.sessionId ?? randomSessionId();
		this.flushSize = options.flushSize ?? 20;
		this.flushIntervalMs = options.flushIntervalMs ?? 5000;
		this.attribution = captureBrowserAttribution();

		if (typeof window !== 'undefined') {
			this.startAutoFlush();
			window.addEventListener('pagehide', () => this.flushBeacon());
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'hidden') this.flushBeacon();
			});
		}
	}

	setTenant(tenantSlug: string | null) {
		this.tenantSlug = tenantSlug;
	}

	setFingerprint(fingerprintId: string | null) {
		this.fingerprintId = fingerprintId;
	}

	/** Record the visitor's identifiers so the intake can resolve/merge their profile. */
	identify(identity: { name?: string | null; email?: string | null; phone?: string | null }) {
		if (identity.name) this.name = identity.name;
		if (identity.email) this.email = identity.email;
		if (identity.phone) this.phone = identity.phone;
	}

	/** Queue a deterministic signal. Unknown names are dropped to keep the pipeline clean. */
	track(name: string, payload?: SignalPayload) {
		if (!isKnownSignal(name)) {
			if (typeof console !== 'undefined') console.warn(`[telemetry] Unknown signal dropped: ${name}`);
			return;
		}
		if (typeof console !== 'undefined') {
			console.log('[clearsky-telemetry] signal fired', {
				signal: name,
				payload: payload ?? {},
				fingerprintId: this.fingerprintId,
				sessionId: this.sessionId,
				tenantSlug: this.tenantSlug
			});
		}
		this.buffer.push({
			name,
			occurredAt: new Date().toISOString(),
			payload: payload ?? {}
		});
		if (this.buffer.length >= this.flushSize) {
			void this.flush();
		}
	}

	private startAutoFlush() {
		if (this.timer) clearInterval(this.timer);
		this.timer = setInterval(() => {
			if (this.buffer.length > 0) void this.flush();
		}, this.flushIntervalMs);
	}

	private buildBody() {
		return JSON.stringify({
			tenantSlug: this.tenantSlug,
			sessionId: this.sessionId,
			fingerprintId: this.fingerprintId,
			name: this.name,
			email: this.email,
			phone: this.phone,
			attribution: this.attribution,
			signals: this.buffer
		});
	}

	/** Async flush over fetch. Returns true if the buffer was sent. */
	async flush(): Promise<boolean> {
		if (this.flushing || this.buffer.length === 0) return false;
		this.flushing = true;
		const body = this.buildBody();
		this.buffer = [];
		try {
			const res = await fetch(this.endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body,
				keepalive: true
			});
			this.flushing = false;
			return res.ok;
		} catch (err) {
			// Re-queue on failure so no signal is silently lost.
			this.buffer = [...JSON.parse(body).signals, ...this.buffer];
			this.flushing = false;
			return false;
		}
	}

	/** Best-effort unload flush via sendBeacon (no response expected). */
	private flushBeacon() {
		if (this.buffer.length === 0 || typeof navigator === 'undefined') return;
		const body = this.buildBody();
		this.buffer = [];
		try {
			navigator.sendBeacon(this.endpoint, new Blob([body], { type: 'application/json' }));
		} catch {
			/* nothing more we can do on unload */
		}
	}
}

let client: TelemetryClient | null = null;

/** Shared singleton. Reuse across a page so all widgets emit through one buffer. */
export function getTelemetry(options: TelemetryOptions = {}): TelemetryClient {
	if (!client) client = new TelemetryClient(options);
	if (options.tenantSlug) client.setTenant(options.tenantSlug);
	if (options.fingerprintId) client.setFingerprint(options.fingerprintId);
	return client;
}
