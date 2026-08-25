import { engCode, sesCode, prfCode } from '$lib/utils/comm-id';

/**
 * The four-level model surface (Profile → Engagement → Session → Interaction) for one
 * communication-log row.
 *
 * This lives here, not in a page loader, because TWO pages render the same rows through the same
 * `CommunicationTable`: `(app)/communication-log` and `(app)/profiles/[id]`. The mapping used to
 * exist only in the log page's loader, so the profiles page passed none of these fields and the
 * shared component rendered empty Intent / Profile / Engagement cells there. Both loaders now call
 * this, so the two pages cannot drift apart again.
 *
 * The Prisma query must `include` `communicationThread` (with its `contact`), `customer`, and
 * `callTrackingCategory` — see COMMUNICATION_SURFACE_INCLUDE.
 */

export const ATTRIBUTION_CHANNEL_LABELS: Record<string, string> = {
	google_paid: 'Google Paid Ads',
	bing_paid: 'Bing Paid Ads',
	organic_google: 'Google Organic',
	organic_bing: 'Bing Organic',
	facebook_ad: 'Facebook Ad',
	instagram_ad: 'Instagram Ad',
	linkedin_ad: 'LinkedIn Ad',
	youtube_paid: 'YouTube Paid Ad',
	youtube_organic: 'YouTube Organic',
	tiktok_ad: 'TikTok Ad',
	llm_referral: 'LLM Referral',
	gbp_website_click: 'Google Business Profile',
	qr_code: 'QR Code',
	referral: 'Referral',
	direct: 'Direct / type-in'
};

/** The relations the surface reads. Both loaders must spread this into their `findMany`. */
export const COMMUNICATION_SURFACE_INCLUDE = {
	communicationThread: { include: { contact: true } },
	customer: true,
	callTrackingCategory: true
} as const;

export function sourceChannelLabel(meta: Record<string, unknown>): string | null {
	const attribution = (meta.attribution as { channel?: string } | null) ?? null;
	if (attribution?.channel) {
		return ATTRIBUTION_CHANNEL_LABELS[attribution.channel] ?? attribution.channel.replace(/_/g, ' ');
	}
	if (meta.source_signal) return String(meta.source_signal);
	return null;
}

export function sourceChannelDetail(meta: Record<string, unknown>): string | null {
	const a =
		(meta.attribution as {
			channel?: string;
			keyword?: string | null;
			referrer?: string | null;
			landingUrl?: string | null;
		} | null) ?? null;
	if (!a?.channel) return null;
	if (a.keyword) return `kw "${a.keyword}"`;
	if (a.channel === 'direct') return 'no referrer';
	if (a.referrer) return `from ${a.referrer}`;
	if (a.channel === 'organic_google' || a.channel === 'organic_bing') return 'query not provided';
	return a.landingUrl ?? null;
}

export function profileWho(tier: string, fingerprint: string | null): string {
	if (tier === 'T1') return 'Identified — name + email/phone';
	if (tier === 'T2') return 'Name / company only — person not confirmed';
	return fingerprint ? `Anonymous · ${fingerprint} — device only` : 'Anonymous — device only';
}

/**
 * A row is still being interpreted when the AI pipeline has not written its read yet.
 *
 * The symptom this exists for: a leadbox emergency first rendered green (the row's own delivery
 * status, `success`) and flipped to red seconds later when the background pipeline finished and
 * set the urgency. The row was never wrong — it was incomplete, and showing it as settled was the
 * bug. Callers hide or mark these rather than showing a status that is about to change.
 */
