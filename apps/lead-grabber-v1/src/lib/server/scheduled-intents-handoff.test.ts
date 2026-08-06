import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handoffDueIntent } from './scheduled-intents-handoff';
import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';

vi.mock('$lib/db', () => ({
	prisma: {
		contact: { findUnique: vi.fn() },
		company: { findUnique: vi.fn() },
		scheduledIntent: { updateMany: vi.fn() },
		communicationLog: { delete: vi.fn() }
	}
}));

vi.mock('$lib/utils/communication-log', () => ({
	logCommunication: vi.fn()
}));

vi.mock('$env/static/private', () => ({
	ANTHROPIC_AI_KEY: 'test-key'
}));

vi.mock('./anthropic', () => ({
	claudeText: vi.fn()
}));

const intent = {
	id: 'intent_1',
	clientId: 'company_1',
	profileId: 'contact_1',
	actor: 'CUSTOMER' as const,
	payload: {
		whatHeWants: 'air conditioning',
		rawTimeframe: 'a couple of weeks',
		preferredChannel: 'call',
		originalChannel: 'email',
		originalTarget: 'ray@example.com'
	}
};

const AI_DRAFT =
	"Hey Ray, just wanted to check in on the air conditioning project. You mentioned you'd give us a call in a couple of weeks — hope everything's going well! We're here whenever you're ready.";

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(prisma.contact.findUnique).mockResolvedValue({
		id: 'contact_1',
		name: 'Ray Charbonneau',
		cell: '+14165551234',
		phone: null,
		email: 'ray@example.com',
		landline: null
	} as any);
	vi.mocked(prisma.company.findUnique).mockResolvedValue({ name: 'Total Trades' } as any);
	vi.mocked(prisma.scheduledIntent.updateMany).mockResolvedValue({ count: 1 });
	vi.mocked(prisma.communicationLog.delete).mockResolvedValue({ id: 'queue_1' } as any);
});

describe('handoffDueIntent — queue-first/CAS-second with AI-generated draft', () => {
	it('queue write failure leaves the intent PENDING', async () => {
		vi.mocked(logCommunication).mockResolvedValue(null);

		const out = await handoffDueIntent(intent, new Date('2026-08-25T13:00:00Z'));

		expect(out.handedOff).toBe(false);
		expect(out.reason).toBe('queue_write_failed');
		expect(prisma.scheduledIntent.updateMany).not.toHaveBeenCalled();
	});

	it('CAS loss deletes the duplicate draft', async () => {
		vi.mocked(logCommunication).mockResolvedValue({ id: 'queue_1' } as any);
		vi.mocked(prisma.scheduledIntent.updateMany).mockResolvedValue({ count: 0 });

		const out = await handoffDueIntent(intent, new Date('2026-08-25T13:00:00Z'));

		expect(out.handedOff).toBe(false);
		expect(out.reason).toBe('already_handled');
		expect(prisma.communicationLog.delete).toHaveBeenCalledWith({ where: { id: 'queue_1' } });
	});

	it('AI-generated draft queued, claimed, queueId returned', async () => {
		vi.mocked(logCommunication).mockResolvedValue({ id: 'queue_1' } as any);
		const { claudeText } = await import('./anthropic');
		vi.mocked(claudeText).mockResolvedValue(AI_DRAFT);

		const out = await handoffDueIntent(intent, new Date('2026-08-25T13:00:00Z'));

		expect(out.handedOff).toBe(true);
		expect(out.queueId).toBe('queue_1');
		expect(out.draft).toBe(AI_DRAFT);
		expect(prisma.scheduledIntent.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: 'intent_1', status: 'PENDING' } })
		);
		const logged = vi.mocked(logCommunication).mock.calls[0][0];
		expect(logged.metadata).toMatchObject({
			action: 'SCHED-INTENT-FOLLOWUP',
			intentId: 'intent_1',
			channel: 'voice',
			subject: 'About air conditioning'
		});
		expect(logged.status).toBe('pending_approval');
		expect(logged.type).toBe('voice');
	});

	it('falls back to a structured cue when Claude fails', async () => {
		vi.mocked(logCommunication).mockResolvedValue({ id: 'queue_1' } as any);
		const { claudeText } = await import('./anthropic');
		vi.mocked(claudeText).mockResolvedValue(null);

		const out = await handoffDueIntent(intent, new Date('2026-08-25T13:00:00Z'));

		expect(out.handedOff).toBe(true);
		expect(out.draft).toContain('[Write a follow-up to Ray Charbonneau');
		expect(out.draft).toContain('air conditioning');
	});

	it('email fallback when "call" has no phone number (§11)', async () => {
		vi.mocked(logCommunication).mockResolvedValue({ id: 'queue_2' } as any);
		const { claudeText } = await import('./anthropic');
		vi.mocked(claudeText).mockResolvedValue(AI_DRAFT);
		vi.mocked(prisma.contact.findUnique).mockResolvedValue({
			id: 'contact_1',
			name: 'Ray Charbonneau',
			cell: null,
			phone: null,
			email: 'ray@example.com',
			landline: null
		} as any);

		const out = await handoffDueIntent(intent, new Date('2026-08-25T13:00:00Z'));

		expect(out.handedOff).toBe(true);
		expect(out.channel?.outcome).toBe('email');
		expect(out.channel?.target).toBe('ray@example.com');
		const logged = vi.mocked(logCommunication).mock.calls[0][0];
		expect(logged.metadata.channel).toBe('email');
		expect(logged.type).toBe('email');
		expect(logged.destination).toBe('ray@example.com');
		expect(logged.summary).not.toContain('UNREACHABLE');
	});
});
