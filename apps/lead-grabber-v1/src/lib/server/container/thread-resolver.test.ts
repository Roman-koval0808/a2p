import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	openContainerCandidatesFor,
	companyOpenCandidatesFor,
	matchContinuationToCandidates,
	resolveContextContainer,
	appendEntryToContainer,
	linkCommunicationLogToContainer
} from './thread-resolver';

const { mockPrisma } = vi.hoisted(() => ({
	mockPrisma: {
		commContainer: {
			findMany: vi.fn(),
			findUnique: vi.fn(),
			update: vi.fn()
		},
		pipelineCustomerProfile: { findMany: vi.fn() },
		commEntry: { create: vi.fn() },
		communicationLog: { findUnique: vi.fn(), update: vi.fn() },
		communicationThread: { upsert: vi.fn() }
	}
}));

vi.mock('$lib/db', () => ({ prisma: mockPrisma }));
vi.mock('$env/static/private', () => ({ ANTHROPIC_AI_KEY: 'test-key' }));

const candidate = (over: Partial<any> = {}) => ({
	id: 'cnt_email_1',
	commRef: '#1001',
	subject: 'Re: appointment Friday 10am',
	threadType: 'sales',
	state: 'open',
	openedAt: new Date('2026-08-02T10:00:00Z'),
	lastActivityAt: new Date('2026-08-03T09:00:00Z'),
	snippet: 'Re: appointment Friday 10am — see you Friday at ten',
	entries: [],
	...over
});

beforeEach(() => {
	vi.clearAllMocks();
	// A comm container with 2 entries for snippet-building tests.
	mockPrisma.commContainer.findMany.mockResolvedValue([
		{
			...candidate({}),
			entries: [
				{ transcript: 'We had a maintenance issue with the furnace.', analysisJson: null },
				{ transcript: 'Let me check my schedule.', analysisJson: null }
			]
		}
	]);
	mockPrisma.pipelineCustomerProfile.findMany.mockResolvedValue([]);
});

describe('openContainerCandidatesFor — identity scoping', () => {
	it('returns [] when no identity is resolvable', async () => {
		mockPrisma.commContainer.findMany.mockResolvedValue([]);
		const out = await openContainerCandidatesFor({ companyId: 'comp_1' });
		expect(out).toEqual([]);
		expect(mockPrisma.commContainer.findMany).not.toHaveBeenCalled();
	});

	it('collects profile ids from phone + email identifiers', async () => {
		mockPrisma.pipelineCustomerProfile.findMany.mockResolvedValue([{ id: 'prof_a' }]);
		mockPrisma.commContainer.findMany.mockResolvedValue([candidate({})]);

		await openContainerCandidatesFor({
			companyId: 'comp_1',
			contactId: 'contact_1',
			phone: '+17865550123',
			email: 'roman@outlook.com'
		});

		// Profile lookup requested for the phone/email identity
		expect(mockPrisma.pipelineCustomerProfile.findMany).toHaveBeenCalled();
		// Container query scoped by contact + profile ids, excludes nothing yet
		const args = mockPrisma.commContainer.findMany.mock.calls[0][0];
		expect(args.where.companyId).toBe('comp_1');
		expect(args.where.state.not).toBe('closed');
		expect(args.where.OR).toEqual([
			{ contactId: 'contact_1' },
			{ customerProfileId: { in: ['prof_a'] } }
		]);
	});

	it('excludes containers passed in excludeCommIds', async () => {
		mockPrisma.commContainer.findMany.mockResolvedValue([candidate({})]);
		mockPrisma.pipelineCustomerProfile.findMany.mockResolvedValue([]);
		await openContainerCandidatesFor({
			companyId: 'comp_1',
			contactId: 'contact_1',
			excludeCommIds: ['c_own']
		});
		const where = mockPrisma.commContainer.findMany.mock.calls[0][0].where;
		expect(where.id.notIn).toEqual(['c_own']);
	});

	it('builds snippets from subject + recent entries (newest last)', async () => {
		mockPrisma.pipelineCustomerProfile.findMany.mockResolvedValue([]);
		const out = await openContainerCandidatesFor({ companyId: 'comp_1', contactId: 'contact_1' });
		expect(out[0].snippet).toContain('maintenance issue');
		expect(out[0].snippet).toContain('Re: appointment');
	});
});

