// Engagement model — pure resolution + scoring logic.
//
// These functions hold the *decision* parts of the engagement model so they can be unit-tested
// without a database. The DB reads/writes live in `telemetry/intake.ts`; here we only decide.
//
// The model (specs/clearsky-communication-log-id-model.md):
//   * a thread (CommunicationThread) is an ENGAGEMENT — one business episode, spans visits/months
//   * a log row (CommunicationLog) is a SESSION — one visit/call/exchange inside the episode
//   * a subtopic is a *tag* on the episode, never a boundary — a subtopic change never forks a thread

export const ENGAGEMENT_RULES_VERSION = 'engagement_resolution_v1';

// Inactivity windows per type of business (administrator-configurable; these are the spec's
// starting points). An episode stays open for the LONGEST window among its subtopics.
const SUBTOPIC_WINDOW_DAYS: Record<string, number> = {
	emergency: 7,
	// routine repair / service
	drain: 30,
	plumbing: 30,
	repair: 30,
	water_heater: 30,
	furnace: 30,
	hvac: 30,
	electrical: 30,
	// renovations — long-running
	bathroom: 180,
	kitchen: 180,
	roof: 180,
	renovation: 180,
	renovations: 180,
	// follow-up windows
	quote: 90,
	billing: 60,
	support: 30
};

/** Default inactivity window when a subtopic has no configured window. */
export const DEFAULT_INACTIVITY_DAYS = 30;

export function subtopicWindowDays(subtopic: string | null | undefined): number {
	if (!subtopic) return DEFAULT_INACTIVITY_DAYS;
	return SUBTOPIC_WINDOW_DAYS[subtopic] ?? DEFAULT_INACTIVITY_DAYS;
}

/** Longest window among a thread's subtopics — a quick repair must not close an active renovation. */
export function engagementWindowDays(subtopics: string[]): number {
	if (!subtopics.length) return DEFAULT_INACTIVITY_DAYS;
	return Math.max(...subtopics.map((s) => subtopicWindowDays(s)));
}

export interface OpenThread {
	id: string;
	status: string;
	subtopics: string[];
	updated: Date;
}

export interface ThreadResolution {
	decision: 'explicit' | 'open' | 'recent' | 'new';
	threadId?: string;
	reason: string;
	rulesVersion: string;
	/**
	 * A thread that was still marked open but whose inactivity window has lapsed. The caller should
	 * mark it `closed` so the stored data matches the roadmap's definition of active
	 * (`status != 'closed'`). Retiring it, never deleting it — the rows stay where they are.
	 */
	closeThreadId?: string;
}

/**
 * Evidence-before-time thread resolution. The DB layer gathers the candidate rows (explicit ref,
 * open thread, most-recent thread) and this function returns the verdict + reason.
 *
 * Priority (first match wins):
 *   1. explicit engagement/project/quote/case/work-order reference
 *   2. the contact's ACTIVE (open) thread — whatever the subtopic (fixes Bug B: unknown ≠ different)
 *   3. the contact's most recent thread within the inactivity window (longest among its subtopics)
 *   4. otherwise a new thread (a fresh episode)
 *
 * A subtopic change NEVER forks a thread.
 */
