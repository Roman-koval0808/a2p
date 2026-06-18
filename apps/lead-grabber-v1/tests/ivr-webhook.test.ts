/**
 * IVR webhook simulation tests: simulate Telnyx Event API payloads and assert
 * the correct Telnyx API calls (answer, playback, gather, transfer, hangup).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
const mockPrismaCallFlowFindMany = vi.fn();
const mockPrismaCallFlowFindUnique = vi.fn();
const mockPrismaCompanyPhoneNumberFindUnique = vi.fn();
const mockPrismaCompanyFindUnique = vi.fn();
const mockPrismaCallLogCreate = vi.fn();
const mockPrismaCallLogFindFirst = vi.fn();
const mockPrismaCallRecordingCreate = vi.fn();
const mockPrismaCallRecordingCount = vi.fn();
const mockPrismaContactFindFirst = vi.fn();
const mockPrismaContactCreate = vi.fn();
const mockPrismaCommunicationLogFindMany = vi.fn();
const mockPrismaCommunicationLogCreate = vi.fn();
const mockPrismaCommunicationLogUpdate = vi.fn();
const mockPbCreate = vi.fn();
const mockAddPendingCall = vi.fn();

vi.mock('$env/static/private', () => ({
	TELNYX_API_KEY: 'test-telnyx-key'
}));

vi.mock('$env/static/public', () => ({
	PUBLIC_BASE_URL: 'https://app.test'
}));

vi.mock('$lib/db', () => ({
	prisma: {
		callFlow: {
			findMany: (...args: unknown[]) => mockPrismaCallFlowFindMany(...args),
			findUnique: (...args: unknown[]) => mockPrismaCallFlowFindUnique(...args)
		},
		companyPhoneNumber: {
			findUnique: (...args: unknown[]) => mockPrismaCompanyPhoneNumberFindUnique(...args)
		},
		company: {
			findUnique: (...args: unknown[]) => mockPrismaCompanyFindUnique(...args)
		},
		callLog: {
			create: (...args: unknown[]) => mockPrismaCallLogCreate(...args),
			findFirst: (...args: unknown[]) => mockPrismaCallLogFindFirst(...args)
		},
		callRecording: {
			create: (...args: unknown[]) => mockPrismaCallRecordingCreate(...args),
			count: (...args: unknown[]) => mockPrismaCallRecordingCount(...args)
		},
		contact: {
			findFirst: (...args: unknown[]) => mockPrismaContactFindFirst(...args),
			create: (...args: unknown[]) => mockPrismaContactCreate(...args)
		},
		communicationLog: {
			findMany: (...args: unknown[]) => mockPrismaCommunicationLogFindMany(...args),
			create: (...args: unknown[]) => mockPrismaCommunicationLogCreate(...args),
			update: (...args: unknown[]) => mockPrismaCommunicationLogUpdate(...args)
		}
	}
}));

vi.mock('$lib/pocketbase', () => ({
	pb: {
		collection: () => ({
			create: (data: unknown) => mockPbCreate(data)
		})
	}
}));

vi.mock('$lib/utils/callStore', () => ({
	addPendingCall: (data: unknown) => mockAddPendingCall(data)
}));

// Must mock global fetch before importing the handler (handler uses fetch at top-level for Telnyx)
beforeEach(() => {
	vi.stubGlobal('fetch', mockFetch);
	mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
	mockPbCreate.mockResolvedValue({});
	mockAddPendingCall.mockImplementation(() => {});
	mockPrismaCallLogCreate.mockResolvedValue({});
	mockPrismaCallLogFindFirst.mockResolvedValue(null);
	mockPrismaCallRecordingCreate.mockResolvedValue({});
	mockPrismaCallRecordingCount.mockResolvedValue(0);
	mockPrismaContactFindFirst.mockResolvedValue(null);
	mockPrismaContactCreate.mockResolvedValue({});
	mockPrismaCommunicationLogFindMany.mockResolvedValue([]);
	mockPrismaCommunicationLogCreate.mockResolvedValue({});
	mockPrismaCommunicationLogUpdate.mockResolvedValue({});
	mockPrismaCompanyFindUnique.mockResolvedValue({ settings: { timezone: 'America/New_York' } });
});

describe('IVR webhook simulation', () => {
	describe('call.initiated', () => {
		const eventPayload = {
			data: {
				event_type: 'call.initiated',
				payload: {
					call_control_id: 'call-ctrl-123',
					from: '+15551234567',
					to: '+17059986143',
					direction: 'incoming',
					caller_id_name: 'Test Caller'
				}
			}
		};

		it('answers with IVR client_state when "to" number is assigned to company and active flow exists', async () => {
			// Handler uses getCompanyAndFlowByPhoneNumber → needs companyId + callFlowId to take IVR path
			mockPrismaCompanyPhoneNumberFindUnique.mockImplementation(async ({ where }: any) => {
				if (where.phoneNumber === '+17059986143') {
					return { companyId: 'company-1', callFlowId: 'flow-1' };
				}
				return null;
			});
			mockPrismaCallFlowFindMany.mockResolvedValue([
				{
					id: 'flow-1',
					title: 'Main',
					greetingAudioUrl: '/g.mp3',
					companyId: 'company-1',
					queueHoldAudioUrl: null,
					allUnavailableAudioUrl: null,
					backupCellAudioUrl: null,
					failoverConfig: null,
					created: new Date(),
					updated: new Date(),
					rules: [
						{
							id: 'rule-1',
							callFlowId: 'flow-1',
							ruleTitle: 'Always',
							schedule: {
								Mon: { start: '00:00', end: '23:59' },
								Tue: { start: '00:00', end: '23:59' },
								Wed: { start: '00:00', end: '23:59' },
								Thu: { start: '00:00', end: '23:59' },
								Fri: { start: '00:00', end: '23:59' },
								Sat: { start: '00:00', end: '23:59' },
								Sun: { start: '00:00', end: '23:59' }
							},
							promptsAudioUrl: '/p.mp3',
							keyPrompts: [],
							failoverCount: 2,
							failoverDelayMinutes: 2,
							failoverAudioUrl: null,
							hangupAudioUrl: null,
							leaveMessageOnHash: true,
							created: new Date(),
							updated: new Date()
						}
					]
				}
			]);

			const { POST } = await import('../src/routes/api/telnyx/call-webhook/+server');
			const res = await POST({
				request: new Request('http://localhost/api/telnyx/call-webhook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(eventPayload)
				})
			} as any);

			expect(res.status).toBe(200);
			const answerCalls = mockFetch.mock.calls.filter(
				(c: any) =>
					c[0] === 'https://api.telnyx.com/v2/calls/call-ctrl-123/actions/answer'
			);
			expect(answerCalls.length).toBeGreaterThanOrEqual(1);
			const answerBody = JSON.parse(answerCalls[0][1]?.body ?? '{}');
			expect(answerBody.client_state).toBeDefined();
			const state = JSON.parse(Buffer.from(answerBody.client_state, 'base64').toString('utf8'));
			expect(state.ivrFlowId).toBe('flow-1');
			expect(state.ivrRuleId).toBe('rule-1');
		});

		it('bypasses auto-answer when "from" caller number is a company number', async () => {
			mockPrismaCompanyPhoneNumberFindUnique.mockImplementation(async ({ where }: any) => {
				if (where.phoneNumber === '+17059986143' || where.phoneNumber === '+15551234567') {
					return { companyId: 'company-1', callFlowId: null };
				}
				return null;
			});
			const eventPayloadCompanyFrom = {
				data: {
					event_type: 'call.initiated',
					payload: {
						call_control_id: 'call-ctrl-company-from',
						from: '+15551234567',
						to: '+17059986143',
						direction: 'incoming',
						caller_id_name: 'Company Caller'
					}
				}
			};
			const { POST } = await import('../src/routes/api/telnyx/call-webhook/+server');
			const res = await POST({
				request: new Request('http://localhost/api/telnyx/call-webhook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(eventPayloadCompanyFrom)
				})
			} as any);
			expect(res.status).toBe(200);
			const answerCalls = mockFetch.mock.calls.filter(
				(c: any) =>
					c[0] === 'https://api.telnyx.com/v2/calls/call-ctrl-company-from/actions/answer'
			);
			expect(answerCalls.length).toBe(0);
		});

		it('adds to pending calls when "to" number is not assigned to any company', async () => {
			mockPrismaCompanyPhoneNumberFindUnique.mockResolvedValue(null);
			const eventPayloadNoIvr = {
				data: {
					event_type: 'call.initiated',
					payload: {
						call_control_id: 'call-ctrl-no-ivr',
						from: '+15551234567',
						to: '+17059986143',
						direction: 'incoming',
						caller_id_name: 'Test Caller'
					}
				}
			};
			const { POST } = await import('../src/routes/api/telnyx/call-webhook/+server');
			const res = await POST({
				request: new Request('http://localhost/api/telnyx/call-webhook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(eventPayloadNoIvr)
				})
			} as any);
			expect(res.status).toBe(200);
			expect(mockAddPendingCall).toHaveBeenCalledWith(
				expect.objectContaining({ phone: '+15551234567', callId: 'call-ctrl-no-ivr' })
			);
			const answerCalls = mockFetch.mock.calls.filter(
				(c: any) =>
					c[0] === 'https://api.telnyx.com/v2/calls/call-ctrl-no-ivr/actions/answer'
			);
			expect(answerCalls.length).toBe(1);
			const body = JSON.parse(answerCalls[0][1]?.body ?? '{}');
			const state = JSON.parse(Buffer.from(body.client_state, 'base64').toString('utf8'));
			expect(state.isUnavailable).toBe(true);
			expect(state.allUnavailableAudioUrl).toBeNull();
		});

		it('adds to pending calls when "to" number is assigned to company but has no callFlowId', async () => {
			mockPrismaCompanyPhoneNumberFindUnique.mockImplementation(async ({ where }: any) => {
				if (where.phoneNumber === '+17059986143') {
					return { companyId: 'company-1', callFlowId: null };
				}
				return null;
			});
			const eventPayloadNoFlow = {
				data: {
					event_type: 'call.initiated',
					payload: {
						call_control_id: 'call-ctrl-no-flow',
						from: '+15551234567',
						to: '+17059986143',
						direction: 'incoming',
						caller_id_name: 'Test Caller'
					}
				}
			};
			const { POST } = await import('../src/routes/api/telnyx/call-webhook/+server');
			const res = await POST({
				request: new Request('http://localhost/api/telnyx/call-webhook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(eventPayloadNoFlow)
				})
			} as any);
			expect(res.status).toBe(200);
			expect(mockAddPendingCall).toHaveBeenCalledWith(
				expect.objectContaining({ phone: '+15551234567', callId: 'call-ctrl-no-flow' })
			);
			const answerCalls = mockFetch.mock.calls.filter(
				(c: any) =>
					c[0] === 'https://api.telnyx.com/v2/calls/call-ctrl-no-flow/actions/answer'
			);
			expect(answerCalls.length).toBe(1);
			const body = JSON.parse(answerCalls[0][1]?.body ?? '{}');
			const state = JSON.parse(Buffer.from(body.client_state, 'base64').toString('utf8'));
			expect(state.isUnavailable).toBe(true);
		});

		it('adds to pending calls and answers when "to" number has no active rules', async () => {
			mockPrismaCompanyPhoneNumberFindUnique.mockImplementation(async ({ where }: any) => {
				if (where.phoneNumber === '+17059986143') {
					return { companyId: 'company-1', callFlowId: 'flow-1' };
				}
				return null;
			});
			mockPrismaCallFlowFindMany.mockResolvedValue([
				{
					id: 'flow-1',
					title: 'Main',
					greetingAudioUrl: '/g.mp3',
					companyId: 'company-1',
					allUnavailableAudioUrl: '/unavailable.mp3',
					rules: [] // No rules means not active
				}
			]);
			mockPrismaCallFlowFindUnique.mockResolvedValue({
				id: 'flow-1',
				allUnavailableAudioUrl: '/unavailable.mp3'
			});

			const eventPayloadNoActive = {
				data: {
					event_type: 'call.initiated',
					payload: {
						call_control_id: 'call-ctrl-no-active',
						from: '+15551234567',
						to: '+17059986143',
						direction: 'incoming',
						caller_id_name: 'Test Caller'
					}
				}
			};
			const { POST } = await import('../src/routes/api/telnyx/call-webhook/+server');
			const res = await POST({
				request: new Request('http://localhost/api/telnyx/call-webhook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(eventPayloadNoActive)
				})
			} as any);
			expect(res.status).toBe(200);
			expect(mockAddPendingCall).toHaveBeenCalledWith(
				expect.objectContaining({ phone: '+15551234567', callId: 'call-ctrl-no-active' })
			);
			const answerCalls = mockFetch.mock.calls.filter(
				(c: any) =>
					c[0] === 'https://api.telnyx.com/v2/calls/call-ctrl-no-active/actions/answer'
			);
			expect(answerCalls.length).toBe(1);
			const body = JSON.parse(answerCalls[0][1]?.body ?? '{}');
			const state = JSON.parse(Buffer.from(body.client_state, 'base64').toString('utf8'));
			expect(state.isUnavailable).toBe(true);
			expect(state.allUnavailableAudioUrl).toBe('/unavailable.mp3');
			expect(state.ivrFlowId).toBe('flow-1');
		});
	});

	describe('call.answered', () => {
		it('plays unavailable audio and sets afterPlaybackHangup client state when isUnavailable is true and audio url exists', async () => {
			const clientState = Buffer.from(
				JSON.stringify({ isUnavailable: true, allUnavailableAudioUrl: '/unavail.mp3' })
			).toString('base64');

			const { POST } = await import('../src/routes/api/telnyx/call-webhook/+server');
			await POST({
				request: new Request('http://localhost/api/telnyx/call-webhook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						data: {
							event_type: 'call.answered',
							payload: {
								call_control_id: 'call-ctrl-ans-1',
								client_state: clientState
							}
						}
					})
				})
			} as any);

			const playbackCalls = mockFetch.mock.calls.filter(
				(c: any) =>
					c[0] === 'https://api.telnyx.com/v2/calls/call-ctrl-ans-1/actions/playback_start'
			);
			expect(playbackCalls.length).toBe(1);
			const body = JSON.parse(playbackCalls[0][1]?.body ?? '{}');
			expect(body.audio_url).toContain('unavail.mp3');
			const decodedState = JSON.parse(Buffer.from(body.client_state, 'base64').toString('utf8'));
			expect(decodedState.afterPlaybackHangup).toBe(true);
		});

		it('speaks default unavailability message and sets afterPlaybackHangup client state when isUnavailable is true and audio url is null', async () => {
			const clientState = Buffer.from(
				JSON.stringify({ isUnavailable: true, allUnavailableAudioUrl: null })
			).toString('base64');

			const { POST } = await import('../src/routes/api/telnyx/call-webhook/+server');
			await POST({
				request: new Request('http://localhost/api/telnyx/call-webhook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						data: {
							event_type: 'call.answered',
							payload: {
								call_control_id: 'call-ctrl-ans-2',
								client_state: clientState
							}
						}
					})
				})
			} as any);

			const speakCalls = mockFetch.mock.calls.filter(
				(c: any) =>
					c[0] === 'https://api.telnyx.com/v2/calls/call-ctrl-ans-2/actions/speak'
			);
			expect(speakCalls.length).toBe(1);
			const body = JSON.parse(speakCalls[0][1]?.body ?? '{}');
			expect(body.payload).toContain('no representative is available');
			const decodedState = JSON.parse(Buffer.from(body.client_state, 'base64').toString('utf8'));
			expect(decodedState.afterPlaybackHangup).toBe(true);
		});
	});

	describe('call.gather.ended', () => {
		const flowId = 'flow-1';
		const ruleId = 'rule-1';
		const clientState = Buffer.from(
			JSON.stringify({ ivrFlowId: flowId, ivrRuleId: ruleId })
		).toString('base64');

		beforeEach(() => {
			mockPrismaCallFlowFindUnique.mockResolvedValue({
				id: flowId,
				title: 'Main',
				greetingAudioUrl: '/g.mp3',
				companyId: 'company-1',
				queueHoldAudioUrl: null,
				allUnavailableAudioUrl: null,
				backupCellAudioUrl: null,
				failoverConfig: null,
				created: new Date(),
				updated: new Date(),
				rules: [
					{
						id: ruleId,
						callFlowId: flowId,
						ruleTitle: 'Test',
						schedule: {},
						promptsAudioUrl: '/p.mp3',
						keyPrompts: [
							{ key: '1', name: 'Sales', extension: '+15559876000' },
							{ key: '#', name: 'Hangup', extension: '' }
						],
						failoverCount: 2,
						failoverDelayMinutes: 2,
						failoverAudioUrl: '/f.mp3',
						hangupAudioUrl: '/h.mp3',
						leaveMessageOnHash: true,
						created: new Date(),
						updated: new Date()
					}
				]
			});
		});

		it('transfers to extension when digit matches a key', async () => {
			const { POST } = await import('../src/routes/api/telnyx/call-webhook/+server');
			await POST({
				request: new Request('http://localhost/api/telnyx/call-webhook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						data: {
							event_type: 'call.gather.ended',
							payload: {
								call_control_id: 'call-ctrl-456',
								digits: '1',
								status: 'valid',
								client_state: clientState
							}
						}
					})
				})
			} as any);

			const transferCalls = mockFetch.mock.calls.filter(
				(c: any) =>
					c[0] === 'https://api.telnyx.com/v2/calls/call-ctrl-456/actions/transfer'
			);
			expect(transferCalls.length).toBe(1);
			const body = JSON.parse(transferCalls[0][1]?.body ?? '{}');
			expect(body.to).toBe('+15559876000');
		});

		it('starts recording voicemail when digit is #', async () => {
			const { POST } = await import('../src/routes/api/telnyx/call-webhook/+server');
			await POST({
				request: new Request('http://localhost/api/telnyx/call-webhook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						data: {
							event_type: 'call.gather.ended',
							payload: {
								call_control_id: 'call-ctrl-789',
								digits: '#',
								status: 'valid',
								client_state: clientState
							}
						}
					})
				})
			} as any);

			// Should stop current recording and play voicemail prompt
			const stopCalls = mockFetch.mock.calls.filter(
				(c: any) =>
					c[0] === 'https://api.telnyx.com/v2/calls/call-ctrl-789/actions/record_stop'
			);
			expect(stopCalls.length).toBe(1);

			const speakCalls = mockFetch.mock.calls.filter(
				(c: any) =>
					c[0] === 'https://api.telnyx.com/v2/calls/call-ctrl-789/actions/speak'
			);
			expect(speakCalls.length).toBe(1);
			const body = JSON.parse(speakCalls[0][1]?.body ?? '{}');
			expect(body.payload).toContain('Please leave your message');
			expect(body.client_state).toBeDefined();

			// Simulate voicemail prompt ended -> should play beep
			await POST({
				request: new Request('http://localhost/api/telnyx/call-webhook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						data: {
							event_type: 'call.playback.ended',
							payload: {
								call_control_id: 'call-ctrl-789',
								client_state: body.client_state
							}
						}
					})
				})
			} as any);

			const beepCalls = mockFetch.mock.calls.filter(
				(c: any) =>
					c[0] === 'https://api.telnyx.com/v2/calls/call-ctrl-789/actions/playback_start'
			);
			expect(beepCalls.length).toBe(1);
			const beepBody = JSON.parse(beepCalls[0][1]?.body ?? '{}');
			expect(beepBody.audio_url).toContain('gotitem.mp3');
			expect(beepBody.client_state).toBeDefined();

			// Simulate beep ended -> should start recording voicemail
			await POST({
				request: new Request('http://localhost/api/telnyx/call-webhook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						data: {
							event_type: 'call.playback.ended',
							payload: {
								call_control_id: 'call-ctrl-789',
								client_state: beepBody.client_state
							}
						}
					})
				})
			} as any);

			const recordingCalls = mockFetch.mock.calls.filter(
				(c: any) =>
					c[0] === 'https://api.telnyx.com/v2/calls/call-ctrl-789/actions/record_start'
			);
			expect(recordingCalls.length).toBe(1);
		});

		it('re-gathers on timeout when under failover count', async () => {
			const retryState = Buffer.from(
				JSON.stringify({ ivrFlowId: flowId, ivrRuleId: ruleId, ivrRetry: 0 })
			).toString('base64');

			const { POST } = await import('../src/routes/api/telnyx/call-webhook/+server');
			await POST({
				request: new Request('http://localhost/api/telnyx/call-webhook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						data: {
							event_type: 'call.gather.ended',
							payload: {
								call_control_id: 'call-ctrl-timeout',
								digits: '',
								status: 'timeout',
								client_state: retryState
							}
						}
					})
				})
			} as any);

			// Should play failover then (on playback.ended) re-gather; or if no failover URL, gather immediately
			const gatherCalls = mockFetch.mock.calls.filter(
				(c: any) =>
					c[0] === 'https://api.telnyx.com/v2/calls/call-ctrl-timeout/actions/gather_using_audio'
			);
			const playbackCalls = mockFetch.mock.calls.filter(
				(c: any) =>
					c[0] === 'https://api.telnyx.com/v2/calls/call-ctrl-timeout/actions/playback_start'
			);
			expect(gatherCalls.length + playbackCalls.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe('call.recording.saved', () => {
		it('saves reference and transcribes if not voicemail', async () => {
			mockPrismaCallLogFindFirst.mockResolvedValue({
				to: '+17059986143',
				from: '+15551234567',
				metadata: { direction: 'incoming' }
			});
			mockPrismaCompanyPhoneNumberFindUnique.mockImplementation(async ({ where }: any) => {
				if (where.phoneNumber === '+17059986143') {
					return { companyId: 'company-1', callFlowId: 'flow-1' };
				}
				return null;
			});
			mockPrismaContactFindFirst.mockResolvedValue({ id: 'contact-1' });

			const { POST } = await import('../src/routes/api/telnyx/call-webhook/+server');
			const res = await POST({
				request: new Request('http://localhost/api/telnyx/call-webhook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						data: {
							event_type: 'call.recording.saved',
							payload: {
								call_control_id: 'call-ctrl-rec-1',
								recording_id: 'rec-1',
								recording_urls: { mp3: 'https://telnyx-audio/rec.mp3' },
								duration: 12
							}
						}
					})
				})
			} as any);

			expect(res.status).toBe(200);
			expect(mockPrismaCallRecordingCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						callId: 'call-ctrl-rec-1',
						recordingId: 'rec-1'
					})
				})
			);
		});
	});

	describe('event type detection', () => {
		it('accepts Call Control format with explicit event_type', async () => {
			mockPrismaCompanyPhoneNumberFindUnique.mockResolvedValue(null);
			mockPrismaCallFlowFindMany.mockResolvedValue([]);

			const { POST } = await import('../src/routes/api/telnyx/call-webhook/+server');
			const res = await POST({
				request: new Request('http://localhost/api/telnyx/call-webhook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						call_control_id: 'call-ctrl-cc',
						event_type: 'call.gather.ended',
						digits: '1',
						status: 'valid',
						client_state: Buffer.from(
							JSON.stringify({ ivrFlowId: 'f1', ivrRuleId: 'r1' })
						).toString('base64')
					})
				})
			} as any);

			expect(res.status).toBe(200);
			// Would try to load flow f1 / rule r1 and then transfer or fail
			expect(mockPrismaCallFlowFindUnique).toHaveBeenCalled();
		});
	});
});
