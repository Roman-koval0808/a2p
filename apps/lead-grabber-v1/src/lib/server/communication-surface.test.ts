import { describe, it, expect } from 'vitest';
import {
	communicationSurface,
	isStillProcessing,
	journeyActivity,
	recordingUrlFor,
	isInternalNotice
} from './communication-surface';

describe('isStillProcessing', () => {
	it('holds back a leadbox row until the AI pipeline has written its read', () => {
		expect(isStillProcessing({ type: 'leadbox', metadata: {} })).toBe(true);
	});

	it('releases it once the pipeline has left an interpretation', () => {
		expect(
			isStillProcessing({ type: 'leadbox', metadata: { ai_intent: { stage: 'active' } } })
		).toBe(false);
		expect(
			isStillProcessing({ type: 'leadbox', metadata: { message_category: 'emergency' } })
		).toBe(false);
	});

	it('never holds back deterministic telemetry rows', () => {
		expect(isStillProcessing({ type: 'web', metadata: { signals: ['page_load'] } })).toBe(false);
		expect(isStillProcessing({ type: 'viewroom', metadata: { source_signal: 'viewroom' } })).toBe(
			false
		);
	});

	it('honours an explicit marker', () => {
		expect(isStillProcessing({ type: 'web', metadata: { processing: true } })).toBe(true);
	});
});

describe('communicationSurface', () => {
	const base = { id: 'log1', communicationThreadId: 'thr1', metadata: {}, source: null };

	it('derives the tier from the identifiers held', () => {
		expect(
			communicationSurface({ ...base, customer: { id: 'c', email: 'a@b.c' } }).profileTier
		).toBe('T1');
		expect(communicationSurface({ ...base, customer: { id: 'c', name: 'Bo' } }).profileTier).toBe(
			'T2'
		);
		expect(communicationSurface({ ...base, customer: null }).profileTier).toBe('T2B');
	});

	it('surfaces the engagement rollup from the thread', () => {
		const s = communicationSurface({
			...base,
			communicationThread: {
				subtopics: ['kitchen', 'bathroom'],
				subtopicScores: { kitchen: 20 },
				engagementScore: 20
			}
		});
		expect(s.threadSubtopics).toEqual(['kitchen', 'bathroom']);
		expect(s.threadEngagementScore).toBe(20);
	});

	it('falls back to the call tracking category for the source', () => {
		const s = communicationSurface({ ...base, callTrackingCategory: { name: 'Drains' } });
		expect(s.channelSource).toBe('Drains');
	});

	it('labels a known attribution channel', () => {
		const s = communicationSurface({
			...base,
			metadata: { attribution: { channel: 'google_paid', keyword: 'furnace' } }
		});
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
		const log = {
			type: 'web',
			direction: 'inbound',
			metadata: { signals: ['page_load', 'scroll_25', 'page_load', 'dwell_30'], scoreLive: 38 }
		};
		expect(render(log)).toBe('2 pages · 4 signals');
		expect(journeyActivity(log).full).toContain('score 38');
	});

	it('web: surfaces a call tap', () => {
		const log = {
			type: 'web',
			direction: 'inbound',
			metadata: { signals: ['page_load', 'cta_call'] }
		};
		expect(render(log)).toBe('1 page · 2 signals · click-to-call');
	});

	it('voice: inbound call with duration', () => {
		expect(render({ type: 'voice', direction: 'inbound', metadata: { duration: 200 } })).toBe(
			'call · 3m 20s'
		);
	});

	it('voice: IVR selection then voicemail', () => {
		expect(
			render({ type: 'voice', direction: 'inbound', metadata: { ivrDigit: 2, voicemail: true } })
		).toBe('IVR → press 2 → voicemail');
	});

	it('voice: outbound', () => {
		expect(render({ type: 'voice', direction: 'outbound', metadata: { duration: 220 } })).toBe(
			'outbound call · 3m 40s'
		);
	});

	it('email: inbound with an attachment', () => {
		expect(
			render({
				type: 'email',
				direction: 'inbound',
				metadata: { attachments: [{ name: 'photo.jpg' }] }
			})
		).toBe('email + 1 attachment');
	});

	it('email: outbound delivered', () => {
		expect(render({ type: 'email', direction: 'outbound', metadata: {} })).toBe(
			'emailed · delivered'
		);
	});

	it('sms and chatbot and leadform', () => {
		expect(render({ type: 'sms', direction: 'inbound', metadata: {} })).toBe('1 message');
		expect(render({ type: 'chatbot', direction: 'inbound', metadata: { turns: 6 } })).toBe(
			'chat · 6 turns'
		);
		expect(render({ type: 'leadform', direction: 'inbound', metadata: {} })).toBe('form submitted');
		expect(render({ type: 'leadbox', direction: 'inbound', metadata: {} })).toBe('lead submitted');
	});

	it('formats durations the way the prototype does', () => {
		expect(render({ type: 'voice', direction: 'inbound', metadata: { duration: 40 } })).toBe(
			'call · 40s'
		);
		expect(render({ type: 'voice', direction: 'inbound', metadata: { duration: 72 } })).toBe(
			'call · 1m 12s'
		);
	});
});

