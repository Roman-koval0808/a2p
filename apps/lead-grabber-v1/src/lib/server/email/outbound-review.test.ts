import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reviewOutboundEmail } from './outbound-review';

const { mocks } = vi.hoisted(() => ({
	mocks: {
		db: {
			communicationLog: { findUnique: vi.fn(), update: vi.fn() },
			company: { findUnique: vi.fn() }
		},
		analyzeCallLog: vi.fn(),
		containerService: {
			classifyThreadType: vi.fn(),
			createContainerAtIntake: vi.fn(),
			createTask: vi.fn()
		},
		registerTimer: vi.fn(),
		resolver: {
			resolveContextContainer: vi.fn(),
			appendEntryToContainer: vi.fn(),
			linkCommunicationLogToContainer: vi.fn()
		}
	}
}));

vi.mock('$lib/db', () => ({ prisma: mocks.db }));
vi.mock('$lib/server/openai', () => ({ analyzeCallLog: mocks.analyzeCallLog }));
vi.mock('$lib/server/container/container-service', () => mocks.containerService);
vi.mock('$lib/server/timer/timer-service', () => ({ registerTimer: mocks.registerTimer }));
vi.mock('$lib/server/container/thread-resolver', () => mocks.resolver);
vi.mock('$env/static/private', () => ({ ANTHROPIC_AI_KEY: 'test' }));

const log = (over: Partial<any> = {}) => ({
	id: 'log_email_1',
	companyId: 'comp_1',
	customerId: 'contact_1',
	type: 'email',
	direction: 'outbound',
	content: 'Hi Roman, your furnace checkup is scheduled Friday 10am...',
	subject: 'Re: scheduling your furnace checkup',
	metadata: {},
	...over
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.db.communicationLog.findUnique.mockResolvedValue(log({}));
	mocks.db.company.findUnique.mockResolvedValue({ id: 'comp_1', ownerId: 'owner_1' });
	mocks.db.communicationLog.update.mockResolvedValue({});
	mocks.analyzeCallLog.mockResolvedValue({
		intent: 'sales',
		topic: 'furnace checkup',
		actionItems: ['Follow up tomorrow', 'Send a quote']
	});
	mocks.containerService.classifyThreadType.mockReturnValue('sales');
	mocks.containerService.createContainerAtIntake.mockResolvedValue({
		container: { id: 'cnt_out_1', commRef: '#1002' }
	});
	mocks.containerService.createTask.mockResolvedValue({});
	mocks.registerTimer.mockResolvedValue({});
	mocks.resolver.resolveContextContainer.mockResolvedValue({
		matched: false,
		candidates: [],
		reason: 'no_open_candidates'
	});
	mocks.resolver.appendEntryToContainer.mockResolvedValue({ id: 'entry_out_1' });
	mocks.resolver.linkCommunicationLogToContainer.mockResolvedValue({});
});

