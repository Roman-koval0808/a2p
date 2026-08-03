import { describe, it, expect } from 'vitest';
import { commCode, isCommCodePending, COMM_RESOLUTION_WINDOW_MS } from './comm-id';

const NOW = new Date('2026-08-03T18:15:00Z').getTime();
const secondsAgo = (s: number) => new Date(NOW - s * 1000);

describe('commCode', () => {
	it('uses the container ref once threading has resolved', () => {
		const code = commCode('thread_abc', '#5284', secondsAgo(5), NOW);
		expect(code).not.toBe('');
		// Every channel of the conversation hashes the same ref, so they share one code.
		expect(commCode('other_thread', '#5284', secondsAgo(900), NOW)).toBe(code);
	});

	it('is pending while a fresh row has no container ref yet', () => {
		// The pipeline stamps a communicationThreadId within seconds of arrival — long before
		// threading resolves — so a code derived from it would change moments later.
		expect(commCode('thread_abc', null, secondsAgo(5), NOW)).toBe('');
		expect(isCommCodePending('thread_abc', null, secondsAgo(5), NOW)).toBe(true);
	});

	it('falls back to the thread grouping once the resolution window has passed', () => {
		const old = new Date(NOW - COMM_RESOLUTION_WINDOW_MS - 1000);
		expect(commCode('thread_abc', null, old, NOW)).not.toBe('');
		expect(isCommCodePending('thread_abc', null, old, NOW)).toBe(false);
	});

	it('never leaves historical rows stuck on "Pending"', () => {
		// No createdAt at all (legacy callers) must not force the pending state.
		expect(commCode('thread_abc', null)).not.toBe('');
	});

	it('is pending when there is nothing to anchor on', () => {
		expect(commCode(null, null, secondsAgo(5), NOW)).toBe('');
		expect(commCode(null, null, secondsAgo(9999), NOW)).toBe('');
	});

	it('is deterministic and 5 chars', () => {
		const a = commCode(null, '#5284');
		expect(a).toBe(commCode(null, '#5284'));
		expect(a).toHaveLength(5);
	});
});