describe('matchContinuationToCandidates — AI decision + no-hallucination', () => {
	it('returns no_match with no candidates and does not call AI', async () => {
		const ai = vi.fn();
		const out = await matchContinuationToCandidates(
			{ channel: 'sms', direction: 'inbound', content: 'hi' },
			[],
			{ ai }
		);
		expect(out.matched).toBe(false);
		expect(out.reason).toBe('no_open_candidates');
		expect(ai).not.toHaveBeenCalled();
	});

	it('links when the AI returns a known commRef with high confidence', async () => {
		const ai = vi.fn().mockResolvedValue({
			linked: true,
			commRef: '#1001',
			confidence: 0.91,
			reason: 'replying to the appointment email'
		});
		const out = await matchContinuationToCandidates(
			{ channel: 'sms', direction: 'inbound', content: 'Monday works better for me' },
			[candidate()],
			{ ai }
		);
		expect(out).toEqual({
			matched: true,
			commId: 'cnt_email_1',
			confidence: 0.91,
			reason: 'replying to the appointment email'
		});
	});

	it('does NOT link when the AI says it is a new topic', async () => {
		const ai = vi.fn().mockResolvedValue({
			linked: false,
			commRef: '',
			confidence: 0.2,
			reason: 'unrelated question'
		});
		const out = await matchContinuationToCandidates(
			{ channel: 'voice', direction: 'inbound', content: 'I need to change my billing address' },
			[candidate()],
			{ ai }
		);
		expect(out.matched).toBe(false);
	});

	it('does NOT link below the confidence threshold', async () => {
		const ai = vi.fn().mockResolvedValue({
			linked: true,
			commRef: '#1001',
			confidence: 0.4,
			reason: 'maybe?'
		});
		const out = await matchContinuationToCandidates(
			{ channel: 'sms', direction: 'inbound', content: 'hello' },
			[candidate()],
			{ ai }
		);
		expect(out.matched).toBe(false);
		expect(out.reason).toBe('low_confidence');
	});

	it('does NOT link when the AI returns an unknown commRef', async () => {
		const ai = vi.fn().mockResolvedValue({
			linked: true,
			commRef: '#9999',
			confidence: 0.9,
			reason: 'wrong'
		});
		const out = await matchContinuationToCandidates(
			{ channel: 'email', direction: 'inbound', content: 'hi' },
			[candidate()],
			{ ai }
		);
		expect(out.matched).toBe(false);
		expect(out.reason).toBe('ai_returned_unknown_ref');
	});

	it('treats an AI failure as no_match', async () => {
		const ai = vi.fn().mockResolvedValue(null);
		const out = await matchContinuationToCandidates(
			{ channel: 'voice', direction: 'inbound', content: 'hi' },
			[candidate()],
			{ ai }
		);
		expect(out.matched).toBe(false);
		expect(out.reason).toBe('ai_unavailable');
	});
});

describe('companyOpenCandidatesFor — company-wide fallback', () => {
	it('scopes by company, excludes closed/merged, filters on recent activity', async () => {
		mockPrisma.commContainer.findMany.mockResolvedValue([candidate({})]);
		await companyOpenCandidatesFor('comp_1');
		const where = mockPrisma.commContainer.findMany.mock.calls[0][0].where;
		expect(where.companyId).toBe('comp_1');
		expect(where.state.not).toBe('closed');
		expect(where.lifecycle.not).toBe('merged');
		expect(where.lastActivityAt.gte).toBeInstanceOf(Date);
		expect(mockPrisma.commContainer.findMany.mock.calls[0][0].take).toBe(15);
	});

	it('honors windowDays, limit, and excludeCommIds', async () => {
		mockPrisma.commContainer.findMany.mockResolvedValue([candidate({})]);
		await companyOpenCandidatesFor('comp_1', {
			windowDays: 3,
			limit: 4,
			excludeCommIds: ['c_own']
		});
		const call = mockPrisma.commContainer.findMany.mock.calls[0][0];
		expect(call.where.id.notIn).toEqual(['c_own']);
		expect(call.take).toBe(4);
		const cutoff = Date.now() - 3 * 24 * 3600 * 1000;
		expect((call.where.lastActivityAt.gte as Date).getTime()).toBeGreaterThan(cutoff - 5000);
	});

	it('builds snippets from subject + recent entries', async () => {
		mockPrisma.commContainer.findMany.mockResolvedValue([
			{
				...candidate({}),
				entries: [
					{ transcript: 'We proposed Monday at 10.', analysisJson: null },
					{ transcript: 'What time works for you?', analysisJson: null }
				]
			}
		]);
		const out = await companyOpenCandidatesFor('comp_1');
		expect(out[0].snippet).toContain('proposed Monday');
		expect(out[0].snippet).toContain('Re: appointment');
	});
});

