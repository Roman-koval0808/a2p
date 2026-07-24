import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canAutoClose, registerTimer } from './timer-service';

describe('Timer Service Unit Tests (Infrastructure Part 1.2)', () => {
	it('I-7 / §1.2: canAutoClose blocks auto-close if SLA, promise, approval, hold or indefinite policy exists', () => {
		const now = new Date('2026-08-04T10:00:00Z');
		const baseContainer = {
			closurePolicy: 'auto',
			slaDeadline: null
		};

		// Clean case -> can close
		expect(
			canAutoClose(baseContainer, {
				hasOpenPromise: false,
				hasPendingApproval: false,
				hasTentativeHold: false,
				now
			})
		).toBe(true);

		// Active SLA deadline -> cannot close!
		expect(
			canAutoClose(
				{ ...baseContainer, slaDeadline: new Date('2026-08-04T11:00:00Z') },
				{ hasOpenPromise: false, hasPendingApproval: false, hasTentativeHold: false, now }
			)
		).toBe(false);

		// Open promise task -> cannot close!
		expect(
			canAutoClose(baseContainer, {
				hasOpenPromise: true,
				hasPendingApproval: false,
				hasTentativeHold: false,
				now
			})
		).toBe(false);

		// Pending approval -> cannot close!
		expect(
			canAutoClose(baseContainer, {
				hasOpenPromise: false,
				hasPendingApproval: true,
				hasTentativeHold: false,
				now
			})
		).toBe(false);

		// Tentative hold -> cannot close!
		expect(
			canAutoClose(baseContainer, {
				hasOpenPromise: false,
				hasPendingApproval: false,
				hasTentativeHold: true,
				now
			})
		).toBe(false);

		// Indefinite policy -> cannot close!
		expect(
			canAutoClose(
				{ ...baseContainer, closurePolicy: 'indefinite' },
				{ hasOpenPromise: false, hasPendingApproval: false, hasTentativeHold: false, now }
			)
		).toBe(false);
	});

	it('I-11: registerTimer throws if commId is missing', async () => {
		const mockTx = {};
		// @ts-ignore
		await expect(registerTimer(mockTx, { commId: '', type: 'sla_breach', fireAt: new Date() })).rejects.toThrow(
			/commId is required/
		);
	});

	it('registerTimer marks superseded when supersedeSameType is true', async () => {
		const mockTx = {
			pipelineTimer: {
				updateMany: vi.fn().mockResolvedValue({ count: 1 }),
				create: vi.fn().mockResolvedValue({ id: 'tmr_1' }),
				update: vi.fn().mockResolvedValue({ id: 'tmr_1', fireEventKey: 'tmr_tmr_1' })
			}
		};

		await registerTimer(mockTx, {
			commId: 'c_100',
			type: 'customer_retry',
			fireAt: new Date(),
			supersedeSameType: true
		});

		expect(mockTx.pipelineTimer.updateMany).toHaveBeenCalledWith({
			where: { commId: 'c_100', type: 'customer_retry', status: 'registered' },
			data: { status: 'superseded', cancelledAt: expect.any(Date), cancelReason: 'superseded_by_new_timer' }
		});
	});
});
