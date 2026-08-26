import { engCode, sesCode, prfCode } from '$lib/utils/comm-id';
import { formatDescriptiveIntent } from '$lib/utils/subtopic-labels';
import { canonicalAttributionChannel } from '$lib/telemetry/attribution';

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
	callTrackingCategory: true,
	// The rep who placed an outbound call — "Rep-bound number · Dave R." in the Source cell.
	user: { select: { name: true, email: true } }
} as const;

/**
 * Column 4 — Source: WHERE the interaction came from.
 *
 * From `specs/clearsky-communication-log-id-model.md` §"Source — WHERE the interaction came from":
 *
 *   > The identifiable origin, platform, campaign or referral that produced the interaction.
 *   > **The Source is not the person — the person is the Profile.**
 *
 * So this is never a name and never a bare phone number. It is the provider channel, and the spec
 * lists them per medium (Web: Google Ads / Bing Organic / Referral / …; Phone: click-to-call /
 * Google Business Profile / Tracking number / …; SMS and Email likewise). The counterpart's number
 * or address belongs in the DETAIL line underneath, which is where the prototype puts it.
 *
 * Matching `design/a2p-log-prototype.html`:
 *
 *   web   in    Bing Organic            query not provided
 *   phone in    Google Business Profile  +1 705 555 0140 · mobile
 *   phone in    Inbound Call             tracking number · +1 705 555 0155
 *   sms   in    Inbound SMS              +1 705 555 0155 · mobile
 *   email in    Inbound Email            rory@example.com
 *   phone out   Rep-bound number         Dave R. · Sales
 *   sms   out   Outbound SMS (A2P)       bound before send
 *   email out   Outbound Email (A2P)     Postmark · track clicks
 *
 * Only web rows carried a Source before, so every message row fell back to `source_signal` — the
 * MEDIUM, which the Channel line already states. An outbound SMS read "SMS · OUT" above "sms".
 */
function mediumOf(log: any): 'web' | 'phone' | 'sms' | 'email' | 'chat' | 'other' {
	const t = (log?.type ?? '').toString().toLowerCase();
	if (t === 'voice' || t === 'phone' || t === 'call') return 'phone';
	if (t === 'sms') return 'sms';
	if (t === 'email') return 'email';
	if (t === 'chat' || t === 'chatbot') return 'chat';
	if (t === 'web' || t === 'telemetry') return 'web';
	return 'other';
}

export function sourceChannelLabel(meta: Record<string, unknown>, log?: any): string | null {
	const attribution = (meta.attribution as { channel?: string } | null) ?? null;
	const channel = attribution ? canonicalAttributionChannel(attribution) : null;
	if (channel) {
		return (
			ATTRIBUTION_CHANNEL_LABELS[channel] ?? channel.replace(/_/g, ' ')
		);
	}

	// A token link is a source in its own right — the customer arrived by following something we
	// sent them, which is stronger evidence than the medium.
	if (meta.cs_token || meta.token_click) {
		const medium = mediumOf(log);
		if (medium === 'email') return 'Email link (cs_token)';
		if (medium === 'sms') return 'SMS link (cs_token)';
	}

	// A tracking number already names where the call came from.
	const category = log?.callTrackingCategory?.name;
	if (category) return String(category);

	const outbound = (log?.direction ?? '').toString().toLowerCase() === 'outbound';
	switch (mediumOf(log)) {
		case 'phone': {
			if (!outbound) return 'Inbound Call';
			// A dial-ladder leg is the SYSTEM ringing our own on-call staff — the person at the far
			// end is a technician, not the customer. That is a different origin from a rep calling
			// the customer back, so it must not borrow "Rep-bound number".
			if (meta.workOrder || meta.tech_name) return 'Dial ladder (system)';
			// "Rep-bound number" is the prototype's label for a named person calling out from their
			// OWN bound line. Only claim it when a human actually initiated the row: an
			// orchestrator-placed call has no `userId` and is not rep-bound.
			if (log?.userId || meta.rep_name) return 'Rep-bound number';
			return 'Outbound Call';
		}
		case 'sms':
			return outbound ? 'Outbound SMS (A2P)' : 'Inbound SMS';
		case 'email':
			return outbound ? 'Outbound Email (A2P)' : 'Inbound Email';
		case 'chat':
			return outbound ? 'Outbound Chat' : 'Inbound Chat';
		default: {
			// Web rows with no attribution, and anything else: `source_signal` still says something
			// ("viewroom", "web"); the medium words ("sms", "email") do not — the Channel says those.
			const signal = meta.source_signal ? String(meta.source_signal).toLowerCase() : '';
			if (signal && !MEDIUM_ONLY_SIGNALS.has(signal)) return String(meta.source_signal);
			return null;
		}
	}
}

