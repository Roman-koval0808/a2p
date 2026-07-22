/**
 * Normalizes a phone number for dialing by removing formatting but keeping the + sign.
 * For US numbers starting with +1, removes the country code (1) if present.
 *
 * @param phone - The phone number to normalize (e.g., "+1 (123) 4567 890")
 * @returns The normalized phone number (e.g., "+1234567890")
 */
export function normalizePhoneNumber(phone: string): string {
	if (!phone) return '';

	// Trim whitespace
	let normalized = phone.trim();

	// If it starts with +, keep it and remove all non-digit chars after (preserve E.164)
	if (normalized.startsWith('+')) {
		const digits = normalized.slice(1).replace(/\D/g, '');
		normalized = '+' + digits;
	} else {
		// Otherwise, remove all non-digit chars
		normalized = normalized.replace(/\D/g, '');
	}

	return normalized;
}

/**
 * Extract a North-American callback number a customer spoke/wrote in a message and return it as
 * E.164, e.g. "...give me a call, 705-264-2251" -> "+17052642251". Returns null if there's no
 * plausible 10/11-digit number. Used so a "call me back" reply dials the number they LEFT, which
 * may differ from the line they called from (blocked caller-ID, calling on someone else's phone).
 */
export function extractCallbackNumber(text: string | null | undefined): string | null {
	if (!text) return null;
	// Match 10 digits, optionally led by a 1/+1, with common separators (space, dash, dot, parens).
	const re = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/g;
	let best: string | null = null;
	for (const m of text.matchAll(re)) {
		// Reject if the surrounding run has more digits than a phone number (e.g. an order id).
		const candidate = `+1${m[1]}${m[2]}${m[3]}`;
		best = candidate; // last match wins — people usually state the number near the end
	}
	return best;
}

/**
 * Formats a phone number for display (e.g., "70543234123" -> "+1 (705) 4323 4123")
 *
 * @param phone - The phone number to format
 * @returns The formatted phone number for display
 */
export function formatPhoneNumber(phone: string): string {
	if (!phone) return '';
	// Remove all non-digit characters
	const digits = phone.replace(/\D/g, '');
	// Format: +1 (XXX) XXXX XXXX
	if (digits.length === 11 && digits.startsWith('1')) {
		const area = digits.slice(1, 4);
		const part1 = digits.slice(4, 8);
		const part2 = digits.slice(8);
		return `+1 (${area}) ${part1} ${part2}`;
	} else if (digits.length === 10) {
		const area = digits.slice(0, 3);
		const part1 = digits.slice(3, 7);
		const part2 = digits.slice(7);
		return `+1 (${area}) ${part1} ${part2}`;
	}
	return phone;
}

/**
 * Formats a phone number for dialing (E.164 format with country code)
 * Ensures the number starts with + and has country code
 *
 * @param phone - The phone number to format for dialing
 * @returns The phone number in E.164 format (e.g., "+17059800835")
 */
export function formatPhoneForDialing(phone: string): string {
	if (!phone) return '';
	// Remove all non-digit characters
	const cleanedPhone = phone.replace(/\D/g, '');
	// For US numbers, ensure +1 prefix
	if (cleanedPhone.startsWith('1') && cleanedPhone.length === 11) {
		return `+${cleanedPhone}`;
	} else if (cleanedPhone.length === 10) {
		return `+1${cleanedPhone}`;
	} else if (cleanedPhone.length > 0) {
		return `+${cleanedPhone}`;
	}
	return phone;
}