export function isStillProcessing(log: {
	id?: string;
	type?: string | null;
	direction?: string | null;
	metadata?: unknown;
	communicationThread?: { summary?: string | null } | null;
}): boolean {
	const meta = (log.metadata as Record<string, any>) || {};

	// An explicit marker always wins if some writer sets one.
	if (meta.processing === true || meta.ai_processing === true) return true;
	if (meta.processingStatus && meta.processingStatus !== 'complete') return true;

	// OUTBOUND rows are things WE did — a callback dispatch, a bridge leg, a sent SMS. They are
	// complete the moment they are written; no interpreter runs over them afterwards, so they can
	// never be "pending". Without this guard the callback-router's own voice rows were held back
	// forever and the rep's dial simply never appeared in the log.
	if (String(log.direction ?? '').toLowerCase().startsWith('out')) return false;

	// Telemetry rows are deterministic — they are never "interpreted" and so never pending.
	const isTelemetry =
		meta.telemetry === true ||
		Array.isArray(meta.signals) ||
		meta.source_signal === 'web' ||
		meta.source_signal === 'viewroom';
	if (isTelemetry) return false;

	// A system-generated row (a dispatch record, a bridge leg) is not a customer message either.
	if (meta.callback_request || meta.system_action || meta.dial_ladder) return false;

	// Channels that go through the AI pipeline are pending until it has left its read behind.
	const aiInterpreted = ['leadbox', 'leadform', 'sms', 'email', 'voice', 'call'];
	if (!aiInterpreted.includes(String(log.type))) return false;

	const hasAiRead =
		!!meta.ai_intent ||
		!!meta.aiSummary ||
		!!meta.ai_summary ||
		!!meta.intentStatus ||
		!!meta.message_category ||
		meta.orchestrator_processed === true;

	return !hasAiRead;
}

// ── Intent, as the two axes the model requires ──────────────────────────────
//
// Two writers populate this and they use different key names:
//   telemetry  — `metadata.intentBucket` (the escalate-only ladder), `metadata.intentStatus`
//   AI/voice   — `metadata.ai_intent.intent_bucket`, `.confidence` (a NUMBER), `message_category`
//
// The surface previously read only the telemetry names, which is why an AI-interpreted voice call
// showed Stage —, Status — and Confidence — while its metadata was full of exactly that data.
//
// `emergency` is the urgency axis, NOT a stage. A burst-pipe caller is Active *and* Emergency, so
// an incoming bucket of "emergency" sets the flag and resolves the stage to `active` rather than
// overwriting it — collapsing the two loses the urgent half.

const STAGES = new Set(['research', 'comparison', 'active']);

/** A numeric model confidence (0.99) becomes the band the column renders. */
function confidenceBand(value: unknown): string | null {
	if (typeof value === 'string' && value) return value;
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	if (value >= 0.8) return 'high';
	if (value >= 0.5) return 'medium';
	return 'low';
}

function readIntent(log: any, meta: Record<string, any>) {
	const ai = (meta.ai_intent as Record<string, any> | undefined) ?? {};

	// Telemetry rows are DETERMINISTIC — signals fired, a table was consulted, nothing was
	// interpreted. They must only ever show what telemetry itself wrote. Treating them like an
	// interpreted row put "declared · low confidence" on a viewroom entry, which claims the visitor
	// told us something and that we were unsure about it. Neither happened.
	const isTelemetry =
		meta.telemetry === true ||
		Array.isArray(meta.signals) ||
		meta.source_signal === 'web' ||
		meta.source_signal === 'viewroom';

	const rawBucket = isTelemetry
		? ((meta.intentBucket as string) ?? null)
		: ((meta.intentBucket as string) ??
			(ai.intent_bucket as string) ??
			(meta.message_category as string) ??
			null);

	// `message_category` is the ORCHESTRATOR's routing label. On a telemetry row it is set by
	// downstream routing, not by the visitor, so it says nothing about their intent.
	const emergency = isTelemetry
		? rawBucket === 'emergency'
		: rawBucket === 'emergency' ||
			meta.message_category === 'emergency' ||
			ai.purpose === 'emergency' ||
			ai.urgency === 'critical' ||
			!!meta.emergency_type;

	// Emergency is not a stage. Keep an explicit stage if we have one; otherwise an emergency
	// caller is by definition acting now.
	const stage = STAGES.has(rawBucket as string) ? (rawBucket as string) : emergency ? 'active' : null;

	// A voicemail, SMS or form message is the customer telling us — that is `declared`
	// (Bug A's table). Telemetry never declares: it keeps the status telemetry gave it, or none.
	const status = isTelemetry
		? ((meta.intentStatus as string) ?? null)
		: ((meta.intentStatus as string) ??
			(Object.keys(ai).length || meta.message_category ? 'declared' : null));

	// Only a model reports a confidence. A deterministic row has nothing to be confident about.
	const confidence = isTelemetry
		? confidenceBand(meta.confidenceBand)
		: confidenceBand(meta.confidence ?? ai.confidence ?? ai.confidence_band);

	return {
		intentStage: stage,
		intentEmergency: emergency,
		intentStatus: status,
		intentConfidence: confidence,
		intentSubtopic:
			(log.subtopic as string) ??
			(meta.subtopic as string) ??
			// The orchestrator already classified the emergency ("roof_leak"); its first word is
			// the trade. Free, and better than showing nothing.
			(!isTelemetry && typeof meta.emergency_type === 'string'
				? meta.emergency_type.split('_')[0]
				: null)
	};
}

