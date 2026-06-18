interface PendingCall {
	id: string;
	name: string;
	phone: string;
	callId: string;
	timestamp: number;
}

// In-memory store for pending calls
const pendingCalls = new Map<string, PendingCall>();
const cleanupTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

// Configuration constants
const MAX_PENDING_CALLS = 100; // Maximum number of pending calls
const CALL_TIMEOUT_MS = 30000; // 30 seconds auto-cleanup

// Cache the oldest call ID for O(1) retrieval
let oldestCallId: string | null = null;

function updateOldestCallId() {
	if (pendingCalls.size === 0) {
		oldestCallId = null;
		return;
	}

	let oldest: PendingCall | null = null;
	let oldestId: string | null = null;

	for (const [id, call] of pendingCalls.entries()) {
		if (!oldest || call.timestamp < oldest.timestamp) {
			oldest = call;
			oldestId = id;
		}
	}

	oldestCallId = oldestId;
}

export function addPendingCall(call: Omit<PendingCall, 'id' | 'timestamp'>) {
	// Enforce max size to prevent unbounded growth
	if (pendingCalls.size >= MAX_PENDING_CALLS) {
		// Remove oldest call if at capacity
		if (oldestCallId) {
			removePendingCall(oldestCallId);
		} else {
			// Fallback: remove first entry
			const firstEntry = pendingCalls.entries().next().value;
			if (firstEntry) {
				removePendingCall(firstEntry[0]);
			}
		}
	}

	const id = Math.random().toString(36).substring(7);
	const timestamp = Date.now();
	const pendingCall: PendingCall = {
		...call,
		id,
		timestamp
	};

	pendingCalls.set(id, pendingCall);

	// Update oldest call tracking (O(1) when not oldest, O(n) only when needed)
	if (
		oldestCallId === null ||
		timestamp < (pendingCalls.get(oldestCallId)?.timestamp ?? Infinity)
	) {
		oldestCallId = id;
	}

	// Clear any existing timeout for this ID (safety measure)
	const existingTimeout = cleanupTimeouts.get(id);
	if (existingTimeout) {
		clearTimeout(existingTimeout);
	}

	// Set cleanup timeout and track it
	const timeout = setTimeout(() => {
		cleanupTimeouts.delete(id);
		if (pendingCalls.has(id)) {
			pendingCalls.delete(id);

			// Update oldest call tracking if we removed the oldest
			if (oldestCallId === id) {
				updateOldestCallId();
			}
		}
	}, CALL_TIMEOUT_MS);

	cleanupTimeouts.set(id, timeout);

	return id;
}

export function getPendingCall(): PendingCall | null {
	// O(1) retrieval using cached oldest call
	if (!oldestCallId || !pendingCalls.has(oldestCallId)) {
		// Oldest call was removed, recalculate
		updateOldestCallId();
		if (!oldestCallId) {
			return null;
		}
	}

	return pendingCalls.get(oldestCallId) ?? null;
}

export function removePendingCall(id: string): boolean {
	if (!pendingCalls.has(id)) {
		return false;
	}

	// Clear the cleanup timeout to prevent memory leak
	const timeout = cleanupTimeouts.get(id);
	if (timeout) {
		clearTimeout(timeout);
		cleanupTimeouts.delete(id);
	}

	// Update oldest call tracking if we removed the oldest
	const wasOldest = oldestCallId === id;
	const removed = pendingCalls.delete(id);

	if (removed && wasOldest) {
		updateOldestCallId();
	}

	return removed;
}

export function clearAllPendingCalls() {
	const count = pendingCalls.size;

	// Clear all timeouts to prevent memory leaks
	for (const timeout of cleanupTimeouts.values()) {
		clearTimeout(timeout);
	}

	cleanupTimeouts.clear();
	pendingCalls.clear();
	oldestCallId = null;

	return count;
}
