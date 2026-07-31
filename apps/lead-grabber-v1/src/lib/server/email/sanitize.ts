/**
 * Cleans raw email body text before it is stored or handed to the AI.
 *
 * Strips tracking / marketing boilerplate (Mailtrack / Mailsuite notifications,
 * opt-out and unsubscribe links, ad click-trackers, image markers) and cuts
 * quoted forwarding history so the newest message is what the AI sees.
 *
 * The email itself is never hidden — it is only cleaned. When sanitizing would
 * gut a message entirely, a conservative fallback keeps the readable parts.
 */

const TRACKER_PATTERNS: RegExp[] = [
	/\[image:[^\]]*\]/gi,
	/^\s*Sender notified with Mail(track|suite).*$/gim,
	/^\s*Opt out.*$/gim,
	/^\s*(Why this ad\?|Read this on the web).*$/gim,
	/^\s*https?:\/\/(u\.list-preferences\.com|securepubads\.g\.doubleclick\.net|bundle\.villagemedia\.ca)\/\S*.*$/gim,
	/^\s*[^\n]*(update your preferences|unsubscribe from this list|change how you receive these emails)[^\n]*$/gim
];

const QUOTE_MARKER = /\n\s*(On\s+[^\n]*?\bwrote:|Original Message\s*[-:]*\s*$|From:\s+[^\n]*?(Sent|sent):)/;

/** A marketing blast (newsletter etc.) — many distinct URLs pointing off-domain. */
export function isMarketingBlast(text: string | null | undefined): boolean {
	if (!text) return false;
	return (text.match(/https?:\/\//g) || []).length >= 10;
}

function stripTrackers(text: string): string {
	return TRACKER_PATTERNS.reduce((acc, re) => acc.replace(re, ''), text);
}

export function sanitizeEmailBody(text: string): string {
	if (!text) return text;

	let cleaned = stripTrackers(text);

	// Cut forwarded / quoted history — keep the newest message only.
	const quoteIdx = cleaned.search(QUOTE_MARKER);
	if (quoteIdx >= 0) {
		cleaned = cleaned.slice(0, quoteIdx);
	}

	// Newsletter blasts (many distinct URLs): strip URL-only lines and "(url)" labels.
	if (isMarketingBlast(cleaned)) {
		cleaned = cleaned
			.replace(/\(https?:\/\/[^\s)]*\)/g, '')
			.split('\n')
			.filter((line) => !/^\s*https?:\/\//.test(line))
			.join('\n');
	}

	cleaned = cleaned.replace(/\n{2,}/g, '\n\n').trim();

	// If the quote-cut consumed the ENTIRE body (e.g. a pure forward with no
	// top message), keep the readable top lines so nothing is ever hidden —
	// just tracker-stripped.
	if (!cleaned && quoteIdx >= 0) {
		return stripTrackers(text)
			.split('\n')
			.filter((line) => line.trim().length > 0)
			.slice(0, 3)
			.join('\n');
	}

	return cleaned;
}