describe('reviewOutboundEmail', () => {
	it('creates a new container, tasks, timer, and stamps reviewed when no candidate matches', async () => {
		const result = await reviewOutboundEmail({
			companyId: 'comp_1',
			logId: 'l_email_1',
			content: 'Contract floor, your callback is scheduled...',
			subject: 'Re: Your furnace checkup',
			customerEmail: 'roman@outlook.com',
			customerPhone: undefined,
			customerContactId: 'contact_1',
			customerProfileId: undefined,
			fromEmail: 'kate@plumbingpros.com'
		});

		expect(result.reviewed).toBe(true);
		expect(mocks.containerService.createContainerAtIntake).toHaveBeenCalledTimes(1);
		expect(mocks.resolver.appendEntryToContainer).toHaveBeenCalledTimes(1);
		expect(mocks.containerService.createTask).toHaveBeenCalledTimes(2);
		expect(mocks.registerTimer).toHaveBeenCalledTimes(1);
		expect(mocks.resolver.linkCommunicationLogToContainer).toHaveBeenCalledWith(
			'l_email_1',
			expect.objectContaining({ id: 'cnt_out_1', commRef: '#1002' }),
			expect.any(String),
			expect.objectContaining({ companyId: 'comp_1' })
		);
		expect(mocks.db.communicationLog.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					metadata: expect.objectContaining({ outbound_reviewed: true })
				})
			})
		);
	});

	it('creates a task per action item with owner + 48h due', async () => {
		await reviewOutboundEmail({
			companyId: 'comp_1',
			logId: 'l_email_1',
			content: '...',
			subject: 'Re: checkup',
			customerEmail: 'r@o.com',
			customerContactId: 'contact_1',
			fromEmail: 'k@plumbingpros.com'
		});

		const taskCalls = mocks.containerService.createTask.mock.calls;
		expect(taskCalls.length).toBe(2);
		const args = taskCalls[0][1];
		expect(args.commId).toBe('cnt_out_1');
		expect(args.ownerUserId).toBe('owner_1');
		expect(args.confidence).toBeDefined();
		expect(args.category).toBe('internal_followup');
		// 48h due
		const due = args.due;
		const deltaMs = due.getTime() - Date.now();
		expect(deltaMs).toBeGreaterThan(47 * 3600 * 1000);
		expect(deltaMs).toBeLessThan(49 * 3600 * 1000);
	});

	it('skips work when the log was already reviewed', async () => {
		mocks.db.communicationLog.findUnique.mockResolvedValue(
			log({ metadata: { outbound_reviewed: true } })
		);

		const result = await reviewOutboundEmail({
			companyId: 'comp_1',
			logId: 'l_email_1',
			content: '...',
			subject: 'Re: your',
			customerEmail: 'r@o.com',
			customerContactId: 'contact_1',
			fromEmail: 'x@p.com'
		});

		expect(result.reviewed).toBe(false);
		expect(result.reason).toBe('already_reviewed');
		expect(mocks.containerService.createContainerAtIntake).not.toHaveBeenCalled();
		expect(mocks.resolver.appendEntryToContainer).not.toHaveBeenCalled();
	});

	it('skips when the log cannot be found', async () => {
		mocks.db.communicationLog.findUnique.mockResolvedValue(null);
		const result = await reviewOutboundEmail({
			companyId: 'comp_1',
			logId: 'missing',
			content: '...',
			subject: 'Re: your',
			customerEmail: 'r@o.com',
			customerContactId: 'contact_1',
			fromEmail: 'x@p.com'
		});
		expect(result.reviewed).toBe(false);
		expect(result.reason).toBe('log_not_found');
		expect(mocks.db.communicationLog.update).not.toHaveBeenCalled();
	});

	it('reuses an existing matching container instead of creating a new one', async () => {
		mocks.resolver.resolveContextContainer.mockResolvedValue({
			matched: true,
			commId: 'c_email_1',
			candidate: { id: 'c_email_1', commRef: '#1001' },
			candidates: [{ id: 'c_email_1', commRef: '#1001' }]
		});

		await reviewOutboundEmail({
			companyId: 'comp_1',
			logId: 'l_email_1',
			content: '...',
			subject: 'Re: your',
			customerEmail: 'r@o.com',
			customerContactId: 'contact_1',
			fromEmail: 'x@p.com'
		});

		expect(mocks.containerService.createContainerAtIntake).not.toHaveBeenCalled();
		expect(mocks.resolver.linkCommunicationLogToContainer).toHaveBeenCalledWith(
			'l_email_1',
			expect.objectContaining({ id: 'c_email_1', commRef: '#1001' }),
			expect.any(String),
			expect.any(Object)
		);
	});

	it('records a proposed_appointment when the sent email proposed a time', async () => {
		mocks.analyzeCallLog.mockResolvedValue({
			intent: 'sales',
			summary: 'Proposing the furnace checkup Monday at 10am.',
			datetime: '2026-08-10T10:00:00-04:00',
			actionItems: []
		});
		mocks.resolver.resolveContextContainer.mockResolvedValue({
			matched: false,
			candidates: [],
			reason: 'no_open_candidates'
		});

		const result = await reviewOutboundEmail({
			companyId: 'comp_1',
			logId: 'l_email_1',
			content: 'Proposing the furnace checkup Monday at 10am.',
			subject: 'Re: your furnace checkup',
			customerEmail: 'r@o.com',
			customerContactId: 'contact_1',
			fromEmail: 'x@p.com'
		});

		expect(result.reviewed).toBe(true);
		const update = mocks.db.communicationLog.update.mock.calls[0][0];
		const proposal = update.data.metadata.proposed_appointment;
		expect(proposal).toBeDefined();
		expect(proposal.booked).toBe(false);
		expect(proposal.proposedStartISO).toBeDefined();
		expect(proposal.proposedLabel).toContain('Aug');
		expect(update.data.metadata.outbound_review.proposed).toBe(true);
	});
});