describe('intent — one bucket, read from what writers actually store', () => {
	// Shape taken verbatim from a real voice row (cmt8za3jn001d2ssflfxskhjd).
	const voiceEmergency = {
		id: 'l1',
		type: 'voice',
		metadata: {
			message_category: 'emergency',
			emergency_type: 'roof_leak',
			urgency: 'high',
			intent: 'Support',
			sub_intent: 'Emergency - Active Water Damage',
			ai_intent: {
				intent_bucket: 'emergency',
				purpose: 'emergency',
				urgency: 'critical',
				confidence: 0.99
			}
		}
	};

	it('fills the cells that used to render as em-dashes', () => {
		const s = communicationSurface(voiceEmergency);
		expect(s.intentStage).toBe('emergency');
		expect(s.intentEmergency).toBe(true);
		expect(s.intentStatus).toBe('declared');
		expect(s.intentConfidence).toBe('high');
		expect(s.intentSubtopic).toBe('roof');
	});

	it('uses emergency as the overriding bucket', () => {
		expect(communicationSurface(voiceEmergency).intentStage).toBe('emergency');
	});

	it('still reads the telemetry key names', () => {
		const s = communicationSurface({
			id: 'l2',
			type: 'web',
			metadata: {
				intentBucket: 'comparison',
				intentStatus: 'behaviour_inferred',
				signals: ['scroll_50']
			}
		});
		expect(s.intentStage).toBe('comparison');
		expect(s.intentStatus).toBe('behaviour_inferred');
		expect(s.intentEmergency).toBe(false);
	});

	it('turns a numeric model confidence into a band', () => {
		const band = (c: number) =>
			communicationSurface({ id: 'x', type: 'voice', metadata: { ai_intent: { confidence: c } } })
				.intentConfidence;
		expect(band(0.99)).toBe('high');
		expect(band(0.6)).toBe('medium');
		expect(band(0.2)).toBe('low');
	});

	it('says nothing when nothing has interpreted the row', () => {
		const s = communicationSurface({ id: 'l3', type: 'voice', metadata: {} });
		expect(s.intentStage).toBeNull();
		expect(s.intentStatus).toBeNull();
		expect(s.intentConfidence).toBeNull();
	});
});

describe('telemetry rows are deterministic, never "declared"', () => {
	// Shape from a real viewroom row: the orchestrator set message_category for routing, which is
	// not the visitor declaring anything.
	const viewroom = {
		id: 'v1',
		type: 'viewroom',
		metadata: {
			source_signal: 'viewroom',
			message_category: 'support',
			intentBucket: 'active',
			confidence: 0.3
		}
	};

	it('does not claim the visitor declared their intent', () => {
		expect(communicationSurface(viewroom).intentStatus).toBeNull();
	});

	it('does not invent a confidence for a deterministic row', () => {
		expect(communicationSurface(viewroom).intentConfidence).toBeNull();
	});

	it('still shows the stage telemetry itself assigned', () => {
		expect(communicationSurface(viewroom).intentStage).toBe('active');
	});

	it('does not treat the orchestrator routing label as an emergency', () => {
		const routed = {
			id: 'v2',
			type: 'web',
			metadata: { signals: ['page_load'], message_category: 'emergency' }
		};
		expect(communicationSurface(routed).intentEmergency).toBe(false);
	});

	it('keeps a status telemetry did write', () => {
		const s = communicationSurface({
			id: 'v3',
			type: 'web',
			metadata: {
				signals: ['scroll_50'],
				intentStatus: 'behaviour_inferred',
				intentBucket: 'comparison'
			}
		});
		expect(s.intentStatus).toBe('behaviour_inferred');
	});
});

