import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	classifyThreadType,
	joinWindowSecondsFor,
	shouldSuppressActions,
	allocateCommRef,
	createEntry,
	createTask,
	createHold,
	createApproval,
	reviewMerge,
	isCustomerFacing
} from './container-service';

describe('Container Service Unit Tests (Infrastructure Part 1)', () => {
	it('I-8: classifyThreadType correctly identifies emergency, sales, support, and general', () => {
		expect(classifyThreadType({ text: 'Water everywhere, pipe burst!' })).toBe('emergency');
		expect(classifyThreadType({ ivrOption: 3, text: 'burst pipe' })).toBe('emergency');
		expect(classifyThreadType({ ivrOption: 2, text: 'Test drive inquiry' })).toBe('sales');
		expect(classifyThreadType({ ivrOption: 3, text: 'General question' })).toBe('support');
		expect(classifyThreadType({ text: 'Hello world' })).toBe('general');
	});

	it('I-8: joinWindowSecondsFor returns spec join windows per thread_type', () => {
		expect(joinWindowSecondsFor('emergency')).toBe(7200); // 2 hours
		expect(joinWindowSecondsFor('support')).toBe(259200); // 3 days
		expect(joinWindowSecondsFor('sales')).toBe(1209600); // 14 days
		expect(joinWindowSecondsFor('general')).toBe(86400); // 24 hours
	});

	it('I-8 / I-12 / 3-8: shouldSuppressActions suppresses ONLY for same threadType within join window', () => {
		const now = new Date('2026-08-04T10:00:00Z');
		const openEmergency = {
			id: 'c_1',
			threadType: 'emergency' as const,
			openedAt: new Date('2026-08-04T09:00:00Z'),
			joinWindowSeconds: 7200,
			state: 'open' as const
		};

		// Test 3-8: Same person + open emergency, incoming is sales -> suppression MUST NOT fire!
		const salesResult = shouldSuppressActions({
			incomingType: 'sales',
			openContainers: [openEmergency],
			now
		});
		expect(salesResult.suppress).toBe(false);

		// Same person + open emergency, incoming is emergency within 2h -> suppression MUST fire!
		const emergencyResult = shouldSuppressActions({
			incomingType: 'emergency',
			openContainers: [openEmergency],
			now
		});
		expect(emergencyResult.suppress).toBe(true);
		expect(emergencyResult.againstCommId).toBe('c_1');
	});

	it('I-11: Orphan guard wrappers throw when commId is missing', async () => {
		const mockTx = {};
		// @ts-ignore
		await expect(createEntry(mockTx, { commId: '' })).rejects.toThrow(/Orphan guard/);
		// @ts-ignore
		await expect(createTask(mockTx, { commId: '' })).rejects.toThrow(/Orphan guard/);
		// @ts-ignore
		await expect(createHold(mockTx, { commId: '' })).rejects.toThrow(/Orphan guard/);
		// @ts-ignore
		await expect(createApproval(mockTx, { commId: '' })).rejects.toThrow(/Orphan guard/);
	});

	it('I-1.1.5: isCustomerFacing correctly derives customer_facing boolean', () => {
		expect(isCustomerFacing({ fromPartyType: 'customer', toPartyType: 'system' })).toBe(true);
		expect(isCustomerFacing({ fromPartyType: 'rep', toPartyType: 'customer' })).toBe(true);
		expect(isCustomerFacing({ fromPartyType: 'rep', toPartyType: 'system' })).toBe(false);
	});

	it('I-10: reviewMerge swaps survivor so older commRef survives', async () => {
		const mockDb = {
			commContainer: {
				findUnique: vi.fn().mockImplementation((opts) => {
					if (opts.where.id === 'c_newer') {
						return Promise.resolve({ id: 'c_newer', commRef: '#4413', companyId: 'comp_1' });
					}
					if (opts.where.id === 'c_older') {
						return Promise.resolve({ id: 'c_older', commRef: '#4412', companyId: 'comp_1' });
					}
					return Promise.resolve(null);
				}),
				update: vi.fn().mockResolvedValue({})
			},
			commEntry: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
			commTask: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
			commHold: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
			commApproval: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
			pipelineTimer: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
			threadReassignmentLog: { create: vi.fn() },
			commRefAlias: { create: vi.fn() }
		};

		// Call reviewMerge where loser input has older ref #4412, survivor input has newer #4413
		const result = await reviewMerge(mockDb, {
			loserCommId: 'c_older',
			survivorCommId: 'c_newer',
			actor: 'test'
		});

		// Older ref #4412 must become the survivorId!
		expect(result.survivorId).toBe('c_older');
		expect(result.loserId).toBe('c_newer');
	});
});