/**
 * Playback URL for a call recording, if this row has one.
 *
 * The three shapes Telnyx and our webhook leave behind, in the order the old summary dialog
 * already resolved them (`communication-log/+page.svelte`) — lifted here so the Session Summary
 * drawer and the old dialog cannot disagree about whether a call has audio:
 *
 *   1. `metadata.recording_id`   → our own proxy at /api/recording/{logId}, which is what a real
 *                                  Telnyx call leaves; the proxy holds the credentials.
 *   2. `metadata.recording_urls` → a direct object of {mp3, m4a, …} on some webhook payloads.
 *   3. `metadata.voicemail_url`  → the older single-URL voicemail field.
 */
export function recordingUrlFor(log: any): string | null {
	const meta = (log?.metadata as Record<string, any>) || {};

	if (log?.type === 'voice' && meta.recording_id) {
		return `/api/recording/${log.id}`;
	}

	const urls = meta.recording_urls;
	if (urls && typeof urls === 'object') {
		const direct =
			urls.mp3 ??
			urls.m4a ??
			Object.values(urls).find((v) => typeof v === 'string' && v.startsWith('http'));
		if (typeof direct === 'string') return direct;
	}

	return typeof meta.voicemail_url === 'string' ? meta.voicemail_url : null;
}

/**
 * Rows that are internal bookkeeping rather than a communication with the customer.
 *
 * They stay in the database — they carry the audit trail and raise the notification — but the
 * communication log is a record of conversations, and these are not conversations. A bucket
 * promotion in particular is derived FROM a real interaction, so leaving it in showed the same
 * event twice: once as the call, once as "🔥 Active Lead Detected".
 */
export function isInternalNotice(log: any): boolean {
	const meta = (log?.metadata as Record<string, any>) || {};
	return (
		meta.bucket_promotion === true ||
		meta.scheduled_intent_note === true ||
		meta.scheduled_intent_ack === true
	);
}

export interface CommunicationSurface {
	channelSource: string | null;
	channelSourceDetail: string | null;
	engagementId: string | null;
	sessionId: string | null;
	profileId: string | null;
	profileName: string | null;
	profileTier: string;
	profileWho: string;
	threadSubtopics: string[];
	threadSubtopicScores: Record<string, number> | null;
	threadEngagementScore: number | null;
	intentStatus: string | null;
	intentStage: string | null;
	intentSubtopic: string | null;
	intentConfidence: string | null;
	intentEmergency: boolean;
	recordingUrl: string | null;
	isProcessing: boolean;
	isInternalNotice: boolean;
	journey: JourneyActivity;
}

