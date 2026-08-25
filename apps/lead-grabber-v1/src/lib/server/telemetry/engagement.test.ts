import { describe, it, expect } from 'vitest';
import {
	resolveEngagementThread,
	deriveIntentStatus,
	isPaidAdChannel,
	subtopicFromUrl,
	normalizeSubtopic,
	engagementWindowDays,
	accumulateSubtopicScores,
	rollupScore,
	capTotal,
	subtopicForSignal,
	UNKNOWN_SUBTOPIC,
	pathnameOf
} from './engagement';

describe('resolveEngagementThread — evidence before time', () => {
	it('reuses the contact active/open thread whatever the subtopic', () => {
		const r = resolveEngagementThread({
			openThread: { id: 'T1', status: 'open', subtopics: ['furnace'], updated: new Date() }
		});
		expect(r.decision).toBe('open');
		expect(r.threadId).toBe('T1');
		expect(r.reason).toBe('active_open_thread');
	});

	it('does not fork on subtopic change: a drain call still lands on the furnace thread', () => {
		// Rule 2 ignores the incoming subtopic entirely — the decision only sees the open thread.
		const r = resolveEngagementThread({
			openThread: { id: 'T1', status: 'open', subtopics: ['furnace'], updated: new Date() }
		});
		expect(r.threadId).toBe('T1');
	});

	it('reuses the most recent thread within its window', () => {
		const updated = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
		const r = resolveEngagementThread({
			recentThread: { id: 'T2', status: 'closed', subtopics: ['bathroom'], updated }
		});
		expect(r.decision).toBe('recent');
		expect(r.threadId).toBe('T2');
	});

	it('opens a new thread when the window has lapsed', () => {
		const updated = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000); // 200 days ago
		const r = resolveEngagementThread({
			recentThread: { id: 'T2', status: 'closed', subtopics: ['bathroom'], updated }
		});
		expect(r.decision).toBe('new');
	});

	it('a bare return with no detectable subject still reuses the open thread (Bug B)', () => {
		// No subject here is represented by there being no explicit ref and the open thread winning.
		const r = resolveEngagementThread({
			openThread: { id: 'T1', status: 'open', subtopics: [], updated: new Date() }
		});
		expect(r.decision).toBe('open');
	});

	// The roadmap's acceptance list: "Same contact returns after the window -> new T2". Nothing
	// ever sets a thread to `closed`, so testing `status != 'closed'` alone kept every engagement
	// alive for ever. The window applies to the open thread too.
	it('opens a new engagement when the OPEN thread has been silent past its window', () => {
		const updated = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000); // 200 days
		const r = resolveEngagementThread({
			openThread: { id: 'T1', status: 'open', subtopics: ['drain'], updated }, // 30d window
			recentThread: { id: 'T1', status: 'open', subtopics: ['drain'], updated }
		});
		expect(r.decision).toBe('new');
		expect(r.reason).toBe('no_open_thread_or_window_lapsed');
		// and the caller is told to retire the stale one
		expect(r.closeThreadId).toBe('T1');
	});

	it('a long renovation stays active well past a repair window', () => {
		const updated = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days
		const r = resolveEngagementThread({
			openThread: { id: 'T1', status: 'open', subtopics: ['drain', 'roof'], updated } // 180d
		});
		expect(r.decision).toBe('open');
		expect(r.threadId).toBe('T1');
		expect(r.closeThreadId).toBeUndefined();
	});

	it('an emergency lapses after a week', () => {
		const updated = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days
		const r = resolveEngagementThread({
			openThread: { id: 'T1', status: 'open', subtopics: ['emergency'], updated } // 7d
		});
		expect(r.decision).toBe('new');
		expect(r.closeThreadId).toBe('T1');
	});

	it('does not ask to retire anything when it simply had no thread to reuse', () => {
		const r = resolveEngagementThread({});
		expect(r.decision).toBe('new');
		expect(r.closeThreadId).toBeUndefined();
	});

	it('prefers the explicit reference above an open thread', () => {
		const r = resolveEngagementThread({
			explicitThreadId: 'ENG-404',
			openThread: { id: 'T1', status: 'open', subtopics: [], updated: new Date() }
		});
		expect(r.decision).toBe('explicit');
		expect(r.threadId).toBe('ENG-404');
	});
});

describe('engagementWindowDays — longest window wins', () => {
	it('a quick repair (drain, 30d) does not close an active renovation (bathroom, 180d)', () => {
		expect(engagementWindowDays(['drain'])).toBe(30);
		expect(engagementWindowDays(['bathroom'])).toBe(180);
		expect(engagementWindowDays(['drain', 'bathroom'])).toBe(180);
	});

	it('defaults to the standard window for unknown subtopics', () => {
		expect(engagementWindowDays([])).toBe(30);
	});
});

describe('deriveIntentStatus — source-aware (Bug A)', () => {
	it('organic browse is behaviour_inferred, never ad_indicated', () => {
		expect(
			deriveIntentStatus({
				direction: 'inbound',
				declaredIdentifier: false,
				isPaidAd: false,
				hasBehaviour: true
			})
		).toBe('behaviour_inferred');
	});

	it('a real paid ad with no message is ad_indicated', () => {
		expect(
			deriveIntentStatus({
				direction: 'inbound',
				declaredIdentifier: false,
				isPaidAd: true,
				hasBehaviour: false
			})
		).toBe('ad_indicated');
	});

	it('a declared identity outranks the ad hypothesis', () => {
		expect(
			deriveIntentStatus({
				direction: 'inbound',
				declaredIdentifier: true,
				isPaidAd: true,
				hasBehaviour: true
			})
		).toBe('declared');
	});

	it('outbound has no intent of its own', () => {
		expect(
			deriveIntentStatus({
				direction: 'outbound',
				declaredIdentifier: false,
				isPaidAd: false,
				hasBehaviour: false
			})
		).toBe('n/a');
	});

	it('just landed with no behaviour is source_indicated', () => {
		expect(
			deriveIntentStatus({
				direction: 'inbound',
				declaredIdentifier: false,
				isPaidAd: false,
				hasBehaviour: false
			})
		).toBe('source_indicated');
	});
});

