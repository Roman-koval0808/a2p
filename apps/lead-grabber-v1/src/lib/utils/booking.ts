// Self-service booking link (Google Calendar Appointment Schedule / Calendly).
//
// Stored per-company inside Company.settings.booking_url (the existing JSON column) so no DB
// migration is needed — it works the moment the code deploys. The owner pastes their public
// booking-page URL in Company settings; Google/Calendly handles availability, both-sides booking,
// reminders and cancellation. We just send the link and can embed the page.

/** Safely read the configured booking URL from a company row (settings may be an object or a JSON string). */
export function getBookingUrl(company: any): string | null {
	let s = company?.settings;
	if (typeof s === 'string') {
		try {
			s = JSON.parse(s);
		} catch {
			s = null;
		}
	}
	const raw = s?.booking_url ?? s?.bookingUrl ?? s?.bookingLink ?? null;
	const url = typeof raw === 'string' ? raw.trim() : '';
	return url.startsWith('http') ? url : null;
}

/**
 * Deep-link our /book page with a requested time (?t=) and/or the customer's name (?n=) so the
 * page opens pre-selected on that slot with the name prefilled. Only applied to our own booking
 * page; third-party links (Calendly, Google) are left untouched.
 */
export function bookingLinkWith(
	url: string,
	opts: { time?: string | null; name?: string | null }
): string {
	if (!url || !url.includes('/book/')) return url;
	const params = new URLSearchParams();
	if (opts.time && opts.time.trim()) params.set('t', opts.time.trim());
	if (opts.name && opts.name.trim()) params.set('n', opts.name.trim());
	const qs = params.toString();
	if (!qs) return url;
	return url + (url.includes('?') ? '&' : '?') + qs;
}

/**
 * Google Appointment Schedule pages send X-Frame-Options/CSP that block a plain <iframe>; their
 * embeddable variant needs `?gv=true` (the same URL Google's "Get embed code" produces).
 */
export function toEmbedUrl(url: string | null | undefined): string {
	const u = (url || '').trim();
	if (!u) return '';
	if (/calendar\.google\.com/.test(u) && !/[?&]gv=true/.test(u)) {
		return u + (u.includes('?') ? '&' : '?') + 'gv=true';
	}
	return u;
}
