// Deterministic signal catalog for the lead-grabber telemetry pipeline.
//
// Every signal the marketing site / viewroom can emit is declared here once, so the
// frontend tracker and the backend intake share one source of truth for names,
// categories and score deltas. Score deltas are deterministic and configurable; they
// are applied on intake and never routed through AI.

export type SignalCategory =
	| 'passive'
	| 'navigation'
	| 'call_emergency'
	| 'lead_form'
	| 'fotojobber'
	| 'visualizer'
	| 'viewroom'
	| 'financing'
	| 'chat'
	| 'faq'
	| 'blog'
	| 'reviews';

/**
 * Which intent bucket this signal argues for, per the Four Intent Buckets report §3.5 and the
 * reference site's `firePixel(event, label, delta, bkt)` calls.
 *
 * This is NOT a score band. Promotion is escalate-only and driven by the signal itself — see
 * `getNextBucket` in `$lib/server/profiledb/scoring.service`, which climbs a fixed ladder and
 * deliberately never consults the score. `friction`/`disengagement`/undefined never promote.
 */
export type BucketSignal = 'research' | 'comparison' | 'active' | 'conversion' | 'emergency';

export interface SignalDef {
	name: string;
	category: SignalCategory;
	scoreDelta: number;
	/**
	 * The bucket this signal argues for. Undefined means "does not promote" — the visitor keeps
	 * whatever bucket they already had. `page_load` is deliberately undefined: it carries no
	 * intent and a bounce must stay `unclassified` rather than being promoted to `research` by
	 * the mere act of loading a page.
	 */
	bucketSignal?: BucketSignal;
	/** Deterministic fields this signal is expected to carry in its payload. */
	payloadFields?: string[];
}

const s = (
	name: string,
	category: SignalCategory,
	scoreDelta: number,
	bucketSignal?: BucketSignal,
	payloadFields?: string[]
): SignalDef => ({ name, category, scoreDelta, bucketSignal, payloadFields });