describe('subtopic attribution', () => {
	it('maps service URLs to subtopic keys', () => {
		expect(subtopicFromUrl('/services/drains')).toBe('drain');
		expect(subtopicFromUrl('/bathroom-renovations')).toBe('bathroom');
		expect(subtopicFromUrl('/furnace-replacement')).toBe('furnace');
	});

	it('normalizes free text to a slug', () => {
		expect(normalizeSubtopic('  Bathroom Renovation! ')).toBe('bathroom_renovation');
	});

	it('recognises paid-ad channels', () => {
		expect(isPaidAdChannel('google_paid')).toBe(true);
		expect(isPaidAdChannel('organic_google')).toBe(false);
		expect(isPaidAdChannel(null)).toBe(false);
	});
});

describe('per-subtopic scoring', () => {
	it('matches the worked example: 20 bathroom + 30 kitchen = 50 total', () => {
		const scores = accumulateSubtopicScores({}, { kitchen: 20, bathroom: 30 });
		expect(scores).toEqual({ kitchen: 20, bathroom: 30 });
		expect(rollupScore(scores)).toBe(50);
	});

	it('accumulates deltas onto existing scores', () => {
		const scores = accumulateSubtopicScores({ kitchen: 20 }, { kitchen: 5, drain: 10 });
		expect(scores).toEqual({ kitchen: 25, drain: 10 });
	});

	it('caps the total at 100, never per-subtopic', () => {
		const scores = { kitchen: 60, bathroom: 60 };
		expect(rollupScore(scores)).toBe(120);
		expect(capTotal(rollupScore(scores))).toBe(100);
	});
});

// ── Per-signal attribution ───────────────────────────────────────────────────
//
// The regression these cover: the worked example (kitchen pages then a bathroom quote in ONE
// session) only splits if each signal is attributed from the page IT fired on. Previously every
// signal inherited the batch's landing URL, so a mixed session collapsed to one subtopic. The
// arithmetic test above passed regardless, because it fed the score map directly.

describe('subtopicForSignal', () => {
	it('uses the page the signal itself fired on, not the landing page', () => {
		expect(
			subtopicForSignal(
				{ name: 'page_load', payload: { url: '/bathroom-renovations' } },
				'/kitchen-remodel'
			)
		).toBe('bathroom');
	});

	it('accepts a full href as well as a pathname', () => {
		expect(
			subtopicForSignal(
				{ name: 'lg_open', payload: { url: 'https://example.com/services/drains' } },
				null
			)
		).toBe('drain');
	});

	it('prefers a named subject over the page', () => {
		expect(
			subtopicForSignal({ name: 'svc_click', payload: { service: 'Water Heater', url: '/kitchen' } }, null)
		).toBe('water_heater');
	});

	it('falls back to the landing page when the signal carries no page', () => {
		expect(subtopicForSignal({ name: 'scroll_25', payload: {} }, '/kitchen-remodel')).toBe('kitchen');
	});

	it('returns null when nothing identifies a subject', () => {
		expect(subtopicForSignal({ name: 'scroll_25', payload: {} }, null)).toBeNull();
	});
});

describe('the worked example, attributed end to end', () => {
	it('splits one session across kitchen and bathroom from each signal own page', () => {
		const signals = [
			...Array.from({ length: 6 }, () => ({ name: 'page_load', payload: { url: '/kitchen-remodel' }, delta: 0 })),
			{ name: 'scroll_50', payload: { url: '/kitchen-remodel' }, delta: 5 },
			{ name: 'dwell_60', payload: { url: '/kitchen-remodel' }, delta: 7 },
			{ name: 'svc_click', payload: { url: '/kitchen-remodel' }, delta: 8 },
			...Array.from({ length: 3 }, () => ({ name: 'page_load', payload: { url: '/bathroom-renovations' }, delta: 0 })),
			{ name: 'form_submit', payload: { url: '/bathroom-renovations' }, delta: 20 },
			{ name: 'lg_open', payload: { url: '/bathroom-renovations' }, delta: 8 },
			{ name: 'scroll_25', payload: {}, delta: 2 } // no page — recorded separately
		];

		const deltas: Record<string, number> = {};
		for (const sig of signals) {
			const st = subtopicForSignal({ name: sig.name, payload: sig.payload }, null) ?? UNKNOWN_SUBTOPIC;
			deltas[st] = (deltas[st] ?? 0) + sig.delta;
		}

		expect(deltas.kitchen).toBe(20);
		expect(deltas.bathroom).toBe(28);
		expect(deltas[UNKNOWN_SUBTOPIC]).toBe(2);

		// the subject list excludes UNKNOWN, and agrees with the scored keys
		const subjects = Object.keys(deltas).filter((k) => k !== UNKNOWN_SUBTOPIC).sort();
		expect(subjects).toEqual(['bathroom', 'kitchen']);
	});
});

describe('pathnameOf', () => {
	it('handles hrefs, paths and bare segments', () => {
		expect(pathnameOf('https://x.test/kitchen?a=1')).toBe('/kitchen');
		expect(pathnameOf('/kitchen')).toBe('/kitchen');
		expect(pathnameOf('kitchen')).toBe('/kitchen');
		expect(pathnameOf(null)).toBeNull();
	});
});
