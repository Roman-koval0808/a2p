// Human-facing "COM ID" for a conversation THREAD.
//
// Requirements:
//  - Random-LOOKING (short alphanumeric, e.g. "36DR") — never the phone number.
//  - Per-THREAD, not per-customer: every message linked into the same conversation thread shares
//    ONE code. A different context — even from the same customer — is a different thread and gets
//    a different code.
//  - Deterministic: the same thread id always hashes to the same code.
//
// The thread grouping itself is done upstream by the semantic thread-matcher, which sets
// communicationThreadId on related messages (and leaves a new topic on its own id). Here we just
// render whatever grouping key we're given as a stable, opaque code. Display-only, so a rare
// hash collision is harmless.

function hash(key: string): string {
	let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0)
		.toString(36)
		.toUpperCase()
		.padStart(5, '0')
		.slice(-5);
}

/**
 * COM code for a thread. `threadId` is the conversation's grouping key (communicationThreadId);
 * `fallbackId` is the message's own id, used as the thread anchor when it isn't linked to
 * anything yet (a brand-new conversation).
 */
export function commCode(threadId: string | null | undefined, fallbackId?: string | null): string {
	const key = (threadId || fallbackId || '').trim();
	return key ? hash(key) : '';
}
