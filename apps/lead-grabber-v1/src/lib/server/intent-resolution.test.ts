import { describe, it, expect, vi, beforeEach } from 'vitest';

const scheduledIntent = { updateMany: vi.fn(), findUnique: vi.fn() };
vi.mock('$lib/db', () => ({
	prisma: {
		get scheduledIntent() {
			return scheduledIntent;
		}
	}
}));

import { skipIntent } from './intent-resolution';

const NOW = new Date('2026-08-07T20:00:00Z');
const DUE_LATER = new Date('2026-08-30T20:00:00Z');

beforeEach(() => {
	vi.clearAllMocks();
	scheduledIntent.updateMany.mockResolvedValue({ count: 1 });
	scheduledIntent.findUnique.mockResolvedValue(null);
});

describe('skipIntent — one person, their own promise, on or after their own date', () => {
	it('scopes the write to the owning profile and a date that has arrived', async () => {
		await skipIntent({
			intentId: 'si_1',
			companyId: 'company_1',
			profileId: 'sam',
			reason: 'customer_contacted_since',
			now: NOW
		});

		const where = scheduledIntent.updateMany.mock.calls.at(-1)?.[0]?.where;
		expect(where).toMatchObject({
			id: 'si_1',
			clientId: 'company_1',
			status: 'PENDING',
			profileId: 'sam'
		});
		expect(where.dueAt).toEqual({ lte: NOW });
	});

	it("refuses another customer's promise, and says whose it was", async () => {
		// Bert emails about the same product. Sam's row must not move.
		scheduledIntent.updateMany.mockResolvedValue({ count: 0 });
		scheduledIntent.findUnique.mockResolvedValue({
			profileId: 'sam',
			status: 'PENDING',
			dueAt: DUE_LATER,
			clientId: 'company_1'
		});

		const res = await skipIntent({
			intentId: 'si_1',
			companyId: 'company_1',
			profileId: 'bert',
			reason: 'customer_contacted_since',
			now: NOW
		});

		expect(res.skipped).toBe(false);
		expect(res.reason).toContain('wrong_profile');
		expect(res.reason).toContain('sam');
	});

	it('refuses a promise whose date has not arrived', async () => {
		scheduledIntent.updateMany.mockResolvedValue({ count: 0 });
		scheduledIntent.findUnique.mockResolvedValue({
			profileId: 'sam',
			status: 'PENDING',
			dueAt: DUE_LATER,
			clientId: 'company_1'
		});

		const res = await skipIntent({
			intentId: 'si_1',
			companyId: 'company_1',
			profileId: 'sam',
			reason: 'customer_contacted_since',
			now: NOW
		});

		expect(res.skipped).toBe(false);
		expect(res.reason).toContain('not_due_until');
	});

	it('reports an already-resolved row without complaining', async () => {
		scheduledIntent.updateMany.mockResolvedValue({ count: 0 });
		scheduledIntent.findUnique.mockResolvedValue({
			profileId: 'sam',
			status: 'DONE',
			dueAt: NOW,
			clientId: 'company_1'
		});

		const res = await skipIntent({
			intentId: 'si_1',
			companyId: 'company_1',
			profileId: 'sam',
			reason: 'x',
			now: NOW
		});

		expect(res.skipped).toBe(false);
		expect(res.reason).toBe('status_is_DONE');
	});
});