const MEDIUM_ONLY_SIGNALS = new Set(['sms', 'email', 'voice', 'call', 'chat', 'chatbot']);

export function sourceChannelDetail(
	meta: Record<string, unknown>,
	log?: any,
	lineTypes?: Map<string, string>
): string | null {
	const a =
		(meta.attribution as {
			channel?: string;
			keyword?: string | null;
			referrer?: string | null;
			landingUrl?: string | null;
		} | null) ?? null;
	if (a?.channel) {
		if (a.keyword) return `kw "${a.keyword}"`;
		if (a.channel === 'direct') return 'no referrer';
		if (a.referrer) return `from ${a.referrer}`;
		if (a.channel === 'organic_google' || a.channel === 'organic_bing') return 'query not provided';
		return a.landingUrl ?? null;
	}

	if (!log) return null;
	const outbound = (log.direction ?? '').toString().toLowerCase() === 'outbound';

	// The specifics go here: the number or address at the other end on an inbound leg, and who sent
	// it on an outbound one. Never the label — the label is the provider channel.
	if (outbound) {
		// The dial ladder: name the rung, not a "rep". The technician's name is already the
		// Endpoint on these rows (see the loader's `tech_name (rung N)` handling).
		if (meta.workOrder || meta.tech_name) {
			return meta.rung ? `rung ${meta.rung}` : 'system dial';
		}
		// A real rep. The prototype shows "Dave R. · Sales" — the suffix is a team, and this schema
		// has no team field (UserRole is owner/admin/agent, which is permissions, not a department).
		// The IVR intent name IS a routing label ("Sales", "Support") but only exists where the call
		// carried one, so it is appended when present and simply omitted when not. Inventing a
		// department would be worse than a bare name.
		const rep = meta.rep_name || log.user?.name || log.user?.email || null;
		if (rep) {
			const team = meta.intentName || meta.intent_name || null;
			return team ? `${rep} · ${team}` : String(rep);
		}
		// The line it went out on. True, useful, and not a person.
		return log.source ? String(log.source) : null;
	}

	const from = log.source ? String(log.source) : null;
	if (log.callTrackingCategory?.name && from) return `tracking number · ${from}`;
	// The reference shows the LINE TYPE here — "+1 705 555 0155 · mobile" — which is where it
	// belongs: it qualifies the number, and it is the fact §4.3a turns the tier on. It does not
	// belong in the Who line, which has only three fixed strings.
	const customer = log.customer ?? log.communicationThread?.contact ?? null;
	const lt = lineTypeOf(customer, lineTypes);
	if (from && lt) return `${from} · ${lt.replace(/_/g, '-')}`;
	return from;
}

/**
 * Identity tier, per `specs/clearsky-identity-tiers-canonical.md` (LOCKED §4.3a, 2026-08-05).
 *
 *   Tier 1  a strong identifier that resolves ONE person: an email, or a number on a line
 *           exclusive to one person — i.e. a mobile.
 *   Tier 2  a weak identifier: a name or partial form field, OR a shared line (landline, VoIP,
 *           business, toll-free). "Lookup unavailable or failed -> 2. **Never default upward.**"
 *   Tier 2B zero identifiers — a real individual we have no way to reach.
 *
 * The old expression was `email || cell ? T1 : name ? T2 : T2B`, which got two things wrong:
 *
 *   1. A contact holding ONLY a phone number fell through to **2B — "Anonymous, device only"**.
 *      A phone number is an identifier; 2B means we hold none at all. That is how phone-only
 *      contacts came to be labelled anonymous.
 *   2. It never distinguished WHY a record is Tier 2, so every one of them read "Name / company
 *      only — person not confirmed", including records where we hold a phone number and no name.
 *
 * `lineType` is read from `metadata` when something has classified it. §4.3a Consequence 1 makes
 * that lookup (Telnyx Number Lookup) mandatory before a call can be tiered; nothing in this repo
 * performs it yet, so in practice numbers stay unclassified and stay Tier 2 — which is the
 * spec-correct outcome, never defaulting upward.
 */
export type IdentityTier = 'T1' | 'T2' | 'T2B';

export function identityTier(customer: any, lineTypes?: Map<string, string>): IdentityTier {
	if (!customer) return 'T2B';
	// An email address resolves one person.
	if (customer.email) return 'T1';
	// `cell` is the mobile field — a mobile is effectively one person (§4.3a table).
	if (customer.cell) return 'T1';
	// A number classified as a mobile. The authority is the `NumberLookup` cache that
	// `number-lookup.ts` writes (only successful classifications are stored), passed in as a map so
	// a page costs one query rather than one per row.
	if (customer.phone && lineTypeOf(customer, lineTypes) === 'mobile') return 'T1';
	// Any other number identifies a LINE, not a person — weak, but an identifier.
	if (customer.phone || customer.landline) return 'T2';
	if (customer.name) return 'T2';
	return 'T2B';
}

