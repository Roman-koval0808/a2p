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
	return (h >>> 0).toString(36).toUpperCase().padStart(5, '0').slice(-5);
}

/**
 * How long after a message is logged we treat it as "still resolving". Cross-channel threading
 * runs asynchronously (gmail sweep → outbound review → orchestrator), which in practice completes
 * within a minute or two. Past this window a row without a container is not pending — it simply
 * never got threaded, so we fall back to its legacy thread grouping rather than showing "Pending"
 * forever on historical rows.
 */
export const COMM_RESOLUTION_WINDOW_MS = 5 * 60 * 1000;

/**
 * COM code for a conversation.
 *
 * `containerRef` (a CommContainer's "#1234") is the real answer: it is set once cross-channel
 * threading has resolved, and every channel of the same conversation shares it. `threadId` is the
 * legacy per-thread grouping key (communicationThreadId).
 *
 * Returns '' — rendered as "Pending" — only while a freshly-logged message (within the resolution
 * window) has no container ref yet AND no threadId fallback.
 *
 * Past the resolution window, if neither commRef nor threadId exists, we fall back to the log's
 * own `id` so rows never stay "Pending" forever.
 */
export function commCode(
	threadId: string | null | undefined,
	containerRef?: string | null,
	createdAt?: Date | string | null,
	now: number = Date.now(),
	logId?: string | null
): string {
	const ref = (containerRef || '').trim();
	if (ref) return hash(ref);

	const key = (threadId || '').trim();

	if (createdAt) {
		const t = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
		if (!isNaN(t) && now - t < COMM_RESOLUTION_WINDOW_MS) {
			// Still within the resolution window — only show Pending if there's nothing at all
			return key ? hash(key) : '';
		}
	}

	// Past resolution window: threadId → hash of it; else fall back to logId → hash of it
	if (key) return hash(key);
	const fallback = (logId || '').trim();
	return fallback ? hash(fallback) : '';
}

/** True while a message is still resolving — render "Pending" instead of a code. */
export function isCommCodePending(
	threadId: string | null | undefined,
	containerRef?: string | null,
	createdAt?: Date | string | null,
	now: number = Date.now(),
	logId?: string | null
): boolean {
	return !commCode(threadId, containerRef, createdAt, now, logId);
}