export const SIGNAL_CATALOG: Record<string, SignalDef> = {
	// Passive (8)
	page_load: s('page_load', 'passive', 0, undefined, ['url', 'title']),
	scroll_25: s('scroll_25', 'passive', 3, 'research'),
	scroll_50: s('scroll_50', 'passive', 5, 'research'),
	scroll_75: s('scroll_75', 'passive', 7, 'comparison'),
	scroll_90: s('scroll_90', 'passive', 10, 'comparison'),
	dwell_30: s('dwell_30', 'passive', 4, 'research'),
	dwell_60: s('dwell_60', 'passive', 7, 'comparison'),
	dwell_120: s('dwell_120', 'passive', 10, 'comparison'),

	// Navigation & interest (17)
	nav_book: s('nav_book', 'navigation', 12, 'active'),
	nav_emergency: s('nav_emergency', 'navigation', 15, 'emergency'),
	svc_click: s('svc_click', 'navigation', 8, 'active', ['service']),
	svc_hover: s('svc_hover', 'navigation', 4, 'research', ['service']),
	tool_click: s('tool_click', 'navigation', 8, 'research', ['tool']),
	hero_cta_click: s('hero_cta_click', 'navigation', 12, 'active'),
	hero_services_click: s('hero_services_click', 'navigation', 8, 'research'),
	related_click: s('related_click', 'navigation', 6, 'active'),
	problem_click: s('problem_click', 'navigation', 10, 'research', ['problem']),
	area_click: s('area_click', 'navigation', 6, 'research', ['area']),
	area_card_click: s('area_card_click', 'navigation', 8, 'comparison', ['area']),
	mkt_cta_click: s('mkt_cta_click', 'navigation', 8, 'research'),
	persona_pick: s('persona_pick', 'navigation', 10, 'research', ['persona']),
	gallery_filter: s('gallery_filter', 'navigation', 6, 'research', ['filter']),
	blog_filter: s('blog_filter', 'navigation', 4, 'research', ['filter']),
	blog_post_open: s('blog_post_open', 'navigation', 8, 'research', ['postId']),
	review_filter: s('review_filter', 'navigation', 6, 'research', ['filter']),

	// Call & emergency intent (14)
	hero_call: s('hero_call', 'call_emergency', 15, 'active'),
	hero_call_click: s('hero_call_click', 'call_emergency', 15, 'active'),
	cta_call: s('cta_call', 'call_emergency', 15, 'active'),
	cta_call_click: s('cta_call_click', 'call_emergency', 15, 'active'),
	emergency_cta: s('emergency_cta', 'call_emergency', 20, 'emergency'),
	emg_call: s('emg_call', 'call_emergency', 20, 'active'),
	emg_type_click: s('emg_type_click', 'call_emergency', 18, 'active', ['emergencyType']),
	call_click_hero: s('call_click_hero', 'call_emergency', 15, 'active'),
	call_click_sidebar: s('call_click_sidebar', 'call_emergency', 15, 'active'),
	sidebar_call: s('sidebar_call', 'call_emergency', 15, 'active'),
	notsure_call: s('notsure_call', 'call_emergency', 12, 'active'),
	callback_open: s('callback_open', 'call_emergency', 15, 'active'),
	callback_form_open: s('callback_form_open', 'call_emergency', 15, 'active'),
	callback_submit: s('callback_submit', 'call_emergency', 25, 'active'),

	// Lead & form (13)
	lg_open: s('lg_open', 'lead_form', 8, 'active'),
	lg_submit: s('lg_submit', 'lead_form', 15, 'active'),
	form_name_focus: s('form_name_focus', 'lead_form', 6, 'active'),
	form_email_focus: s('form_email_focus', 'lead_form', 8, 'active'),
	form_phone_focus: s('form_phone_focus', 'lead_form', 10, 'active'),
	form_submit: s('form_submit', 'lead_form', 20, 'conversion'),
	apt_name_focus: s('apt_name_focus', 'lead_form', 6, 'active'),
	apt_phone_focus: s('apt_phone_focus', 'lead_form', 10, 'active'),
	apt_service_select: s('apt_service_select', 'lead_form', 10, 'active', ['service']),
	apt_submit: s('apt_submit', 'lead_form', 25, 'active'),
	cta_book: s('cta_book', 'lead_form', 15, 'active'),
	spl_claim_click: s('spl_claim_click', 'lead_form', 10, 'active'),
	spl_apt_submit: s('spl_apt_submit', 'lead_form', 25, 'active'),

	// FotoJobber photo-quote tool (14)
	fj_name_focus: s('fj_name_focus', 'fotojobber', 6, 'active'),
	fj_phone_focus: s('fj_phone_focus', 'fotojobber', 10, 'active'),
	fj_note_focus: s('fj_note_focus', 'fotojobber', 4, 'active'),
	fj_service_select: s('fj_service_select', 'fotojobber', 10, 'active', ['service']),
	fj_photo: s('fj_photo', 'fotojobber', 8, 'active'),
	fj_photo_click: s('fj_photo_click', 'fotojobber', 8, 'active'),
	fj_photo_upload: s('fj_photo_upload', 'fotojobber', 12, 'active'),
	fj_submit: s('fj_submit', 'fotojobber', 25, 'active'),
	fj_voice_start: s('fj_voice_start', 'fotojobber', 8, 'active'),
	fj_voice_stop: s('fj_voice_stop', 'fotojobber', 8, 'active'),
	fj_voice_transcribed: s('fj_voice_transcribed', 'fotojobber', 12, 'active'),
	fj_annotation_saved: s('fj_annotation_saved', 'fotojobber', 10, 'active'),
	fj_access_granted: s('fj_access_granted', 'fotojobber', 6, 'active'),
	fj_access_denied: s('fj_access_denied', 'fotojobber', 6, 'active'),

	// Visualizer tool (9)
	viz_fixture_select: s('viz_fixture_select', 'visualizer', 8, 'comparison', ['fixture']),
	viz_style_select: s('viz_style_select', 'visualizer', 8, 'comparison', ['style']),
	viz_transform: s('viz_transform', 'visualizer', 8, 'active'),
	viz_result: s('viz_result', 'visualizer', 10, 'active'),
	viz_result_save: s('viz_result_save', 'visualizer', 12, 'active'),
	viz_save_open: s('viz_save_open', 'visualizer', 6, 'active'),
	viz_save_skip: s('viz_save_skip', 'visualizer', 6, 'active'),
	viz_photo_upload: s('viz_photo_upload', 'visualizer', 12, 'active'),
	design_style_pick: s('design_style_pick', 'visualizer', 8, 'active', ['style']),

	// ViewRoom tool (8)
	vr_entry: s('vr_entry', 'viewroom', 10, 'active', ['roomId', 'roomTitle']),
	vr_name_focus: s('vr_name_focus', 'viewroom', 6, 'comparison'),
	vr_phone_focus: s('vr_phone_focus', 'viewroom', 10, 'active'),
	vr_interest_select: s('vr_interest_select', 'viewroom', 10, 'comparison', ['interest']),
	vr_guestname: s('vr_guestname', 'viewroom', 8, 'comparison', ['guestName']),
	vr_repinvite: s('vr_repinvite', 'viewroom', 12, 'comparison', ['repId']),
	vr_tasks: s('vr_tasks', 'viewroom', 8, 'comparison', ['task']),
	vr_video_watch: s('vr_video_watch', 'viewroom', 6, 'comparison', ['videoId']),

	// Before/after & financing (3)
	ba_slider_drag: s('ba_slider_drag', 'financing', 6, 'comparison'),
	fin_plan_view: s('fin_plan_view', 'financing', 10, 'comparison'),
	financing_guide_download: s('financing_guide_download', 'financing', 12, 'comparison'),

	// Chat (3)
	chat_open: s('chat_open', 'chat', 8, 'research'),
	chat_question: s('chat_question', 'chat', 12, 'research'),
	chat_q: s('chat_q', 'chat', 12, 'comparison'),

	// FAQ (5)
	faq_expand: s('faq_expand', 'faq', 4, 'research', ['faqId']),
	faq_search: s('faq_search', 'faq', 6, 'research', ['query']),
	faq_click: s('faq_click', 'faq', 6, 'research', ['faqId']),
	faq_question_submit: s('faq_question_submit', 'faq', 10, 'research'),
	faq_still_focus: s('faq_still_focus', 'faq', 6, 'research'),

	// Blog & question boxes (6)
	blog_q_focus: s('blog_q_focus', 'blog', 6, 'research'),
	blog_question_submit: s('blog_question_submit', 'blog', 10, 'research'),
	post_q_focus: s('post_q_focus', 'blog', 6, 'research'),
	post_question_submit: s('post_question_submit', 'blog', 10, 'research'),
	sidebar_q_focus: s('sidebar_q_focus', 'blog', 6, 'research'),
	sidebar_question_submit: s('sidebar_question_submit', 'blog', 10, 'research'),

	// Reviews (2)
	write_review: s('write_review', 'reviews', 15, 'comparison'),
	write_review_nav: s('write_review_nav', 'reviews', 8, 'comparison')
};

