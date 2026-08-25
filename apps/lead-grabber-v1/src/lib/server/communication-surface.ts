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
		isProcessing: isStillProcessing(log)
	};
}
