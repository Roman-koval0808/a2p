import { describe, it, expect } from 'vitest';
import { communicationSurface, isStillProcessing, journeyActivity } from './communication-surface';

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

describe('journeyActivity — prototype shapes', () => {
	const render = (log: any) =>
		journeyActivity(log)
			.segments.map((s) => s.text)
			.join('');

	it('web: pages and signals', () => {
		const log = { type: 'web', direction: 'inbound', metadata: { signals: ['page_load','scroll_25','page_load','dwell_30'], scoreLive: 38 } };
		expect(render(log)).toBe('2 pages · 4 signals');
		expect(journeyActivity(log).full).toContain('score 38');
	});

	it('web: surfaces a call tap', () => {
		const log = { type: 'web', direction: 'inbound', metadata: { signals: ['page_load','cta_call'] } };
		expect(render(log)).toBe('1 page · 2 signals · click-to-call');
	});

	it('voice: inbound call with duration', () => {
		expect(render({ type: 'voice', direction: 'inbound', metadata: { duration: 200 } })).toBe('call · 3m 20s');
	});

	it('voice: IVR selection then voicemail', () => {
		expect(render({ type: 'voice', direction: 'inbound', metadata: { ivrDigit: 2, voicemail: true } }))
			.toBe('IVR → press 2 → voicemail');
	});

	it('voice: outbound', () => {
		expect(render({ type: 'voice', direction: 'outbound', metadata: { duration: 220 } })).toBe('outbound call · 3m 40s');
	});

	it('email: inbound with an attachment', () => {
		expect(render({ type: 'email', direction: 'inbound', metadata: { attachments: [{ name: 'photo.jpg' }] } }))
			.toBe('email + 1 attachment');
	});

	it('email: outbound delivered', () => {
		expect(render({ type: 'email', direction: 'outbound', metadata: {} })).toBe('emailed · delivered');
	});

	it('sms and chatbot and leadform', () => {
		expect(render({ type: 'sms', direction: 'inbound', metadata: {} })).toBe('1 message');
		expect(render({ type: 'chatbot', direction: 'inbound', metadata: { turns: 6 } })).toBe('chat · 6 turns');
		expect(render({ type: 'leadform', direction: 'inbound', metadata: {} })).toBe('form submitted');
		expect(render({ type: 'leadbox', direction: 'inbound', metadata: {} })).toBe('lead submitted');
	});

	it('formats durations the way the prototype does', () => {
		expect(render({ type: 'voice', direction: 'inbound', metadata: { duration: 40 } })).toBe('call · 40s');
		expect(render({ type: 'voice', direction: 'inbound', metadata: { duration: 72 } })).toBe('call · 1m 12s');
	});
});
