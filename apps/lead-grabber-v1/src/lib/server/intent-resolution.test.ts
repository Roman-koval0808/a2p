import { describe, it, expect, vi, beforeEach } from 'vitest';

const scheduledIntent = { updateMany: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() };
vi.mock('$lib/db', () => ({
	prisma: {
		get scheduledIntent() {
			return scheduledIntent;
		}
	}
}));

import { skipIntent, resolveOwnCommitments, findOpenCommitments } from './intent-resolution';

const NOW = new Date('2026-08-07T20:00:00Z');
const DUE_LATER = new Date('2026-08-30T20:00:00Z');

beforeEach(() => {
	vi.clearAllMocks();
	scheduledIntent.updateMany.mockResolvedValue({ count: 1 });
	scheduledIntent.findUnique.mockResolvedValue(null);
	scheduledIntent.findMany.mockResolvedValue([]);
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

	it('lets the same customer close their own promise early — a callback IS keeping it', async () => {
		// Sam said "in two weeks", then rang back the same evening. That is the promise kept.
		const res = await skipIntent({
			intentId: 'si_1',
			companyId: 'company_1',
			profileId: 'sam',
			reason: 'customer_got_in_touch',
			requireDue: false,
			now: NOW
		});

		expect(res.skipped).toBe(true);
		const where = scheduledIntent.updateMany.mock.calls.at(-1)?.[0]?.where;
		expect(where).not.toHaveProperty('dueAt');
		expect(where.profileId).toBe('sam');
	});

	it('never lets a promise be closed by the communication that created it', async () => {
		await skipIntent({
			intentId: 'si_1',
			companyId: 'company_1',
			profileId: 'sam',
			reason: 'x',
			requireDue: false,
			excludeIdempotencyKey: 'orch_suspense_comm_1',
			now: NOW
		});

		const where = scheduledIntent.updateMany.mock.calls.at(-1)?.[0]?.where;
		expect(where.idempotencyKey).toEqual({ not: 'orch_suspense_comm_1' });
	});
});

describe('resolveOwnCommitments', () => {
	it('only looks at rows filed under that exact profile', async () => {
		scheduledIntent.findMany.mockResolvedValue([{ id: 'si_1' }]);

		await resolveOwnCommitments({ companyId: 'company_1', profileId: 'sam', now: NOW });

		expect(scheduledIntent.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					clientId: 'company_1',
					profileId: 'sam',
					status: 'PENDING',
					intentType: 'CUSTOMER_COMMITMENT_A'
				})
			})
		);
	});

	it('does nothing when this person has no open promise', async () => {
		scheduledIntent.findMany.mockResolvedValue([]);
		const closed = await resolveOwnCommitments({
			companyId: 'company_1',
			profileId: 'bert',
			now: NOW
		});
		expect(closed).toEqual([]);
		expect(scheduledIntent.updateMany).not.toHaveBeenCalled();
	});

	it('returns what it closed, so the caller can read the new message against the promise', async () => {
		scheduledIntent.findMany.mockResolvedValue([
			{
				id: 'si_1',
				createdAt: new Date('2026-08-01T10:00:00Z'),
				payload: {
					rawTimeframe: 'a couple of weeks',
					whatHeWants: 'price on a new furnace',
					conversationId: 'container_1'
				}
			}
		]);

		const closed = await resolveOwnCommitments({
			companyId: 'company_1',
			profileId: 'joe',
			now: NOW
		});

		expect(closed).toHaveLength(1);
		expect(closed[0]).toMatchObject({
			intentId: 'si_1',
			promise: 'a couple of weeks',
			topic: 'price on a new furnace',
			conversationId: 'container_1'
		});
	});

	it('findOpenCommitments reads without closing anything', async () => {
		scheduledIntent.findMany.mockResolvedValue([
			{
				id: 'si_1',
				createdAt: new Date('2026-08-01T10:00:00Z'),
				payload: { rawTimeframe: 'two weeks', whatHeWants: 'furnace price' }
			}
		]);

		const open = await findOpenCommitments({ companyId: 'company_1', profileId: 'joe' });

		expect(open).toHaveLength(1);
		expect(open[0].topic).toBe('furnace price');
		// The caller decides whether the new message actually resolves it.
		expect(scheduledIntent.updateMany).not.toHaveBeenCalled();
	});

	it('findOpenCommitments never returns the promise this message created', async () => {
		scheduledIntent.findMany.mockResolvedValue([]);

		await findOpenCommitments({
			companyId: 'company_1',
			profileId: 'joe',
			excludeIdempotencyKey: 'orch_suspense_comm_1'
		});

		const where = scheduledIntent.findMany.mock.calls.at(-1)?.[0]?.where;
		expect(where.idempotencyKey).toEqual({ not: 'orch_suspense_comm_1' });
		expect(where.profileId).toBe('joe');
	});
});