export function communicationSurface(log: any): CommunicationSurface {
	const meta = (log.metadata as Record<string, any>) || {};
	const thread = log.communicationThread ?? null;
	const customer = log.customer ?? thread?.contact ?? null;

	const tier = customer?.email || customer?.cell ? 'T1' : customer?.name ? 'T2' : 'T2B';

	const profileFp = Array.isArray(customer?.metadata?.fingerprints)
		? customer.metadata.fingerprints[0] ?? null
		: typeof log.source === 'string' && /^[a-z0-9]{8,}$/i.test(log.source)
			? log.source
			: null;

	return {
		channelSource: sourceChannelLabel(meta) ?? log.callTrackingCategory?.name ?? null,
		channelSourceDetail: sourceChannelDetail(meta) ?? log.callTrackingCategory?.name ?? null,
		engagementId: engCode(log.communicationThreadId),
		sessionId: sesCode(log.sessionRef ?? log.id),
		profileId: prfCode(customer?.id),
		profileName: customer?.name ?? null,
		profileTier: tier,
		profileWho: profileWho(tier, profileFp),
		threadSubtopics: Array.isArray(thread?.subtopics) ? thread.subtopics : [],
		threadSubtopicScores:
			thread?.subtopicScores && typeof thread.subtopicScores === 'object'
				? (thread.subtopicScores as Record<string, number>)
				: null,
		threadEngagementScore: thread?.engagementScore ?? null,
		...readIntent(log, meta),
		recordingUrl: recordingUrlFor(log),
		isProcessing: isStillProcessing(log),
		isInternalNotice: isInternalNotice(log),
		journey: journeyActivity(log)
	};
}

// ── Journey & Activity ───────────────────────────────────────────────────────
//
// The cell is a compact, channel-shaped read of what happened in the session — not a dump of
// signal names. Shapes are taken from design/a2p-log-prototype.html:
//
//   web        4 pages · 10 signals   ·   2 pages · click-to-call   ·   scanned → booking page
//   voice      GBP call · 3m 20s      ·   IVR → press 2 → voicemail ·   outbound call · 3m 40s
//   sms        1 message · appointment ·  token click → confirm     ·   confirmation sent
//   email      email + photo attached ·   token click → quote page  ·   brochure emailed · delivered
//   chatbot    chat · 6 turns
//   leadform   lead submitted         ·   form submitted
//
// One segment is emphasised — the fact that carries the session. Segments rather than HTML so the
// template never has to `@html` a string built from stored metadata.

export interface JourneySegment {
	text: string;
	bold: boolean;
}

export interface JourneyActivity {
	segments: JourneySegment[];
	/** The longer read shown underneath / in the drawer. */
	full: string;
}

function fmtDuration(totalSeconds: number): string {
	const s = Math.max(0, Math.round(totalSeconds));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rem = s % 60;
	return rem ? `${m}m ${rem}s` : `${m}m`;
}

function durationOf(log: any, meta: Record<string, any>): number | null {
	const candidates = [
		meta.durationSec, meta.duration_seconds, meta.duration, meta.callDuration,
		meta.call_duration, log.durationSeconds, log.duration
	];
	for (const c of candidates) {
		const n = typeof c === 'string' ? Number(c) : c;
		if (typeof n === 'number' && Number.isFinite(n) && n > 0) return n;
	}
	return null;
}

const seg = (text: string, bold = false): JourneySegment => ({ text, bold });