export function resolveEngagementThread(args: {
	explicitThreadId?: string | null;
	explicitRef?: string | null;
	openThread?: OpenThread | null;
	recentThread?: OpenThread | null;
	now?: Date;
}): ThreadResolution {
	const now = args.now ?? new Date();

	if (args.explicitThreadId) {
		return {
			decision: 'explicit',
			threadId: args.explicitThreadId,
			reason: 'explicit_reference',
			rulesVersion: ENGAGEMENT_RULES_VERSION
		};
	}
	if (args.explicitRef) {
		return {
			decision: 'explicit',
			reason: 'explicit_reference',
			rulesVersion: ENGAGEMENT_RULES_VERSION
		};
	}

	// Rule 2 — the contact's ACTIVE thread, whatever the subtopic.
	//
	// "Active" is two conditions, not one. The roadmap defines it as `status != 'closed'` and says
	// that needs no migration — but nothing in the codebase ever sets a thread to `closed`, so on
	// its own that test is always true and an engagement never ends. The roadmap's own acceptance
	// list requires the opposite: "Same contact returns after the window -> new T2".
	//
	// So the inactivity window is applied here too. A thread silent past the longest window among
	// its subtopics is not active, whatever its stored status says, and the caller is told to
	// retire it (`closeThreadId`) so the stored status catches up with the decision.
	let lapsedOpenThreadId: string | undefined;
	if (args.openThread && args.openThread.status !== 'closed') {
		const windowDays = engagementWindowDays(args.openThread.subtopics ?? []);
		const elapsedDays =
			(now.getTime() - args.openThread.updated.getTime()) / (1000 * 60 * 60 * 24);
		if (elapsedDays <= windowDays) {
			return {
				decision: 'open',
				threadId: args.openThread.id,
				reason: 'active_open_thread',
				rulesVersion: ENGAGEMENT_RULES_VERSION
			};
		}
		lapsedOpenThreadId = args.openThread.id;
	}

	if (args.recentThread) {
		const windowDays = engagementWindowDays(args.recentThread.subtopics ?? []);
		const elapsedMs = now.getTime() - args.recentThread.updated.getTime();
		const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
		if (elapsedDays <= windowDays) {
			return {
				decision: 'recent',
				threadId: args.recentThread.id,
				reason: `recent_within_window_${windowDays}d`,
				rulesVersion: ENGAGEMENT_RULES_VERSION
			};
		}
	}

	return {
		decision: 'new',
		reason: 'no_open_thread_or_window_lapsed',
		rulesVersion: ENGAGEMENT_RULES_VERSION,
		...(lapsedOpenThreadId ? { closeThreadId: lapsedOpenThreadId } : {})
	};
}

// ── Intent status (source-aware) ─────────────────────────────────────────────
//
// `ad_indicated` must mean a REAL paid-ad click. The pre-model fallback gave it to any no-message
// arrival, so organic search wrongly showed `ad_indicated`. The channel only ever produces
// `ad_indicated` — everything stronger comes from behaviour and outcome.

export type IntentStatus =
	| 'n/a'
	| 'declared'
	| 'ad_indicated'
	| 'behaviour_inferred'
	| 'source_indicated';

const PAID_AD_CHANNELS = new Set([
	'google_paid',
	'bing_paid',
	'facebook_ad',
	'instagram_ad',
	'linkedin_ad',
	'youtube_paid',
	'tiktok_ad'
]);

export function isPaidAdChannel(channel: string | null | undefined): boolean {
	return PAID_AD_CHANNELS.has((channel ?? '').toLowerCase());
}

export function deriveIntentStatus(args: {
	direction: 'inbound' | 'outbound';
	declaredIdentifier: boolean; // a message / identity / review arrived (name, email, phone)
	isPaidAd: boolean;
	hasBehaviour: boolean; // browsed beyond a bare landing (more than a page_load)
}): IntentStatus {
	if (args.direction === 'outbound') return 'n/a';
	if (args.declaredIdentifier) return 'declared';
	if (args.isPaidAd) return 'ad_indicated';
	if (args.hasBehaviour) return 'behaviour_inferred';
	return 'source_indicated';
}

// ── Subtopic attribution ─────────────────────────────────────────────────────
//
// Storage is cheap; classification is the work. Without the ServiceTaxonomy table, web subtopics
// come from two deterministic sources: the landing URL and the service/problem payload fields the
// signal catalog already declares. Calls come from CallTrackingCategory on the voice side.

const URL_SUBTOPIC_PATTERNS: [RegExp, string][] = [
	[/\/services\/drains?/i, 'drain'],
	[/\/drain/i, 'drain'],
	[/bathroom/i, 'bathroom'],
	[/kitchen/i, 'kitchen'],
	[/roof/i, 'roof'],
	[/furnace/i, 'furnace'],
	[/water[- ]?heater/i, 'water_heater'],
	[/plumb/i, 'plumbing'],
	[/hvac/i, 'hvac'],
	[/electrical/i, 'electrical'],
	[/emergency/i, 'emergency'],
	[/renovat/i, 'renovation'],
	[/quote/i, 'quote']
];

/** Lowercase, spaces→underscore, strip anything but alnum/underscore. */
export function normalizeSubtopic(raw: string | null | undefined): string | null {
	const v = (raw ?? '').trim().toLowerCase().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '');
	return v || null;
}

