// Human-facing conversation code for the "COM ID" column.
//
// Requirements:
//  - Random-LOOKING (alphanumeric, e.g. "36DR") — never expose the raw phone number.
//  - Deterministic & STABLE: the same conversation (same customer phone) always maps to the
//    SAME code, so every call/SMS in that thread shares one COM ID.
//  - Different conversations map to different codes.
//
// We hash the customer's phone (FNV-1a) into a short base36 string. This is display-only, so a
// rare collision is harmless.

export function conversationCode(phone: string | null | undefined): string {
	const digits = (phone || '').replace(/\D/g, '').slice(-10);
	if (!digits) return '';
	let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
	for (let i = 0; i < digits.length; i++) {
		h ^= digits.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0)
		.toString(36)
		.toUpperCase()
		.padStart(5, '0')
		.slice(-5);
}
