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

/** Ray's row: customer-acting, due 25 Aug, payload carries his exact words. */
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

describe('handoffDueIntent ordering — queue write comes before the CAS claim', () => {
	it('queue write failure leaves the intent PENDING and returns queue_write_failed', async () => {
		vi.mocked(logCommunication).mockResolvedValue(null);

		const out = await handoffDueIntent(intent, new Date('2026-08-25T13:00:00Z'));

		expect(out.handedOff).toBe(false);
		expect(out.reason).toBe('queue_write_failed');
		// No claim was attempted — the row stays PENDING so the next sweep retries.
		expect(prisma.scheduledIntent.updateMany).not.toHaveBeenCalled();
	});

	it('losing the CAS deletes the just-written draft — no duplicate survives', async () => {
		vi.mocked(logCommunication).mockResolvedValue({ id: 'queue_1' } as any);
		vi.mocked(prisma.scheduledIntent.updateMany).mockResolvedValue({ count: 0 });

		const out = await handoffDueIntent(intent, new Date('2026-08-25T13:00:00Z'));

		expect(out.handedOff).toBe(false);
		expect(out.reason).toBe('already_handled');
		expect(prisma.communicationLog.delete).toHaveBeenCalledWith({ where: { id: 'queue_1' } });
	});

	it('happy path: draft queued, then claimed, queueId returned', async () => {
		vi.mocked(logCommunication).mockResolvedValue({ id: 'queue_1' } as any);

		const out = await handoffDueIntent(intent, new Date('2026-08-25T13:00:00Z'));

		expect(out.handedOff).toBe(true);
		expect(out.queueId).toBe('queue_1');
		expect(out.draft).toContain('in a couple of weeks');
		expect(out.draft).toContain('give us a call about air conditioning');
		expect(out.draft).not.toContain('away');
		expect(prisma.scheduledIntent.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: 'intent_1', status: 'PENDING' } })
		);
		const logged = vi.mocked(logCommunication).mock.calls[0][0];
		expect(logged.metadata).toMatchObject({
			action: 'SCHED-INTENT-FOLLOWUP',
			intentId: 'intent_1',
			// He asked to be CALLED → voice outcome on his mobile.
			channel: 'voice',
			// Never "No subject" when the draft is confirmed.
			subject: 'About air conditioning'
		});
		expect(logged.status).toBe('pending_approval');
		// The CommunicationLog type is not 'email' for a phone-targeted row.
		expect(logged.type).toBe('voice');
	});

	it('"call" with no number at all falls back to his email — never unreachable (§11)', async () => {
		vi.mocked(logCommunication).mockResolvedValue({ id: 'queue_2' } as any);
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
