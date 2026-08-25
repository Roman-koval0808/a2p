import { describe, it, expect } from 'vitest';
import { communicationSurface, isStillProcessing } from './communication-surface';

describe('isStillProcessing', () => {
	it('holds back a leadbox row until the AI pipeline has written its read', () => {
		expect(isStillProcessing({ type: 'leadbox', metadata: {} })).toBe(true);
	});

	it('releases it once the pipeline has left an interpretation', () => {
		expect(isStillProcessing({ type: 'leadbox', metadata: { ai_intent: { stage: 'active' } } })).toBe(false);
		expect(isStillProcessing({ type: 'leadbox', metadata: { message_category: 'emergency' } })).toBe(false);
	});

	it('never holds back deterministic telemetry rows', () => {
		expect(isStillProcessing({ type: 'web', metadata: { signals: ['page_load'] } })).toBe(false);
		expect(isStillProcessing({ type: 'viewroom', metadata: { source_signal: 'viewroom' } })).toBe(false);
	});

	it('honours an explicit marker', () => {
		expect(isStillProcessing({ type: 'web', metadata: { processing: true } })).toBe(true);
	});
});

describe('communicationSurface', () => {
	const base = { id: 'log1', communicationThreadId: 'thr1', metadata: {}, source: null };

	it('derives the tier from the identifiers held', () => {
		expect(communicationSurface({ ...base, customer: { id: 'c', email: 'a@b.c' } }).profileTier).toBe('T1');
		expect(communicationSurface({ ...base, customer: { id: 'c', name: 'Bo' } }).profileTier).toBe('T2');
		expect(communicationSurface({ ...base, customer: null }).profileTier).toBe('T2B');
	});

	it('surfaces the engagement rollup from the thread', () => {
		const s = communicationSurface({
			...base,
			communicationThread: { subtopics: ['kitchen', 'bathroom'], subtopicScores: { kitchen: 20 }, engagementScore: 20 }
		});
		expect(s.threadSubtopics).toEqual(['kitchen', 'bathroom']);
		expect(s.threadEngagementScore).toBe(20);
	});

	it('falls back to the call tracking category for the source', () => {
		const s = communicationSurface({ ...base, callTrackingCategory: { name: 'Drains' } });
		expect(s.channelSource).toBe('Drains');
	});

	it('labels a known attribution channel', () => {
		const s = communicationSurface({ ...base, metadata: { attribution: { channel: 'google_paid', keyword: 'furnace' } } });
		expect(s.channelSource).toBe('Google Paid Ads');
		expect(s.channelSourceDetail).toBe('kw "furnace"');
	});
});
