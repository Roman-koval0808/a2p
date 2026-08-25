import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	openContainerCandidatesFor,
	companyOpenCandidatesFor,
	matchContinuationToCandidates,
	resolveContextContainer,
	resolveAndLinkContext,
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
		communicationThread: { upsert: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) }
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

describe('resolveAndLinkContext — universal entry point for non-orchestrator handlers', () => {
	const outboundSmsLog = {
		id: 'log_sms_out_1',
		companyId: 'comp_1',
		customerId: 'contact_1',
		type: 'sms',
		direction: 'outbound',
		source: '+17055550100',
		destination: '+17865550123',
		summary: 'Monday at 10 works',
		content: 'Monday at 10 works',
		communicationThreadId: null,
		created: new Date('2026-08-03T10:00:00Z'),
		metadata: {}
	};

	it('merges an outbound SMS into the container it continues (cross-channel)', async () => {
		mockPrisma.communicationLog.findUnique.mockResolvedValue(outboundSmsLog);
		mockPrisma.commContainer.findMany.mockResolvedValue([candidate({})]);
		mockPrisma.commContainer.findUnique.mockResolvedValue({ id: 'cnt_email_1', state: 'open' });
		mockPrisma.commEntry.create.mockResolvedValue({ id: 'entry_1' });
		mockPrisma.communicationThread.upsert.mockResolvedValue({});
		mockPrisma.communicationLog.update.mockResolvedValue({});
		const ai = vi.fn().mockResolvedValue({
			linked: true,
			commRef: '#1001',
			confidence: 0.9,
			reason: 'continuing the emailed appointment'
		});

		const result = await resolveAndLinkContext('log_sms_out_1', { ai });

		expect(result.resolved).toBe(true);
		expect(result.containerId).toBe('cnt_email_1');
		expect(result.commRef).toBe('#1001');
		// Entry appended for the outbound leg with rep → customer parties.
		expect(mockPrisma.commEntry.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					commId: 'cnt_email_1',
					direction: 'outbound',
					channel: 'sms',
					fromPartyType: 'rep',
					toPartyType: 'customer'
				})
			})
		);
		// Log re-linked to the container with the shared COM id.
		const update = mockPrisma.communicationLog.update.mock.calls[0][0];
		expect(update.where.id).toBe('log_sms_out_1');
		expect(update.data.communicationThreadId).toBe('cnt_email_1');
		expect(update.data.metadata.commRef).toBe('#1001');
		expect(update.data.metadata.thread_merge.mergedInto).toBe('cnt_email_1');
	});

	it('leaves the message on its own thread when the AI says no-match', async () => {
		mockPrisma.communicationLog.findUnique.mockResolvedValue(outboundSmsLog);
		mockPrisma.commContainer.findMany.mockResolvedValue([candidate({})]);
		const ai = vi.fn().mockResolvedValue({
			linked: false,
			commRef: '',
			confidence: 0.3,
			reason: 'new topic'
		});

		const result = await resolveAndLinkContext('log_sms_out_1', { ai });

		expect(result.resolved).toBe(false);
		expect(mockPrisma.commEntry.create).not.toHaveBeenCalled();
		expect(mockPrisma.communicationLog.update).not.toHaveBeenCalled();
	});

	it('skips logs already anchored to a container', async () => {
		mockPrisma.communicationLog.findUnique.mockResolvedValue({
			...outboundSmsLog,
			communicationThreadId: 'cnt_existing',
			metadata: { commContainerId: 'cnt_existing', commRef: '#2000' }
		});

		const result = await resolveAndLinkContext('log_sms_out_1');

		expect(result.resolved).toBe(false);
		expect(result.reason).toBe('already_linked');
		expect(mockPrisma.commContainer.findMany).not.toHaveBeenCalled();
	});

	it('returns log_not_found and never throws', async () => {
		mockPrisma.communicationLog.findUnique.mockResolvedValue(null);
		const result = await resolveAndLinkContext('missing');
		expect(result.resolved).toBe(false);
		expect(result.reason).toBe('log_not_found');
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

	// Regression: a container is a SESSION, one per arriving message. `communicationThreadId` is
	// the ENGAGEMENT, and the ENG code the comm log shows. Letting the container overwrite it made
	// every message its own engagement — one customer's two texts came back as two ENG codes
	// minutes apart. A thread carrying `rulesVersion` was assigned by the engagement rule and is
	// off limits; the COM id still gets stamped in metadata either way.
	it('leaves a thread the engagement rule assigned where it is', async () => {
		mockPrisma.communicationLog.findUnique.mockResolvedValue({
			id: 'log_sms_2',
			companyId: 'comp_1',
			customerId: 'contact_1',
			communicationThreadId: 'eng_thread_1',
			summary: 'blocked drain',
			metadata: {}
		});
		mockPrisma.communicationThread.findUnique.mockResolvedValue({
			rulesVersion: 'engagement_resolution_v1'
		});
		mockPrisma.communicationLog.update.mockResolvedValue({});

		await linkCommunicationLogToContainer(
			'log_sms_2',
			{ id: 'cnt_own', commRef: '#7825' },
			'context_continuation',
			{ companyId: 'comp_1', contactId: 'contact_1' }
		);

		const update = mockPrisma.communicationLog.update.mock.calls[0][0];
		expect(update.data.communicationThreadId).toBeUndefined();
		// The COM id the function exists to share is still recorded.
		expect(update.data.metadata.commRef).toBe('#7825');
		expect(update.data.metadata.commContainerId).toBe('cnt_own');
	});
});

