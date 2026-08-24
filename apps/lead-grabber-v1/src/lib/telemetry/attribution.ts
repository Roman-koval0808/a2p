// Deterministic traffic-source attribution. Parses referrer + UTM params once on
// page load and maps them onto the 12 canonical channels, with no network calls.

export interface Attribution {
	channel: string;
	source: string | null;
	medium: string | null;
	campaign: string | null;
	keyword: string | null;
	referrer: string | null;
	landingUrl: string | null;
}

const LLM_DOMAINS = [
	'chatgpt.com',
	'chat.openai.com',
	'perplexity.ai',
	'claude.ai',
	'gemini.google.com',
	'copilot.microsoft.com'
];

const YOUTUBE_DOMAINS = ['youtube.com', 'youtu.be', 'm.youtube.com'];

function hostOf(url: string | null): string | null {
	if (!url) return null;
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return null;
	}
}

function utm(qs: URLSearchParams, key: string): string | null {
	return qs.get(key)?.trim() || null;
}

/**
 * Resolve the canonical traffic channel from the browser's referrer and the current
 * URL's UTM parameters. Call this exactly once on load and cache the result.
 */
export function resolveAttribution(
	referrer: string | null,
	locationHref: string,
	locationSearch: string
): Attribution {
	let url: URL;
	try {
		url = new URL(locationHref);
	} catch {
		url = new URL('http://localhost');
	}

	const qs = new URLSearchParams(locationSearch);
	const source = utm(qs, 'utm_source');
	const medium = utm(qs, 'utm_medium');
	const campaign = utm(qs, 'utm_campaign');
	const keyword = utm(qs, 'utm_keyword') || utm(qs, 'utm_term');
	const content = utm(qs, 'utm_content');
	const gclid = utm(qs, 'gclid');

	const ref = referrer?.trim() || null;
	const refHost = hostOf(ref);

	let channel = 'direct';

	if (gclid) {
		channel = 'google_paid';
	} else if (source?.toLowerCase() === 'bing' || (medium === 'cpc' && refHost?.includes('bing'))) {
		channel = 'bing_paid';
	} else if (source?.toLowerCase() === 'google' || medium === 'organic') {
		channel = 'organic_google';
	} else if (source?.toLowerCase() === 'bing' && medium === 'organic') {
		channel = 'organic_bing';
	} else if (source?.toLowerCase() === 'facebook' || (medium === 'paid' && refHost?.includes('facebook'))) {
		channel = 'facebook_ad';
	} else if (YOUTUBE_DOMAINS.includes(refHost ?? '') && (medium === 'paid' || content === 'nonskip')) {
		channel = 'youtube_paid';
	} else if (YOUTUBE_DOMAINS.includes(refHost ?? '')) {
		channel = 'youtube_organic';
	} else if (refHost && LLM_DOMAINS.some((d) => refHost === d || refHost.endsWith(`.${d}`))) {
		channel = 'llm_referral';
	} else if (source?.toLowerCase() === 'gbp' || (refHost?.includes('google') && medium === 'gbp')) {
		channel = 'gbp_website_click';
	} else if (medium === 'qr' || content === 'qr' || (campaign ?? '').toLowerCase().includes('qr')) {
		channel = 'qr_code';
	} else if (refHost) {
		channel = 'referral';
	}

	return {
		channel,
		source,
		medium,
		campaign,
		keyword: channel === 'google_paid' ? keyword : channel === 'youtube_paid' ? keyword : null,
		referrer: refHost,
		landingUrl: `${url.pathname}${url.search}${url.hash}`
	};
}

export function captureBrowserAttribution(): Attribution | null {
	if (typeof window === 'undefined' || typeof document === 'undefined') return null;
	return resolveAttribution(
		document.referrer,
		window.location.href,
		window.location.search
	);
}
