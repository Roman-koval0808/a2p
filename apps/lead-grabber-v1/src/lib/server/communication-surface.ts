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
	type?: string | null;
	metadata?: unknown;
	communicationThread?: { summary?: string | null } | null;
}): boolean {
	const meta = (log.metadata as Record<string, any>) || {};

	// An explicit marker always wins if some writer sets one.
	if (meta.processing === true || meta.ai_processing === true) return true;
	if (meta.processingStatus && meta.processingStatus !== 'complete') return true;

	// Telemetry rows are deterministic — they are never "interpreted" and so never pending.
	const isTelemetry =
		Array.isArray(meta.signals) || meta.source_signal === 'web' || meta.source_signal === 'viewroom';
	if (isTelemetry) return false;

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
	isProcessing: boolean;
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
		intentStatus: (meta.intentStatus as string) ?? null,
		intentStage: (meta.intentBucket as string) ?? (meta.ai_intent?.stage as string) ?? null,
		intentSubtopic: (meta.subtopic as string) ?? (log.subtopic as string) ?? null,
		intentConfidence:
			(meta.confidence as string) ?? (meta.ai_intent?.confidence_band as string) ?? null,
		isProcessing: isStillProcessing(log),
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

	return { segments: [seg(log.summary ? String(log.summary).slice(0, 60) : '—')], full: '' };
}