describe('resolveContextContainer — self-match guard', () => {
	// Regression: the ProfileDB pipeline pre-creates a container for each arriving message. It was
	// offered back as a candidate and the matcher linked the message to ITSELF ("exact match to the
	// snippet"), leaving the real earlier conversation on a separate comm id.
	const arrivedAt = new Date('2026-08-03T17:50:00Z');
	const message = 'Monday works for the furnace appointment.';

	// The container the pipeline just opened for this very message: opened after it arrived, and
	// its only entry is the message itself.
	const selfContainer = () =>
		candidate({
			id: 'cnt_own',
			commRef: '#5248',
			subject: null,
			openedAt: new Date('2026-08-03T17:50:20Z'),
			lastActivityAt: new Date('2026-08-03T17:50:20Z'),
			entries: [{ transcript: message }]
		});

	it('ignores the container holding only this message echoed back', async () => {
		mockPrisma.pipelineCustomerProfile.findMany.mockResolvedValue([]);
		mockPrisma.commContainer.findMany.mockResolvedValue([selfContainer()]);
		const ai = vi.fn();
		const result = await resolveContextContainer(
			{
				companyId: 'comp_1',
				contactId: 'contact_1',
				channel: 'sms',
				direction: 'inbound',
				content: message,
				occurredAt: arrivedAt
			},
			{ ai }
		);
		expect(result.matched).toBe(false);
		expect(result.reason).toBe('no_open_candidates');
		expect(ai).not.toHaveBeenCalled();
	});

	// Regression: the window was one-sided ("opened after the message"). On SMS the ProfileDB
	// pipeline opens the container on `sms_received`, ~20s BEFORE logCommunication writes the row,
	// so the self-container sat on the wrong side of the cutoff and was matched as a real
	// conversation. The echo test is what identifies a self-container; the window is only there to
	// spare a customer who repeats themselves verbatim weeks later.
	it('ignores its own container even when opened BEFORE the log row (SMS ordering)', async () => {
		mockPrisma.pipelineCustomerProfile.findMany.mockResolvedValue([]);
		mockPrisma.commContainer.findMany.mockResolvedValue([
			candidate({
				id: 'cnt_own_early',
				commRef: '#7825',
				subject: null,
				openedAt: new Date('2026-08-03T17:49:39Z'),
				lastActivityAt: new Date('2026-08-03T17:49:39Z'),
				entries: [{ transcript: message }]
			})
		]);
		const ai = vi.fn();
		const result = await resolveContextContainer(
			{
				companyId: 'comp_1',
				contactId: 'contact_1',
				channel: 'sms',
				direction: 'inbound',
				content: message,
				occurredAt: arrivedAt
			},
			{ ai }
		);
		expect(result.matched).toBe(false);
		expect(ai).not.toHaveBeenCalled();
	});

	it('still offers the earlier email container alongside it', async () => {
		mockPrisma.pipelineCustomerProfile.findMany.mockResolvedValue([]);
		mockPrisma.commContainer.findMany.mockResolvedValue([
			selfContainer(),
			candidate({ id: 'cnt_email', commRef: '#5247' })
		]);
		const ai = vi.fn().mockResolvedValue({
			linked: true,
			commRef: '#5247',
			confidence: 0.9,
			reason: 'continues the emailed furnace proposal'
		});
		const result = await resolveContextContainer(
			{
				companyId: 'comp_1',
				contactId: 'contact_1',
				channel: 'sms',
				direction: 'inbound',
				content: message,
				occurredAt: arrivedAt
			},
			{ ai }
		);
		expect(result.matched).toBe(true);
		expect(result.commId).toBe('cnt_email');
		expect(result.candidates.map((c) => c.id)).toEqual(['cnt_email']);
	});

	it('keeps a newer container whose content is NOT this message echoed back', async () => {
		// A voicemail's log row is created when the CALL starts, so a container opened while the
		// caller was still talking is still a legitimate earlier conversation. Filtering on time
		// alone threw these away; only self-echoes may be dropped.
		mockPrisma.pipelineCustomerProfile.findMany.mockResolvedValue([]);
		mockPrisma.commContainer.findMany.mockResolvedValue([
			candidate({
				id: 'cnt_email',
				commRef: '#5284',
				subject: 'Furnace Appointment',
				openedAt: new Date('2026-08-03T17:50:30Z'),
				entries: [{ transcript: 'want to schedule your furnace check-up for Friday?' }]
			})
		]);
		const ai = vi.fn().mockResolvedValue({
			linked: true,
			commRef: '#5284',
			confidence: 0.9,
			reason: 'confirms the emailed proposal'
		});
		const result = await resolveContextContainer(
			{
				companyId: 'comp_1',
				contactId: 'contact_1',
				channel: 'voice',
				direction: 'inbound',
				content: message,
				occurredAt: arrivedAt
			},
			{ ai }
		);
		expect(result.matched).toBe(true);
		expect(result.commId).toBe('cnt_email');
	});
});