describe('recordingUrlFor — the three shapes a call leaves behind', () => {
	it('uses our proxy when Telnyx left a recording_id', () => {
		expect(
			recordingUrlFor({ id: 'log9', type: 'voice', metadata: { recording_id: 'rec_1' } })
		).toBe('/api/recording/log9');
	});

	it('prefers mp3 from a direct recording_urls object', () => {
		expect(
			recordingUrlFor({
				id: 'l',
				type: 'voice',
				metadata: { recording_urls: { m4a: 'https://x/a.m4a', mp3: 'https://x/a.mp3' } }
			})
		).toBe('https://x/a.mp3');
	});

	it('falls back to any http url in that object', () => {
		expect(
			recordingUrlFor({
				id: 'l',
				type: 'voice',
				metadata: { recording_urls: { wav: 'https://x/a.wav' } }
			})
		).toBe('https://x/a.wav');
	});

	it('falls back to the older voicemail_url field', () => {
		expect(
			recordingUrlFor({ id: 'l', type: 'voice', metadata: { voicemail_url: 'https://x/vm.mp3' } })
		).toBe('https://x/vm.mp3');
	});

	it('is null when the call has no audio, and for non-voice rows', () => {
		expect(recordingUrlFor({ id: 'l', type: 'voice', metadata: {} })).toBeNull();
		expect(
			recordingUrlFor({ id: 'l', type: 'web', metadata: { recording_id: 'rec_1' } })
		).toBeNull();
	});
});

describe('outbound and system rows are never held back', () => {
	// Verbatim shape of the callback-router row (cmt90yvwt00942ssfwloqo4ul). Relabelling it from
	// `web` to `voice` put it inside the AI-interpreted set, and the table then hid it — the rep's
	// dial vanished from the log.
	const callbackDispatch = {
		id: 'cb1',
		type: 'voice',
		direction: 'outbound',
		metadata: {
			callback_request: true,
			preference: 'ASAP',
			decision: 'bridge_now',
			rota: [{ name: 'Carter Adams' }]
		}
	};

	it('shows the callback dispatch immediately', () => {
		expect(isStillProcessing(callbackDispatch)).toBe(false);
		expect(communicationSurface(callbackDispatch).isProcessing).toBe(false);
	});

	it('shows the bridge leg to the rep', () => {
		expect(
			isStillProcessing({ id: 'cb2', type: 'voice', direction: 'outbound', metadata: {} })
		).toBe(false);
	});

	it('still holds back an INBOUND voice call awaiting its AI read', () => {
		expect(isStillProcessing({ id: 'v', type: 'voice', direction: 'inbound', metadata: {} })).toBe(
			true
		);
	});

	it('releases that inbound call once the read lands', () => {
		expect(
			isStillProcessing({
				id: 'v',
				type: 'voice',
				direction: 'inbound',
				metadata: { message_category: 'emergency' }
			})
		).toBe(false);
	});
});

describe('internal notices stay out of the conversation log', () => {
	it('filters a bucket promotion — it is derived from a real call, not a new contact', () => {
		const promo = {
			id: 'p1',
			type: 'voice',
			direction: 'inbound',
			metadata: {
				telemetry: true,
				bucket_promotion: true,
				source_signal: 'voice',
				intentBucket: 'active'
			}
		};
		expect(isInternalNotice(promo)).toBe(true);
		expect(communicationSurface(promo).isInternalNotice).toBe(true);
	});

	it('filters scheduled-intent bookkeeping', () => {
		expect(isInternalNotice({ metadata: { scheduled_intent_note: true } })).toBe(true);
		expect(isInternalNotice({ metadata: { scheduled_intent_ack: true } })).toBe(true);
	});

	it('leaves real communications alone', () => {
		expect(
			isInternalNotice({ id: 'v', type: 'voice', metadata: { message_category: 'emergency' } })
		).toBe(false);
		expect(isInternalNotice({ id: 'w', type: 'web', metadata: { signals: ['page_load'] } })).toBe(
			false
		);
		expect(isInternalNotice({ metadata: {} })).toBe(false);
	});
});

describe('journey text is not truncated', () => {
	it('keeps the whole summary', () => {
		const long =
			'Hi +15556655443, good news — you have no outstanding balance on your account at this time.';
		const j = journeyActivity({
			type: 'unknown-channel',
			direction: 'outbound',
			summary: long,
			metadata: {}
		});
		expect(j.segments.map((s) => s.text).join('')).toBe(long);
	});
});