/** Last-10-digit key, so +1 / no-+1 / formatted variants all resolve to the same lookup row. */
export function lineTypeKey(phone: string | null | undefined): string {
	return (phone ?? '').replace(/\D/g, '').slice(-10);
}

function lineTypeOf(customer: any, lineTypes?: Map<string, string>): string {
	const fromMap = lineTypes?.get(lineTypeKey(customer?.phone));
	if (fromMap) return fromMap.toLowerCase();
	// Fallback for records that carry it inline (PipelineCustomerProfile does; Contact does not).
	return (customer?.metadata?.lineType ?? '').toString().toLowerCase();
}

/**
 * The "Who" line. Exactly three strings, taken verbatim from the reference log's `profileCell()`:
 *
 *   T1   Identified — name + email/phone
 *   T2   Name / company only — person not confirmed
 *   2B   Anonymous · fp_… — device only
 *
 * An earlier version invented per-reason wording here ("Line type unconfirmed — not resolved to
 * one person (§4.3a)"). That is not one of the three, and a spec section number does not belong in
 * an operator's log. The line type is shown where the reference shows it — in the Source DETAIL,
 * as "+1 705 555 0155 · mobile".
 */
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
	if (
		String(log.direction ?? '')
			.toLowerCase()
			.startsWith('out')
	)
		return false;

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
// `emergency` is the fourth, overriding intent bucket. Urgency evidence may remain in metadata, but
// the rendered buying read must never be `active` plus `emergency`.

const STAGES = new Set(['research', 'comparison', 'active', 'emergency']);

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

	// Emergency replaces any lower buying-stage read.
	const stage = emergency
		? 'emergency'
		: STAGES.has(rawBucket as string)
			? (rawBucket as string)
			: null;

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
	intentDescription: string | null;
	intentConfidence: string | null;
	intentEmergency: boolean;
	recordingUrl: string | null;
	isProcessing: boolean;
	isInternalNotice: boolean;
	journey: JourneyActivity;
}

/**
 * One query per page instead of one per row: collect the line types for every phone number on
 * these logs. §4.3a makes line type decisive for the identity tier, and `NumberLookup` is where
 * `number-lookup.ts` caches successful classifications.
 */
export async function loadLineTypes(prismaClient: any, logs: any[]): Promise<Map<string, string>> {
	const numbers = new Set<string>();
	for (const log of logs) {
		const c = log?.customer ?? log?.communicationThread?.contact ?? null;
		const raw = (c?.phone ?? '').toString().trim();
		if (raw) numbers.add(raw);
	}
	const map = new Map<string, string>();
	if (!numbers.size) return map;
	try {
		const rows = await prismaClient.numberLookup.findMany({
			where: { phoneNumber: { in: [...numbers] } },
			select: { phoneNumber: true, lineType: true }
		});
		for (const r of rows) map.set(lineTypeKey(r.phoneNumber), r.lineType);
	} catch (err: any) {
		// A tier that cannot be improved is still a valid tier — §4.3a says never default upward,
		// so a failed lookup simply leaves everyone where they are.
		console.error('[communication-surface] line-type load failed:', err?.message || err);
	}
	return map;
}

export function communicationSurface(
	log: any,
	lineTypes?: Map<string, string>
): CommunicationSurface {
	const meta = (log.metadata as Record<string, any>) || {};
	const thread = log.communicationThread ?? null;
	const customer = log.customer ?? thread?.contact ?? null;

	const tier = identityTier(customer, lineTypes);

	const profileFp = Array.isArray(customer?.metadata?.fingerprints)
		? (customer.metadata.fingerprints[0] ?? null)
		: typeof log.source === 'string' && /^[a-z0-9]{8,}$/i.test(log.source)
			? log.source
			: null;

	return {
		channelSource: sourceChannelLabel(meta, log),
		channelSourceDetail: sourceChannelDetail(meta, log, lineTypes),
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
		intentDescription: formatDescriptiveIntent(log),
		recordingUrl: recordingUrlFor(log),
		isProcessing: isStillProcessing(log),
		isInternalNotice: isInternalNotice(log),
		journey: journeyActivity(log)
	};
}

