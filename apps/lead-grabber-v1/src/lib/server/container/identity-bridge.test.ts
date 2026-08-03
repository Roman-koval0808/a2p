import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	bridgeIdentitiesForMatchedContainer,
	IDENTITY_MERGE_MIN_CONFIDENCE
} from './identity-bridge';

const { mockPrisma, mockProfileDb, mockResolve } = vi.hoisted(() => ({
	mockPrisma: { commContainer: { findUnique: vi.fn() } },
	mockProfileDb: {
		customerProfile: { findFirst: vi.fn() },
		deviceFingerprint: { findFirst: vi.fn() }
	},
	mockResolve: vi.fn()
}));

vi.mock('$lib/db', () => ({ prisma: mockPrisma }));
vi.mock('$lib/profiledb-db', () => ({ profileDb: mockProfileDb }));
vi.mock('$lib/server/profiledb/identity.service', () => ({
	resolveCustomerProfile: mockResolve,
	sha256: (s: string) => `h(${s})`,
	normalizeEmail: (s: string) => s.trim().toLowerCase(),
	normalizePhone: (s: string) => s.trim()
}));

const container = {
	id: 'cnt_1',
	contact: { email: 'studioblopp@gmail.com', phone: null },
	customerProfile: null
};

beforeEach(() => {
	vi.clearAllMocks();
	mockPrisma.commContainer.findUnique.mockResolvedValue(container);
	mockProfileDb.customerProfile.findFirst.mockImplementation(({ where }: any) =>
		Promise.resolve(
			where.email
				? { id: 'p_email', tenantId: 't1' }
				: { id: 'p_phone', tenantId: 't1' }
		)
	);
	mockProfileDb.deviceFingerprint.findFirst.mockResolvedValue({ fingerprintId: 'fp_1' });
	mockResolve.mockResolvedValue({ id: 'p_email' });
});

const call = (over: Partial<Parameters<typeof bridgeIdentitiesForMatchedContainer>[0]> = {}) =>
	bridgeIdentitiesForMatchedContainer({
		companyId: 'comp_1',
		containerId: 'cnt_1',
		confidence: 0.95,
		phone: '+19097055234',
		email: null,
		...over
	});

describe('bridgeIdentitiesForMatchedContainer', () => {
	it('merges when the match is confident and the two sides supply email + phone', async () => {
		const res = await call();
		expect(res.merged).toBe(true);
		// Goes through the tested merge path rather than deleting anything itself.
		expect(mockResolve).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: 't1',
				fingerprintId: 'fp_1',
				email: 'studioblopp@gmail.com',
				phone: '+19097055234'
			})
		);
	});

	it('refuses to merge below the confidence bar', async () => {
		// Merging deletes a profile; linking containers only needs 0.6, this needs much more.
		const res = await call({ confidence: IDENTITY_MERGE_MIN_CONFIDENCE - 0.01 });
		expect(res.merged).toBe(false);
		expect(mockResolve).not.toHaveBeenCalled();
	});

	it('refuses when confidence is absent entirely', async () => {
		const res = await call({ confidence: undefined });
		expect(res.merged).toBe(false);
		expect(mockResolve).not.toHaveBeenCalled();
	});

	it('does nothing when only one identifier is known', async () => {
		mockPrisma.commContainer.findUnique.mockResolvedValue({
			id: 'cnt_1',
			contact: { email: null, phone: null },
			customerProfile: null
		});
		const res = await call();
		expect(res.merged).toBe(false);
		expect(res.reason).toBe('need_both_email_and_phone');
		expect(mockResolve).not.toHaveBeenCalled();
	});

	it('does nothing when both identifiers are already one profile', async () => {
		mockProfileDb.customerProfile.findFirst.mockResolvedValue({ id: 'p_same', tenantId: 't1' });
		const res = await call();
		expect(res.merged).toBe(false);
		expect(res.reason).toBe('already_one_profile');
		expect(mockResolve).not.toHaveBeenCalled();
	});
});
