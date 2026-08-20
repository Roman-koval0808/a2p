// CDN-free local fingerprint. Deterministic per browser/device, no network, no canvas
// (Firefox ETP randomizes canvas reads, so canvas is unusable there). Mirrored 1:1 in
// clearsky-website/src/lib/telemetry/client.js — keep both in sync.
//
// Returns 12 hex chars to match the FingerprintJS id shape the pipeline expects.

export function localFingerprint(): string {
	const nav = navigator as Navigator & { deviceMemory?: number };
	const parts = [
		nav.userAgent || '',
		nav.language || '',
		Array.isArray(nav.languages) ? nav.languages.join(',') : '',
		nav.platform || '',
		String(nav.hardwareConcurrency ?? ''),
		String(nav.deviceMemory ?? ''),
		String(window.screen?.width ?? ''),
		String(window.screen?.height ?? ''),
		String(window.screen?.colorDepth ?? ''),
		Intl.DateTimeFormat().resolvedOptions().timeZone || '',
		String(new Date().getTimezoneOffset())
	];
	const seed = parts.join('|');
	// Two-lane 32-bit FNV-1a so the 12-hex id mixes both lanes.
	let h1 = 0x811c9dc5;
	let h2 = 0x01000193;
	for (let i = 0; i < seed.length; i++) {
		const c = seed.charCodeAt(i);
		h1 ^= c;
		h1 = Math.imul(h1, 0x01000193);
		h2 ^= c;
		h2 = Math.imul(h2, 0x85ebca6b);
	}
	const hex = (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
	return hex.slice(0, 12);
}

/**
 * Resolve a stable visitor fingerprint synchronously: `?fp=` first, then stored ids,
 * then the local fallback (which is persisted so the marketing site and the viewroom
 * converge on the same id without needing the FingerprintJS CDN).
 */
export function readFingerprint(): string | null {
	if (typeof window === 'undefined') return null;
	try {
		const qs = new URLSearchParams(window.location.search);
		const stored =
			window.localStorage.getItem('fingerprintId') ||
			window.localStorage.getItem('fingerprint') ||
			window.localStorage.getItem('fp');
		if (qs.get('fp') || stored) return qs.get('fp') || stored;
		const fp = localFingerprint();
		window.localStorage.setItem('fingerprintId', fp);
		return fp;
	} catch {
		return null;
	}
}