describe('resolveContextContainer — cross-customer identity guard', () => {
	it('rejects match when the container belongs to a different contactId', async () => {
		// Bert's container is the only open candidate in the company.
		const bertContainer = candidate({
			id: 'cnt_bert',
			commRef: '#2001',
			subject: 'Sales Opportunity',
			threadType: 'sales',
			snippet: 'Sales Opportunity — interested in furnace maintenance'
		});
		mockPrisma.pipelineCustomerProfile.findMany.mockResolvedValue([]);
		mockPrisma.commContainer.findMany.mockResolvedValue([bertContainer]);
		// The container belongs to Bert (contact_bert), not Sam (contact_sam).
		mockPrisma.commContainer.findUnique.mockResolvedValue({
			contactId: 'contact_bert',
			customerProfileId: 'profile_bert'
		});

		const ai = vi.fn().mockResolvedValue({
			linked: true,
			commRef: '#2001',
			confidence: 0.85,
			reason: 'same topic — sales opportunity'
		});

		const result = await resolveContextContainer(
			{
				companyId: 'comp_1',
				contactId: 'contact_sam',
				channel: 'voice',
				direction: 'inbound',
				content: 'Hi, calling about your services',
				callerContactId: 'contact_sam'
			},
			{ ai }
		);

		expect(result.matched).toBe(false);
		expect(result.reason).toBe('cross_customer_blocked');
	});

	it('rejects match via customerProfileId when container has no contactId', async () => {
		// Pipeline-created container: has customerProfileId but no contactId.
		const pipelineContainer = candidate({
			id: 'cnt_pipeline',
			commRef: '#2002',
			subject: 'Sales Opportunity',
			threadType: 'sales',
			snippet: 'Sales Opportunity — HVAC inquiry from email'
		});
		mockPrisma.pipelineCustomerProfile.findMany.mockResolvedValue([]);
		mockPrisma.commContainer.findMany.mockResolvedValue([pipelineContainer]);
		// No contactId, but customerProfileId belongs to a different person.
		mockPrisma.commContainer.findUnique.mockResolvedValue({
			contactId: null,
			customerProfileId: 'profile_bert'
		});

		const ai = vi.fn().mockResolvedValue({
			linked: true,
			commRef: '#2002',
			confidence: 0.8,
			reason: 'both about sales'
		});

		const result = await resolveContextContainer(
			{
				companyId: 'comp_1',
				contactId: 'contact_sam',
				customerProfileId: 'profile_sam',
				channel: 'voice',
				direction: 'inbound',
				content: 'Calling about your services',
				callerContactId: 'contact_sam',
				callerCustomerProfileId: 'profile_sam'
			},
			{ ai }
		);

		expect(result.matched).toBe(false);
		expect(result.reason).toBe('cross_customer_blocked');
	});

	it('allows match when the container belongs to the same customer', async () => {
		const samContainer = candidate({
			id: 'cnt_sam',
			commRef: '#2003',
			subject: 'Sales Opportunity',
			threadType: 'sales',
			snippet: 'Sales Opportunity — furnace check question'
		});
		mockPrisma.pipelineCustomerProfile.findMany.mockResolvedValue([]);
		mockPrisma.commContainer.findMany.mockResolvedValue([samContainer]);
		mockPrisma.commContainer.findUnique.mockResolvedValue({
			contactId: 'contact_sam',
			customerProfileId: 'profile_sam'
		});

		const ai = vi.fn().mockResolvedValue({
			linked: true,
			commRef: '#2003',
			confidence: 0.9,
			reason: 'continuation of furnace discussion'
		});

		const result = await resolveContextContainer(
			{
				companyId: 'comp_1',
				contactId: 'contact_sam',
				channel: 'voice',
				direction: 'inbound',
				content: 'Following up on the furnace check',
				callerContactId: 'contact_sam',
				callerCustomerProfileId: 'profile_sam'
			},
			{ ai }
		);

		expect(result.matched).toBe(true);
		expect(result.commId).toBe('cnt_sam');
	});
});