describe('resolveContextContainer — universal cross-channel matching', () => {
	it('appends an inbound SMS reply to the matching outbound-email container', async () => {
		mockPrisma.pipelineCustomerProfile.findMany.mockResolvedValue([]);
		mockPrisma.commContainer.findMany.mockResolvedValue([candidate({})]);
		const ai = vi.fn().mockResolvedValue({
			linked: true,
			commRef: '#1001',
			confidence: 0.9,
			reason: 'response to the appointment request'
		});
		const result = await resolveContextContainer(
			{
				companyId: 'comp_1',
				contactId: 'contact_1',
				channel: 'sms',
				direction: 'inbound',
				content: 'Monday at 10 works instead of Friday',
				excludeCommIds: undefined
			},
			{ ai }
		);
		expect(result.matched).toBe(true);
		expect(result.commId).toBe('cnt_email_1');
		expect(result.candidate?.commRef).toBe('#1001');
		// The AI prompt included the container's context.
		expect(String(ai.mock.calls[0][0])).toContain('#1001');
	});

	it('matches an OUTBOUND company reply (outbound leg support)', async () => {
		mockPrisma.pipelineCustomerProfile.findMany.mockResolvedValue([]);
		mockPrisma.commContainer.findMany.mockResolvedValue([candidate({})]);
		const ai = vi.fn().mockResolvedValue({
			linked: true,
			commRef: '#1001',
			confidence: 0.88,
			reason: 'replying to their email about the furnace'
		});
		const result = await resolveContextContainer(
			{
				companyId: 'comp_1',
				contactId: 'contact_1',
				channel: 'email',
				direction: 'outbound',
				subject: 'Re: furnace maintenance',
				content: 'We can send a tech Thursday morning.'
			},
			{ ai }
		);
		expect(result.matched).toBe(true);
		expect(result.commId).toBe('cnt_email_1');
	});

	it('falls back to company-wide candidates for a brand-new customer', async () => {
		mockPrisma.pipelineCustomerProfile.findMany.mockResolvedValue([]);
		// No containers under the caller's own identity → company-wide fallback.
		mockPrisma.commContainer.findMany
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([candidate({})]);
		const ai = vi.fn().mockResolvedValue({
			linked: true,
			commRef: '#1001',
			confidence: 0.85,
			reason: 'texting back about the emailed quote'
		});
		const result = await resolveContextContainer(
			{
				companyId: 'comp_1',
				contactId: 'contact_1',
				channel: 'sms',
				direction: 'inbound',
				content: 'The quote works — let us schedule it.'
			},
			{ ai }
		);
		expect(mockPrisma.commContainer.findMany).toHaveBeenCalledTimes(2);
		expect(result.matched).toBe(true);
		expect(result.commId).toBe('cnt_email_1');
	});

	it('returns no_match when there are no open candidates anywhere', async () => {
		mockPrisma.commContainer.findMany.mockResolvedValue([]);
		const result = await resolveContextContainer({
			companyId: 'comp_1',
			contactId: 'contact_1',
			channel: 'voice',
			direction: 'inbound',
			content: 'hello'
		});
		expect(result.matched).toBe(false);
		expect(result.reason).toBe('no_open_candidates');
	});
});

describe('appendEntryToContainer', () => {
	it('creates the entry and reopens a closed container', async () => {
		mockPrisma.commEntry.create.mockResolvedValue({ id: 'entry_1' });
		mockPrisma.commContainer.findUnique.mockResolvedValue({
			id: 'c_email_1',
			state: 'closed'
		});
		mockPrisma.commContainer.update.mockResolvedValue({ id: 'c_email_1' });

		const entry = await appendEntryToContainer(mockPrisma, {
			commId: 'c_email_1',
			direction: 'inbound',
			channel: 'sms',
			fromParty: '+17865550123',
			toParty: '+17055550100',
			transcript: 'Monday is fine'
		});

		expect(entry.id).toBe('entry_1');
		expect(mockPrisma.commEntry.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ commId: 'c_email_1', channel: 'sms' })
			})
		);
		expect(mockPrisma.commContainer.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ state: 'open' })
			})
		);
	});
});

describe('linkCommunicationLogToContainer', () => {
	it('bridges the thread and stamps commRef + merged info on the log', async () => {
		mockPrisma.communicationLog.findUnique.mockResolvedValue({
			id: 'log_call_1',
			companyId: 'comp_1',
			customerId: 'contact_1',
			communicationThreadId: 'legacy_thread_1',
			summary: 'about the appointment',
			metadata: { ivr_intent: 'sales' }
		});
		mockPrisma.communicationThread.upsert.mockResolvedValue({});
		mockPrisma.communicationLog.update.mockResolvedValue({});

		await linkCommunicationLogToContainer(
			'log_call_1',
			{ id: 'c_email_1', commRef: '#1001' },
			'cross_channel_continuation',
			{ companyId: 'comp_1', contactId: 'contact_1' }
		);

		expect(mockPrisma.communicationThread.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: 'c_email_1' } })
		);
		const update = mockPrisma.communicationLog.update.mock.calls[0][0];
		expect(update.data.communicationThreadId).toBe('c_email_1');
		expect(update.data.metadata.commContainerId).toBe('c_email_1');
		expect(update.data.metadata.commRef).toBe('#1001');
		expect(update.data.metadata.thread_merge.mergedInto).toBe('c_email_1');
	});
});