/**
 * Fill an interaction's blank intent fields from the ENGAGEMENT it belongs to.
 *
 * Stage, subtopic, confidence and the attribution source are facts about the conversation, not
 * about one message in it. Only the customer's own inbound messages produce them: an outbound
 * reply, a delivery receipt or a system notice has nothing of its own to report, so those rows
 * rendered a column of dashes next to a fully-populated inbound row in the same engagement.
 *
 * The fallback is per-engagement and takes the most recent row that actually knows, preferring
 * inbound rows — they are the ones carrying the customer's intent. Nothing is invented: if no row
 * in the engagement ever had a subtopic, it stays null and the caller shows "—".
 *
 * Runs over rows already loaded for the page, so it costs no extra queries.
 *
 * "Where they apply" — an outbound row keeps `intentStatus: 'n/a'` and `intentEmergency` as they
 * are. Those two are properties of the message, not the conversation.
 */
export function applyEngagementFallbacks<
	T extends {
		engagementId?: string | null;
		direction?: string | null;
		created?: Date | string | null;
		intentStage?: string | null;
		intentSubtopic?: string | null;
		intentDescription?: string | null;
		intentConfidence?: string | null;
		channelSource?: string | null;
		channelSourceDetail?: string | null;
		threadSubtopics?: string[];
	}
>(rows: T[]): T[] {
	type Known = {
		intentStage: string | null;
		intentSubtopic: string | null;
		intentDescription: string | null;
		intentConfidence: string | null;
		channelSource: string | null;
		channelSourceDetail: string | null;
	};
	const best = new Map<string, Known>();

	const time = (r: T) => (r.created ? new Date(r.created as any).getTime() : 0);
	// Oldest first, inbound last within a timestamp, so a later/inbound value overwrites an
	// earlier/outbound one and the map ends up holding the freshest thing that actually knows.
	const ordered = [...rows].sort((a, b) => {
		const d = time(a) - time(b);
		if (d !== 0) return d;
		return (a.direction === 'inbound' ? 1 : 0) - (b.direction === 'inbound' ? 1 : 0);
	});

	for (const row of ordered) {
		const key = row.engagementId;
		if (!key) continue;
		const cur = best.get(key) ?? {
			intentStage: null,
			intentSubtopic: null,
			intentDescription: null,
			intentConfidence: null,
			channelSource: null,
			channelSourceDetail: null
		};
		if (row.intentStage) cur.intentStage = row.intentStage;
		if (row.intentSubtopic) cur.intentSubtopic = row.intentSubtopic;
		if (row.intentDescription) cur.intentDescription = row.intentDescription;
		if (row.intentConfidence) cur.intentConfidence = row.intentConfidence;
		if (row.channelSource) cur.channelSource = row.channelSource;
		if (row.channelSourceDetail) cur.channelSourceDetail = row.channelSourceDetail;
		best.set(key, cur);
	}

	return rows.map((row) => {
		const known = row.engagementId ? best.get(row.engagementId) : undefined;
		// The engagement's own subtopic list is the last resort for a subtopic — it is the rollup
		// of every subject the episode has touched.
		const fromThread =
			Array.isArray(row.threadSubtopics) && row.threadSubtopics.length
				? row.threadSubtopics[row.threadSubtopics.length - 1]
				: null;
		// Attribution describes how the CUSTOMER arrived — it is a property of an inbound leg only.
		// Inheriting it onto an outbound row would claim we sent a message "from Google Ads", and
		// would also hide the number the message was actually sent from, which is what belongs in
		// an outbound Source (see the loader: outbound source = the company).
		const inbound = row.direction === 'inbound';
		return {
			...row,
			intentStage: row.intentStage ?? known?.intentStage ?? null,
			intentSubtopic: row.intentSubtopic ?? known?.intentSubtopic ?? fromThread ?? null,
			intentDescription: row.intentDescription ?? known?.intentDescription ?? null,
			intentConfidence: row.intentConfidence ?? known?.intentConfidence ?? null,
			channelSource: row.channelSource ?? (inbound ? (known?.channelSource ?? null) : null),
			channelSourceDetail:
				row.channelSourceDetail ?? (inbound ? (known?.channelSourceDetail ?? null) : null)
		};
	});
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
		meta.durationSec,
		meta.duration_seconds,
		meta.duration,
		meta.callDuration,
		meta.call_duration,
		log.durationSeconds,
		log.duration
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
	const outbound = String(log.direction ?? '')
		.toLowerCase()
		.startsWith('out');
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
			segments.push(
				seg('email + '),
				seg(`${atts.length} attachment${atts.length === 1 ? '' : 's'}`, true)
			);
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

	// Prefer `content` over `summary`. `summary` is a short LABEL — the orchestrator stores it as
	// `draftedResponse.substring(0, 40) + '...'` — so rendering it shows "Hi Elise, thanks for
	// reaching out to Tot...". The untruncated text is in `content`; the ellipsis was in the data,
	// not in this cell. No clipping here either: let the column wrap.
	const body = (log.content ?? '').toString().trim() || (log.summary ?? '').toString().trim();
	return { segments: [seg(body || '—')], full: '' };
}