export function journeyActivity(log: any): JourneyActivity {
	const meta = (log.metadata as Record<string, any>) || {};
	const type = String(log.type ?? '').toLowerCase();
	const outbound = String(log.direction ?? '').toLowerCase().startsWith('out');
	const signals: string[] = Array.isArray(meta.signals) ? meta.signals : [];
	const dur = durationOf(log, meta);
	const detail: string[] = [];

	// ── Telemetry (web / viewroom): pages and signals ──
	if (signals.length > 0 || type === 'web' || type === 'viewroom') {
		const pages = signals.filter((s) => s === 'page_load').length;
		const segments: JourneySegment[] = [];

		if (pages > 0) segments.push(seg(`${pages} page${pages === 1 ? '' : 's'}`, true));
		if (signals.length > 0) {
			if (segments.length) segments.push(seg(' · '));
			segments.push(seg(`${signals.length} signal${signals.length === 1 ? '' : 's'}`));
		}
		// A call tap is more interesting than the signal count — surface it.
		if (signals.some((s) => s.includes('call'))) {
			if (segments.length) segments.push(seg(' · '));
			segments.push(seg('click-to-call'));
		}
		if (!segments.length) segments.push(seg('—'));

		if (pages) detail.push(`${pages} page${pages === 1 ? '' : 's'}`);
		if (dur) detail.push(fmtDuration(dur));
		if (signals.length) detail.push(`${signals.length} signals`);
		if (typeof meta.scoreLive === 'number') detail.push(`score ${meta.scoreLive}`);
		return { segments, full: detail.join(' · ') || 'no activity recorded' };
	}

	// ── Voice ──
	if (type === 'voice' || type === 'call' || type === 'phone') {
		const segments: JourneySegment[] = [];
		const ivrDigit = meta.ivrDigit ?? meta.digit ?? meta.dtmf ?? null;
		const voicemail = !!(meta.voicemail || meta.recordingUrl || meta.recording_url);

		if (!outbound && ivrDigit) {
			segments.push(seg('IVR → '), seg(`press ${ivrDigit}`, true));
			if (voicemail) segments.push(seg(' → voicemail'));
		} else {
			segments.push(seg(outbound ? 'outbound call' : 'call'));
			if (dur) segments.push(seg(' · '), seg(fmtDuration(dur), true));
			else if (voicemail) segments.push(seg(' · voicemail'));
		}

		if (dur) detail.push(`call ${fmtDuration(dur)}`);
		if (voicemail) detail.push('voicemail');
		if (meta.transcript || meta.transcription) detail.push('transcript');
		return { segments, full: detail.join(' · ') || (outbound ? 'outbound call' : 'inbound call') };
	}

	// ── Email ──
	if (type === 'email') {
		const atts = Array.isArray(meta.attachments) ? meta.attachments : [];
		const segments: JourneySegment[] = [];
		if (outbound) {
			segments.push(seg('emailed', true));
			if (log.emailOpenedAt) segments.push(seg(' · opened'));
			else segments.push(seg(' · delivered'));
		} else if (atts.length) {
			segments.push(seg('email + '), seg(`${atts.length} attachment${atts.length === 1 ? '' : 's'}`, true));
		} else {
			segments.push(seg('1 email'));
		}
		detail.push(outbound ? '1 outbound email' : '1 email');
		if (atts.length) detail.push(`${atts.length} attachment${atts.length === 1 ? '' : 's'}`);
		if (log.emailOpenedAt) detail.push('opened');
		if (log.emailClickedAt) detail.push('clicked');
		return { segments, full: detail.join(' · ') };
	}

	// ── SMS ──
	if (type === 'sms' || type === 'text') {
		const count = Array.isArray(meta.messages) ? meta.messages.length : 1;
		const segments: JourneySegment[] = outbound
			? [seg('sent', true), seg(' · delivered')]
			: [seg(`${count} message${count === 1 ? '' : 's'}`, true)];
		detail.push(`${count} ${outbound ? 'outbound' : 'inbound'} SMS`);
		return { segments, full: detail.join(' · ') };
	}

	// ── Chatbot ──
	if (type === 'chatbot' || type === 'chat') {
		const turns = Array.isArray(meta.messages) ? meta.messages.length : (meta.turns ?? null);
		const segments = turns
			? [seg('chat · '), seg(`${turns} turn${turns === 1 ? '' : 's'}`, true)]
			: [seg('chat', true)];
		return { segments, full: turns ? `${turns}-turn chat` : 'chat session' };
	}

	// ── Leadform / leadbox submissions ──
	if (type === 'leadform' || type === 'leadbox') {
		const label = type === 'leadform' ? 'form submitted' : 'lead submitted';
		return {
			segments: [seg(label, true)],
			full: meta.customer_phone || meta.customer_email ? 'name + contact captured → A2P' : label
		};
	}

	// No truncation. The cell is the record of what happened in the session; clipping it mid-word
	// ("Hi +15556655443, good news — you have no…") hides the part that matters. Let the column
	// wrap instead.
	return { segments: [seg(log.summary ? String(log.summary) : '—')], full: '' };
}
