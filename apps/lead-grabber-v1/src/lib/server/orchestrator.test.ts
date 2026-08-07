import { describe, it, expect, vi, beforeEach } from 'vitest';
import { process_orchestrator } from './orchestrator';
import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';

// ============================================================
// FULL MOCK SETUP — every module the orchestrator touches
// ============================================================

const mockPrisma = vi.hoisted(() => ({
	communicationLog: {
		findUnique: vi.fn(),
		findFirst: vi.fn().mockResolvedValue(null),
		findMany: vi.fn().mockResolvedValue([]),
		update: vi.fn(),
		count: vi.fn().mockResolvedValue(0)
	},
	contact: {
		update: vi.fn(),
		findMany: vi.fn().mockResolvedValue([])
	},
	pipelineCustomerProfile: {
		findFirst: vi.fn().mockResolvedValue(null),
		create: vi.fn().mockResolvedValue({ id: 'profile_new' }),
		update: vi.fn().mockResolvedValue({})
	},
	commContainer: {
		findFirst: vi.fn().mockResolvedValue(null),
		findMany: vi.fn().mockResolvedValue([]),
		create: vi.fn().mockResolvedValue({ id: 'container_1', commRef: '#1001' }),
		update: vi.fn().mockResolvedValue({})
	},
	commTask: {
		create: vi.fn().mockResolvedValue({ id: 'task_1' }),
		findMany: vi.fn().mockResolvedValue([])
	},
	commApproval: {
		create: vi.fn().mockResolvedValue({ id: 'appr_1' }),
		findMany: vi.fn().mockResolvedValue([])
	},
	commEntry: {
		findFirst: vi.fn().mockResolvedValue(null),
		findMany: vi.fn().mockResolvedValue([]),
		create: vi.fn().mockResolvedValue({ id: 'entry_1' })
	},
	commHold: { create: vi.fn().mockResolvedValue({ id: 'hold_1' }), update: vi.fn() },
	pipelineTimer: {
		create: vi.fn().mockResolvedValue({ id: 'tmr_1' }),
		update: vi.fn(),
		updateMany: vi.fn().mockResolvedValue({ count: 1 })
	},
	pipelineEvent: {
		create: vi.fn().mockImplementation((d: any) => Promise.resolve({ id: 'evt_1', decisions: [{ id: 'dec_1' }], ...d.data }))
	},
	pipelineActionQueue: { create: vi.fn().mockResolvedValue({ id: 'q_1' }) },
	communicationThread: { upsert: vi.fn().mockResolvedValue({ id: 'thread_1' }) },
	appointment: { create: vi.fn().mockResolvedValue({ id: 'apt_1' }) },
	notification: { create: vi.fn() },
	company: { findUnique: vi.fn().mockResolvedValue({ id: 'company_id', settings: {} }) },
	scheduleEvent: { findMany: vi.fn().mockResolvedValue([]) }
}));