export function subtopicFromUrl(pathname: string | null | undefined): string | null {
	if (!pathname) return null;
	for (const [re, key] of URL_SUBTOPIC_PATTERNS) {
		if (re.test(pathname)) return key;
	}
	return null;
}

export interface SubtopicSignal {
	name: string;
	payload?: Record<string, unknown> | null;
}

/** Payload fields that name the subject outright (a picked service, a chosen problem). */
const SUBTOPIC_PAYLOAD_FIELDS = ['service', 'problem', 'interest', 'emergencyType'];

/**
 * Payload fields carrying the page the signal fired on. This is what makes per-signal attribution
 * work: `page_load` declares `['url', 'title']`, and emitters send either a pathname
 * (`window.location.pathname`, the site tracker) or a full href (`window.location.href`, the
 * embeds) — so both shapes have to resolve.
 */
const SUBTOPIC_URL_FIELDS = ['url', 'page', 'pathname', 'href', 'landingUrl'];

/** Pathname of a full URL, or the value itself when it is already a path. */
export function pathnameOf(value: string | null | undefined): string | null {
	const v = (value ?? '').trim();
	if (!v) return null;
	try {
		return new URL(v).pathname;
	} catch {
		return v.startsWith('/') ? v : `/${v}`;
	}
}

/**
 * The subtopic for ONE signal, most specific evidence first:
 *   1. a payload field that names the subject outright
 *   2. the page THIS signal fired on
 *   3. the session's landing page
 *
 * Step 2 is the one that separates a kitchen page-view from a bathroom page-view inside a single
 * session. Without it every signal in a batch inherits the landing page and the split is lost.
 */
export function subtopicForSignal(
	signal: SubtopicSignal,
	fallbackUrl?: string | null
): string | null {
	const p = (signal.payload ?? {}) as Record<string, unknown>;

	for (const field of SUBTOPIC_PAYLOAD_FIELDS) {
		const v = p[field];
		if (typeof v === 'string' && v.trim()) {
			const normalized = normalizeSubtopic(v);
			if (normalized) return normalized;
		}
	}

	for (const field of SUBTOPIC_URL_FIELDS) {
		const v = p[field];
		if (typeof v === 'string' && v.trim()) {
			const fromOwnPage = subtopicFromUrl(pathnameOf(v));
			if (fromOwnPage) return fromOwnPage;
		}
	}

	return subtopicFromUrl(pathnameOf(fallbackUrl));
}

export function subtopicFromSignals(signals: SubtopicSignal[]): string | null {
	for (const sig of signals) {
		const st = subtopicForSignal(sig, null);
		if (st) return st;
	}
	return null;
}

/** The session-level subtopic — the first one any of its signals can evidence. */
export function resolveBatchSubtopic(args: {
	landingUrl?: string | null;
	signals: SubtopicSignal[];
}): string | null {
	for (const sig of args.signals) {
		const st = subtopicForSignal(sig, args.landingUrl);
		if (st) return st;
	}
	return subtopicFromUrl(pathnameOf(args.landingUrl));
}

// ── Per-subtopic scoring ─────────────────────────────────────────────────────
//
// Each signal is attributed to a subtopic at fire time; a signal we cannot tie to a subject is
// recorded separately under `UNKNOWN_SUBTOPIC` rather than being dropped or guessed at. Deltas accumulate per subtopic on the thread;
// the engagement total is the plain sum of the map, capped at 100 on the TOTAL (the worked example
// 20 + 30 = 50 reads as a plain sum).

/** Signals with no identifiable subject are recorded here, kept separate from the real subtopics. */
export const UNKNOWN_SUBTOPIC = 'unknown';

export const SCORE_CAP = 100;

export function accumulateSubtopicScores(
	existing: Record<string, number>,
	deltas: Record<string, number>
): Record<string, number> {
	const next: Record<string, number> = { ...existing };
	for (const [key, delta] of Object.entries(deltas)) {
		next[key] = (next[key] ?? 0) + delta;
	}
	return next;
}

/** Plain sum of the per-subtopic map. */
export function rollupScore(scores: Record<string, number>): number {
	return Object.values(scores).reduce((sum, n) => sum + n, 0);
}

/** Cap the engagement total at SCORE_CAP (the cap is on the total, not per subtopic). */
export function capTotal(score: number): number {
	return Math.max(0, Math.min(SCORE_CAP, score));
}