export const VIEWROOM_SIGNALS = Object.values(SIGNAL_CATALOG).filter(
	(d) => d.category === 'viewroom'
);

export function getSignal(name: string): SignalDef | undefined {
	return SIGNAL_CATALOG[name];
}

export function isKnownSignal(name: string): boolean {
	return name in SIGNAL_CATALOG;
}

/** Human-readable label for a signal, e.g. `dwell_30` → "dwell 30s", `scroll_50` → "scroll 50%". */
export function humanizeSignal(name: string): string {
	const specials: Record<string, string> = {
		page_load: 'page load',
		scroll_25: 'scroll 25%',
		scroll_50: 'scroll 50%',
		scroll_75: 'scroll 75%',
		scroll_90: 'scroll 90%',
		dwell_30: 'dwell 30s',
		dwell_60: 'dwell 60s',
		dwell_120: 'dwell 2m',
		vr_entry: 'vr entry',
		vr_name_focus: 'vr name focus',
		vr_phone_focus: 'vr phone focus',
		vr_interest_select: 'vr interest',
		vr_guestname: 'vr guest name',
		vr_repinvite: 'vr rep invite',
		vr_tasks: 'vr tasks',
		vr_video_watch: 'vr video watch'
	};
	return specials[name] || name.replace(/_/g, ' ');
}

export type SignalName = keyof typeof SIGNAL_CATALOG;

export type SignalPayload = Record<string, unknown>;

export interface TelemetrySignal {
	name: string;
	occurredAt?: string;
	payload?: SignalPayload;
}