vi.mock('$lib/db', () => ({ prisma: mockPrisma }));
vi.mock('$lib/utils/communication-log', () => ({ logCommunication: vi.fn().mockResolvedValue({ id: 'log_out_1' }) }));
vi.mock('$lib/company-numbers', () => ({ toE164: (n: string) => n }));
vi.mock('$lib/server/emergency-routing', () => ({
	decideRouting: vi.fn().mockReturnValue({ dispatchToTech: false, reason: 'non-emergency' }),
	isOffHours: vi.fn().mockReturnValue(false)
}));
vi.mock('$lib/server/callback-ack', () => ({
	sendCallbackAck: vi.fn().mockResolvedValue({ sent: true, slaMinutes: 10, reason: '' })
}));
vi.mock('$lib/server/internal-call-guard', () => ({
	isInternalCaller: vi.fn().mockResolvedValue(false)
}));
vi.mock('$lib/server/phone-geo', () => ({
	phoneGeo: vi.fn().mockReturnValue({ areaCode: '555', location: 'TestCity' }),
	dayOfWeek: vi.fn().mockReturnValue('Monday'),
	lookupLineType: vi.fn().mockResolvedValue({ lineType: 'mobile', carrier: 'TestMobile' })
}));
// The orchestrator asks for the caller's line type before choosing a channel (§4.3a). These
// fixtures are ordinary mobile customers, so replying by SMS is permitted — without this the
// lookup returns 'unknown', which is Tier 2, and every SMS draft is correctly suppressed.
vi.mock('$lib/server/number-lookup', () => ({
	getLineType: vi.fn().mockResolvedValue('mobile'),
	getLineInfo: vi.fn().mockResolvedValue({ lineType: 'mobile', carrier: 'TestMobile' }),
	lookupNumberCached: vi.fn().mockResolvedValue({ lineType: 'mobile', carrier: 'TestMobile' })
}));
vi.mock('$lib/server/weather', () => ({
	weatherForLocation: vi.fn().mockResolvedValue({ tempF: 72, description: 'Sunny', icon: 'sun' })
}));
vi.mock('$lib/server/balance', () => ({
	resolveBalanceByPhone: vi.fn().mockImplementation(async (_cId: string, _p: string, bal: number | null) => bal ?? null)
}));
vi.mock('$lib/server/google-calendar', () => ({
	getUpcomingAppointments: vi.fn().mockResolvedValue([]),
	getConnectionInfo: vi.fn().mockResolvedValue(null),
	getBookingLinkIfConnected: vi.fn().mockResolvedValue(null),
	getAvailableSlots: vi.fn().mockResolvedValue([]),
	resolveReschedule: vi.fn(),
	getCustomerAppointments: vi.fn().mockResolvedValue([])
}));
vi.mock('$lib/utils/booking', () => ({
	getBookingUrl: vi.fn().mockReturnValue(null),
	bookingLinkWith: vi.fn().mockReturnValue('')
}));
vi.mock('./calendar', () => ({
	checkCalendarAvailability: vi.fn().mockReturnValue(true),
	formatDatetime: vi.fn().mockReturnValue(''),
	describeLocations: vi.fn().mockReturnValue(''),
	describeDayHours: vi.fn().mockReturnValue(''),
	resolveNamedDays: vi.fn().mockReturnValue([])
}));
vi.mock('./billing-email', () => ({
	buildBalanceEmail: vi.fn().mockReturnValue({ htmlContent: '<p>Balance: $100</p>', subject: 'Your Balance' }),
	wantsEmailedBalance: vi.fn().mockReturnValue(false)
}));
vi.mock('./emergency-templates', () => ({
	emergencyAdvice: vi.fn().mockReturnValue({ message: 'Safety advice: stay safe.', type: 'water_leak' })
}));
vi.mock('./conversation', () => ({
	draftConversationalReply: vi.fn().mockResolvedValue({ reply: 'Conversational reply from AI.' })
}));
vi.mock('./reply-skills', () => ({
	draftAgenticReply: vi.fn().mockResolvedValue({ reply: 'Agentic reply.' })
}));
vi.mock('./appointment-flow', () => ({
	isAffirmative: vi.fn().mockReturnValue(false),
	findPendingProposal: vi.fn().mockResolvedValue(null),
	bookProposedAppointment: vi.fn(),
	proposeAppointment: vi.fn()
}));
vi.mock('./scenarios/s4-sms-booking', () => ({
	processSalesVoicemailBooking: vi.fn().mockResolvedValue({
		smsDrafted: false, commId: 'c_sales_1', approval: null, hold: null, explicitDateText: ''
	})
}));
vi.mock('./scenarios/s1-meeting-confirm', () => ({
	processSupportCallMeetingConfirmation: vi.fn().mockResolvedValue({
		smsDrafted: false, commId: 'c_support_1', approval: null
	})
}));
vi.mock('./scenarios/s3-escalation', () => ({
	processSecondEmergencyVoicemail: vi.fn().mockResolvedValue({ updatedWorkOrder: { currentRung: 2 } })
}));
vi.mock('$lib/server/container/container-service', () => ({
	createContainerAtIntake: vi.fn().mockResolvedValue({ container: { id: 'container_new', commRef: '#2001' } }),
	reviewMerge: vi.fn()
}));
vi.mock('./emergency-dial', () => ({
	startDialLadder: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('./company-sender', () => ({
	resolveSmsSender: vi.fn().mockResolvedValue('+18005550000')
}));
vi.mock('./openai', () => ({
	matchThreadOpenAI: vi.fn().mockResolvedValue(null)
}));
vi.mock('./orchestrator/command-registry', () => ({
	executeInstructions: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$env/static/private', () => ({ OPEN_AI_KEY: 'test-key', ANTHROPIC_AI_KEY: 'test-key' }));

// mock message-intent with only classifyMessageIntent overridable
vi.mock('./message-intent', async (importActual) => {
	const actual = await importActual<typeof import('./message-intent')>();
	return { ...actual, classifyMessageIntent: vi.fn() };
});

import { getLineType } from '$lib/server/number-lookup';
import { classifyMessageIntent } from './message-intent';
import { executeInstructions } from './orchestrator/command-registry';
import { isAffirmative, findPendingProposal } from './appointment-flow';
import { decideRouting } from '$lib/server/emergency-routing';
import { sendCallbackAck } from '$lib/server/callback-ack';
import { isInternalCaller } from '$lib/server/internal-call-guard';

const intent = (o: Partial<Record<string, unknown>>) => ({
	intent_bucket: 'inquiry',
	urgency: 'low',
	sentiment: 'neutral',
	complaints: [],
	opportunity: 'none',
	wants_appointment: false,
	wants_balance: false,
	wants_callback: false,
	confidence: 0.9,
	needs_human_review: false,
	reason: '',
	action_items: [],
	...o
});

const baseCommLog = {
	id: 'comm_1',
	direction: 'inbound' as const,
	companyId: 'company_id',
	customerId: 'customer_id',
	source: '+15551234567',
	destination: '+18005550000',
	content: 'I need help with my account.',
	summary: 'Customer needs help',
	metadata: {},
	type: 'voice' as const,
	status: 'success' as const,
	company: { id: 'company_id', name: 'TestCo', locations: [{ name: 'Main', address: '123 St' }] },
	customer: { id: 'customer_id', name: 'John', phone: '+15551234567', email: 'john@example.com', accountBalance: null },
	communicationThreadId: null,
	userId: null,
	callTrackingCategoryId: null,
	duration: null,
	updated: new Date(),
	created: new Date()
};

function makeComm(overrides: Record<string, any> = {}) {
	return { ...baseCommLog, ...overrides };
}

function resetMocks() {
	vi.clearAllMocks();
	Object.values(mockPrisma).forEach((model: any) => {
		Object.values(model).forEach((fn: any) => {
			if (typeof fn === 'function' && fn.mockClear) fn.mockClear();
		});
	});
	// Restore default mock behaviours
	(classifyMessageIntent as any).mockResolvedValue(intent({}));
	(prisma.communicationLog.findUnique as any).mockImplementation((args: any) => {
		const logId = args?.where?.id;
		return Promise.resolve(makeComm({ id: logId }));
	});
	(prisma.communicationLog.findFirst as any).mockResolvedValue(null);
	(prisma.communicationLog.findMany as any).mockResolvedValue([]);
	(prisma.communicationLog.update as any).mockResolvedValue({});
	(prisma.contact.update as any).mockResolvedValue({});
	(isInternalCaller as any).mockResolvedValue(false);
	(isAffirmative as any).mockReturnValue(false);
	(findPendingProposal as any).mockResolvedValue(null);
	(decideRouting as any).mockReturnValue({ dispatchToTech: false, reason: 'non-emergency' });
	// Line type decides the tier, and the tier decides whether a reply may leave the channel it
	// arrived on. Reset it per test: `clearAllMocks` keeps implementations, so a case that sets
	// 'landline' would otherwise silently suppress SMS for every test after it.
	(getLineType as any).mockResolvedValue('mobile');
}

describe('process_orchestrator', () => {
	beforeEach(resetMocks);

	// ============================================================
	// SAME-CHANNEL RESPONSE RULE (§4.3 / §4.3a)
	// ============================================================

	describe('same-channel response rule', () => {
		/** The decision is recorded on the comm log, so assert it there rather than on a draft
		 *  that this fixture may not produce for unrelated reasons. */
		function tierDecision() {
			const call = (prisma.communicationLog.update as any).mock.calls.find(
				(c: any[]) => (c[0]?.data?.metadata as any)?.identity_tier
			);
			return (call?.[0]?.data?.metadata ?? {}) as Record<string, unknown>;
		}

		// Fresh `metadata` per fixture: `baseCommLog.metadata` is one shared object and the
		// orchestrator mutates it, so a second test would see `orchestrator_processed` from the
		// first and abort as an already-handled retry.
		const noEmail = () =>
			makeComm({ metadata: {}, customer: { ...baseCommLog.customer, email: null } });

		it('a landline caller is Tier 2 and restricted to the line they rang from', async () => {
			const { getLineType } = await import('$lib/server/number-lookup');
			(getLineType as any).mockResolvedValue('landline');
			(prisma.communicationLog.findUnique as any).mockResolvedValue(noEmail());

			await process_orchestrator('comm_1', 'ai_ready');

			expect(tierDecision().identity_tier).toBe('Tier 2');
			expect(tierDecision().same_channel_only).toBe(true);
		});

		it('a mobile caller is Tier 1 and unrestricted — a mobile is one person', async () => {
			const { getLineType } = await import('$lib/server/number-lookup');
			(getLineType as any).mockResolvedValue('mobile');
			(prisma.communicationLog.findUnique as any).mockResolvedValue(noEmail());

			await process_orchestrator('comm_1', 'ai_ready');

			expect(tierDecision().identity_tier).toBe('Tier 1');
			expect(tierDecision().same_channel_only).toBe(false);
		});

		it('a failed lookup is treated as a shared line — never default upward', async () => {
			const { getLineType } = await import('$lib/server/number-lookup');
			(getLineType as any).mockResolvedValue('unknown');
			(prisma.communicationLog.findUnique as any).mockResolvedValue(noEmail());

			await process_orchestrator('comm_1', 'ai_ready');

			expect(tierDecision().identity_tier).toBe('Tier 2');
			expect(tierDecision().same_channel_only).toBe(true);
		});

		it('an email on file lifts the restriction even on a landline', async () => {
			const { getLineType } = await import('$lib/server/number-lookup');
			(getLineType as any).mockResolvedValue('landline');
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({ metadata: {}, customer: { ...baseCommLog.customer, email: 'bert@x.com' } })
			);

			await process_orchestrator('comm_1', 'ai_ready');

			expect(tierDecision().identity_tier).toBe('Tier 1');
			expect(tierDecision().same_channel_only).toBe(false);
		});
	});

	// ============================================================
	// GUARD CLAUSES
	// ============================================================

	describe('guard clauses', () => {
		it('aborts when comm log is missing', async () => {
			(prisma.communicationLog.findUnique as any).mockResolvedValue(null);
			await process_orchestrator('missing_id', 'ai_ready');
			expect(prisma.contact.update).not.toHaveBeenCalled();
			expect(logCommunication).not.toHaveBeenCalled();
		});

		it('aborts when comm log has no companyId', async () => {
			(prisma.communicationLog.findUnique as any).mockResolvedValue(makeComm({ companyId: null }));
			await process_orchestrator('comm_1', 'ai_ready');
			expect(logCommunication).not.toHaveBeenCalled();
		});

		it('aborts when comm log has no customer', async () => {
			(prisma.communicationLog.findUnique as any).mockResolvedValue(makeComm({ customer: null }));
			await process_orchestrator('comm_1', 'ai_ready');
			expect(logCommunication).not.toHaveBeenCalled();
		});

		it('skips non-dialer outbound communications (emergency legs, transfers, server dials)', async () => {
			(prisma.communicationLog.findUnique as any).mockResolvedValue(makeComm({ direction: 'outbound' }));
			await process_orchestrator('comm_1', 'ai_ready');
			expect(logCommunication).not.toHaveBeenCalled();
		});

		it('processes dialer outbound calls (orchestrator may act on their transcript)', async () => {
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({
					direction: 'outbound',
					// Dialer logs are source=company / destination=customer — the orchestrator must
					// flip orientation so the draft goes TO the customer, FROM the company number.
					source: '+18005550000',
					destination: '+15551234567',
					metadata: { dialer_outbound: true }
				})
			);
			await process_orchestrator('comm_1', 'ai_ready');
			const draftCall = (logCommunication as any).mock.calls.find(
				(c: any[]) => c[0]?.status === 'pending_approval' && c[0]?.type === 'sms'
			);
			expect(draftCall).toBeTruthy();
			expect(draftCall[0].source).toBe('+18005550000');
			expect(draftCall[0].destination).toBe('+15551234567');
		});

		it('answers account balance questions on dialer outbound calls', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'billing', wants_balance: true })
			);
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({
					direction: 'outbound',
					source: '+18005550000',
					destination: '+15551234567',
					content: "What's my balance?",
					metadata: { dialer_outbound: true },
					customer: {
						id: 'customer_id',
						name: 'John',
						phone: '+15551234567',
						email: 'john@example.com',
						accountBalance: 1130.0
					}
				})
			);
			await process_orchestrator('comm_dialer_bill', 'ai_ready');
			const smsCall = (logCommunication as any).mock.calls.find(
				(c: any[]) => c[0]?.type === 'sms' && c[0]?.status === 'pending_approval'
			);
			expect(smsCall).toBeTruthy();
			expect(smsCall[0].content).toContain('1130.00');
			expect(smsCall[0].source).toBe('+18005550000');
			expect(smsCall[0].destination).toBe('+15551234567');
		});

		it('aborts if orchestrator_processed is already set (idempotent)', async () => {
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({ metadata: { orchestrator_processed: true } })
			);
			await process_orchestrator('comm_1', 'ai_ready');
			expect(prisma.contact.update).not.toHaveBeenCalled();
			expect(logCommunication).not.toHaveBeenCalled();
		});

		it('aborts for internal callers', async () => {
			(isInternalCaller as any).mockResolvedValue(true);
			await process_orchestrator('comm_1', 'ai_ready');
			expect(logCommunication).not.toHaveBeenCalled();
		});
	});

	// ============================================================
	// EMERGENCY
	// ============================================================

	describe('emergency handling', () => {
		it('auto-dispatches and increments engagement +25 for emergency', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'emergency', urgency: 'high', wants_appointment: true })
			);
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({
					content: 'Water is flooding into my kitchen from a burst pipe!',
					metadata: { ivr_digit: '2' }
				})
			);
			(decideRouting as any).mockReturnValue({ dispatchToTech: true, reason: 'emergency' });
			// Make the company have notification phone numbers for dispatch
			const companyWithSettings = {
				...(makeComm({}).company),
				settings: { notifications: { phone_numbers: [{ number: '+15551111111', name: 'Tech A' }] } }
			};
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({
					content: 'Water is flooding!',
					metadata: { ivr_digit: '2' },
					company: companyWithSettings
				})
			);
			// Ensure commContainer.findFirst returns null (no existing container)
			// and emergency templates return a message
			(prisma.commContainer.findFirst as any).mockResolvedValue(null);

			await process_orchestrator('comm_em', 'ai_ready');

			expect(prisma.contact.update).toHaveBeenCalledWith({
				where: { id: 'customer_id' },
				data: { engagementScore: { increment: 25 } }
			});
			// Emergency dispatch should create pipeline event for SLA
			expect(mockPrisma.pipelineEvent.create).toHaveBeenCalled();
			expect(mockPrisma.commContainer.create).toHaveBeenCalled();
		});

		it('emergency backstop forces emergency when message describes active danger', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'booking', wants_appointment: true })
			);
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({ content: 'My roof is leaking right now, water is coming through the ceiling!' })
			);
			(decideRouting as any).mockReturnValue({ dispatchToTech: true, reason: 'emergency' });

			await process_orchestrator('comm_backstop', 'ai_ready');

			expect(prisma.contact.update).toHaveBeenCalledWith(
				expect.objectContaining({ data: { engagementScore: { increment: 25 } } })
			);
		});

		it('repeat escalation (Scenario 3) when open emergency container exists', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'emergency', urgency: 'high' })
			);
			const existingContainer = {
				id: 'container_emergency',
				commRef: '#5001',
				metadata: {
					active_work_order: {
						slaDeadline: new Date(Date.now() + 600000).toISOString(),
						customerNumber: '+15551234567',
						currentRung: 1,
						dialLadder: [],
						whisperText: 'Emergency'
					}
				}
			};
			(prisma.commContainer.findFirst as any).mockResolvedValue(existingContainer);
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({
					content: 'It is getting worse! Hurry!',
					company: {
						...(makeComm({}).company),
						settings: { notifications: { phone_numbers: [{ number: '+15551111111', name: 'Tech A' }] } }
					}
				})
			);
			(decideRouting as any).mockReturnValue({ dispatchToTech: true, reason: 'emergency' });

			await process_orchestrator('comm_escalation', 'ai_ready');

			expect(prisma.commEntry.findFirst).toHaveBeenCalled();
		});
	});

	// ============================================================
	// BILLING (SCENARIO 1)
	// ============================================================

	describe('billing / Scenario 1', () => {
		it('drafts SMS with balance when customer asks for it', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'billing', wants_balance: true })
			);
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({
					content: 'How much do I owe?',
					customer: { id: 'customer_id', name: 'John', phone: '+15551234567', accountBalance: 1130.00 }
				})
			);
			(logCommunication as any).mockResolvedValue({ id: 'log_out_1' });

			await process_orchestrator('comm_bill_1', 'ai_ready');

			expect(logCommunication).toHaveBeenCalledWith(expect.objectContaining({
				type: 'sms',
				status: 'pending_approval',
				content: expect.stringContaining('1130.00'),
				metadata: expect.objectContaining({ orchestrator_draft: true })
			}));
		});

		it('emails balance statement when customer asks for emailed balance', async () => {
			const { wantsEmailedBalance } = await import('./billing-email');
			(wantsEmailedBalance as any).mockReturnValue(true);
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'billing', wants_balance: true })
			);
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({
					content: 'Please email me my statement.',
					customer: { id: 'customer_id', name: 'John', phone: '+15551234567', email: 'john@example.com', accountBalance: 500.00 }
				})
			);
			(logCommunication as any).mockResolvedValue({ id: 'log_out_2' });

			await process_orchestrator('comm_bill_email', 'ai_ready');

			expect(logCommunication).toHaveBeenCalledWith(expect.objectContaining({
				type: 'email',
				status: 'pending_approval',
				content: expect.stringContaining('Balance')
			}));
		});

		it('informs customer when no outstanding balance', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'billing', wants_balance: true })
			);
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({
					content: 'Do I owe anything?',
					customer: { id: 'customer_id', name: 'Jane', phone: '+15551234567', accountBalance: 0 }
				})
			);
			(logCommunication as any).mockResolvedValue({ id: 'log_out_3' });

			await process_orchestrator('comm_bill_zero', 'ai_ready');

			const smsCall = (logCommunication as any).mock.calls.find((c: any[]) => c[0]?.type === 'sms');
			expect(smsCall).toBeTruthy();
			expect(smsCall[0].content).toContain('no outstanding balance');
			expect(prisma.contact.update).not.toHaveBeenCalled();
		});

		it('does not parrot balance when message is not asking for it', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'billing', wants_balance: false })
			);
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({
					content: 'I will come pay tomorrow.',
					customer: { id: 'customer_id', name: 'Bob', phone: '+15551234567', accountBalance: 500 }
				})
			);
			(logCommunication as any).mockResolvedValue({ id: 'log_out_4' });

			await process_orchestrator('comm_bill_nobalance', 'ai_ready');

			const smsCall = (logCommunication as any).mock.calls.find((c: any[]) => c[0]?.type === 'sms');
			expect(smsCall).toBeTruthy();
			expect(smsCall[0].content).not.toContain('500');
			expect(smsCall[0].content).not.toContain('500.00');
		});
	});

	// ============================================================
	// SALES / BOOKING (SCENARIO 2)
	// ============================================================

	describe('sales / booking / Scenario 2', () => {
		it('goes through booking flow when datetime is present', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'booking', wants_appointment: true })
			);
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({
					content: 'Can I come in Tuesday at 10am?',
					metadata: { ivr_digit: '2', datetime: '2026-08-04T10:00:00' }
				})
			);

			await process_orchestrator('comm_sales_1', 'ai_ready');

			expect(prisma.contact.update).toHaveBeenCalledWith({
				where: { id: 'customer_id' },
				data: { engagementScore: { increment: 10 } }
			});
		});

		it('asks for date when no datetime extracted', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'booking', wants_appointment: true })
			);
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({
					content: 'I want to book a service.',
					metadata: { ivr_digit: '2', datetime: '' }
				})
			);

			await process_orchestrator('comm_sales_2', 'ai_ready');

			const smsCall = (logCommunication as any).mock.calls.find((c: any[]) => c[0]?.type === 'sms');
			expect(smsCall).toBeTruthy();
			expect(smsCall[0].content).toContain('What day and time works best');
		});
	});

	// ============================================================
	// SUPPORT
	// ============================================================

	describe('support', () => {
		it('drafts support acknowledgement', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'inquiry' })
			);

			await process_orchestrator('comm_support_1', 'ai_ready');

			const smsCall = (logCommunication as any).mock.calls.find((c: any[]) => c[0]?.type === 'sms');
			expect(smsCall).toBeTruthy();
			expect(smsCall[0].content.toLowerCase()).toContain('support');
			expect(prisma.contact.update).not.toHaveBeenCalled();
		});

		it('triggers meeting confirmation when appointment requested in support call', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'inquiry', wants_appointment: true, email: 'caller@test.com' })
			);
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({
					content: 'Can I come in to discuss this?',
					metadata: { datetime: '2026-08-05T14:00:00', ivr_digit: '3' }
				})
			);

			await process_orchestrator('comm_support_appt', 'ai_ready');

			const smsCall = (logCommunication as any).mock.calls.find((c: any[]) => c[0]?.type === 'sms');
			expect(smsCall).toBeTruthy();
		});
	});

	// ============================================================
	// NO CUSTOMER MESSAGE
	// ============================================================

	describe('no customer message', () => {
		it('drafts missed-call acknowledgement when no voicemail left', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'inquiry' })
			);
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({
					content: 'Call completed (30s)',
					metadata: { ivr_digit: '2' }
				})
			);

			await process_orchestrator('comm_nomsg', 'ai_ready');

			const smsCall = (logCommunication as any).mock.calls.find((c: any[]) => c[0]?.type === 'sms');
			expect(smsCall).toBeTruthy();
			expect(smsCall[0].content).toContain('sorry we missed your call');
		});
	});

	// ============================================================
	// AFFIRMATIVE BOOKING REPLY
	// ============================================================

	describe('affirmative booking reply', () => {
		it('auto-books when customer affirms a pending proposal', async () => {
			(isAffirmative as any).mockReturnValue(true);
			(findPendingProposal as any).mockResolvedValue({
				commId: 'proposal_comm',
				proposal: {
					proposedLabel: 'Tuesday Aug 4 at 10:00 AM',
					proposedStartISO: '2026-08-04T10:00:00Z',
					proposedEndISO: '2026-08-04T11:00:00Z'
				}
			});
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'booking' })
			);

			await process_orchestrator('comm_affirm', 'ai_ready');

			const smsCall = (logCommunication as any).mock.calls.find((c: any[]) => c[0]?.type === 'sms');
			expect(smsCall).toBeTruthy();
			expect(smsCall[0].content).toContain('all set');
			expect(prisma.contact.update).toHaveBeenCalledWith({
				where: { id: 'customer_id' },
				data: { engagementScore: { increment: 10 } }
			});
		});
	});

	// ============================================================
	// CALLBACK ACK
	// ============================================================

	describe('callback acknowledgement', () => {
		it('sends callback ack when AI detects callback request', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'inquiry', wants_callback: true })
			);

			await process_orchestrator('comm_callback', 'ai_ready');

			expect(sendCallbackAck).toHaveBeenCalledWith(expect.objectContaining({
				companyId: 'company_id',
				phone: '+15551234567'
			}));
		});
	});

	// ============================================================
	// EMAIL DRAFTING
	// ============================================================

	describe('email drafting', () => {
		it('drafts email when requested_contact_method is email', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'billing', wants_balance: true })
			);
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({
					content: 'Please email my balance.',
					metadata: { requested_contact_method: 'email' },
					type: 'email',
					customer: { id: 'customer_id', name: 'John', phone: '+15551234567', email: 'john@example.com', accountBalance: 500 }
				})
			);

			await process_orchestrator('comm_email', 'ai_ready');

			const emailCall = (logCommunication as any).mock.calls.find((c: any[]) => c[0]?.type === 'email');
			expect(emailCall).toBeTruthy();
			expect(emailCall[0].status).toBe('pending_approval');
			expect(emailCall[0].metadata.confirm_email).toBe(true);
		});
	});

	// ============================================================
	// RECLASSIFICATION
	// ============================================================

	describe('reclassification', () => {
		it('reclassifies: pressed Billing but message is support → no balance reply', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'inquiry' })
			);
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({
					content: 'I need help with my roof leak.',
					metadata: { ivr_digit: '1' },
					customer: { id: 'customer_id', name: 'Roof Guy', phone: '+15551234567', accountBalance: 1130.00 }
				})
			);

			await process_orchestrator('comm_reclass', 'ai_ready');

			const smsCall = (logCommunication as any).mock.calls.find((c: any[]) => c[0]?.type === 'sms');
			expect(smsCall).toBeTruthy();
			expect(smsCall[0].content).not.toContain('1130');
			expect(prisma.contact.update).not.toHaveBeenCalled();
		});
	});

	// ============================================================
	// ENGAGEMENT SCORE
	// ============================================================

	describe('engagement score', () => {
		it('adds +25 for emergency', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'emergency', urgency: 'high' })
			);
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({ content: 'Fire!', metadata: {} })
			);
			(decideRouting as any).mockReturnValue({ dispatchToTech: true, reason: 'emergency' });

			await process_orchestrator('comm_score_em', 'ai_ready');
			expect(prisma.contact.update).toHaveBeenCalledWith({
				where: { id: 'customer_id' },
				data: { engagementScore: { increment: 25 } }
			});
		});

		it('adds +10 for sales/booking', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'booking', wants_appointment: true })
			);
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({ content: 'Book me please', metadata: { ivr_digit: '2' } })
			);

			await process_orchestrator('comm_score_sales', 'ai_ready');
			expect(prisma.contact.update).toHaveBeenCalledWith({
				where: { id: 'customer_id' },
				data: { engagementScore: { increment: 10 } }
			});
		});

		it('adds 0 for support/inquiry', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'inquiry' })
			);

			await process_orchestrator('comm_score_support', 'ai_ready');
			expect(prisma.contact.update).not.toHaveBeenCalled();
		});
	});

	// ============================================================
	// COMMAND REGISTRY
	// ============================================================

	describe('command registry integration', () => {
		it('dispatches wants_appointment as set_appointment command', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'booking', wants_appointment: true })
			);
			(prisma.communicationLog.findUnique as any).mockResolvedValue(
				makeComm({ metadata: { datetime: '2026-08-04T10:00:00', ivr_digit: '2' } })
			);

			await process_orchestrator('comm_cmd_appt', 'ai_ready');

			expect(executeInstructions).toHaveBeenCalled();
			const ctx = (executeInstructions as any).mock.calls[0][0];
			expect(ctx.companyId).toBe('company_id');
			expect(ctx.customerId).toBe('customer_id');
		});

		it('dispatches action_items as create_task commands', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({
					intent_bucket: 'inquiry',
					action_items: ['Follow up on quote', 'Send estimate'],
				})
			);

			await process_orchestrator('comm_cmd_tasks', 'ai_ready');

			expect(executeInstructions).toHaveBeenCalled();
			const instructions = (executeInstructions as any).mock.calls[0][1];
			expect(instructions.length).toBeGreaterThanOrEqual(2);
			const taskCmds = instructions.filter((i: any) => i.command === 'create_task');
			expect(taskCmds.length).toBe(2);
		});

		it('does not dispatch commands when AI intent has no actionable fields', async () => {
			(classifyMessageIntent as any).mockResolvedValue(
				intent({ intent_bucket: 'inquiry', wants_appointment: false, wants_callback: false, action_items: [] })
			);

			await process_orchestrator('comm_cmd_none', 'ai_ready');

			// executeInstructions may be called with empty array
			const call = (executeInstructions as any).mock.calls[0];
			if (call) {
				expect(call[1]).toHaveLength(0);
			}
		});
	});

	// ============================================================
	// THREAD MATCHING
	// ============================================================

	describe('thread matching', () => {
		it('attempts semantic thread matching for recent messages from same caller', async () => {
			(prisma.communicationLog.findMany as any).mockResolvedValue([
				{ id: 'prev_1', content: 'I called about my bill last week', communicationThreadId: 'thread_prev' }
			]);
			const { matchThreadOpenAI } = await import('./openai');
			(matchThreadOpenAI as any).mockResolvedValue('prev_1');

			await process_orchestrator('comm_thread', 'ai_ready');

			expect(matchThreadOpenAI).toHaveBeenCalled();
			expect(prisma.communicationLog.update).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: 'comm_thread' },
					data: expect.objectContaining({
						communicationThreadId: 'thread_prev'
					})
				})
			);
		});

		it('handles thread matching gracefully when no recent messages', async () => {
			(prisma.communicationLog.findMany as any).mockResolvedValue([]);
			await process_orchestrator('comm_thread_empty', 'ai_ready');
			// Should not error — just skip matching
			expect(prisma.communicationLog.update).toHaveBeenCalled();
		});
	});

	// ============================================================
	// ORCHESTRATOR METADATA
	// ============================================================

	describe('orchestrator output', () => {
		it('always saves orchestrator_logs + orchestrator_processed on the comm log', async () => {
			await process_orchestrator('comm_meta', 'ai_ready');

			const updateCall = (prisma.communicationLog.update as any).mock.calls.find(
				(c: any[]) => c[0]?.where?.id === 'comm_meta'
			);
			expect(updateCall).toBeTruthy();
			const meta = updateCall[1].data.metadata;
			expect(meta.orchestrator_processed).toBe(true);
			expect(Array.isArray(meta.orchestrator_logs)).toBe(true);
			expect(meta.orchestrator_logs.length).toBeGreaterThan(0);
		});
	});
});
