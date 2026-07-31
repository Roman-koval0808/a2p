import { describe, it, expect, vi, beforeEach } from 'vitest';

const tx = {
	pipelineCustomerProfile: { findFirst: vi.fn(), update: vi.fn() },
	commIdentifier: { findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
	commContainer: { findMany: vi.fn(), updateMany: vi.fn() },
	pipelineEvent: { findMany: vi.fn(), updateMany: vi.fn() },
	profileMergeCandidate: { update: vi.fn(), updateMany: vi.fn() }
};

vi.mock('$lib/db', () => ({
	prisma: {
		$transaction: vi.fn(async (fn: any) => fn(tx)),
		profileMergeCandidate: {
			findUnique: vi.fn(),
			create: vi.fn(),
			findFirst: vi.fn(),
			update: vi.fn()
		}
	}
}));

import { recordMergeCandidate, mergeProfiles } from './merge-service';
import { prisma } from '$lib/db';

const survivor = {
	id: 'prof_keep',
	companyId: 'comp_1',
	firstName: 'Sam',
	lastName: null,
	displayName: 'Sam',
	email: 'sam@example.com',
	phoneNumber: null,
	externalId: null,
	lineType: null,
	carrier: null,
	smsCapable: null,
	smsConsent: false,
	consentSource: null,
	status: 'client',
	mergedInto: null,
	attributes: { vehicle: 'Civic' },
	metadata: {},
	tags: ['email']
};

const duplicate = {
	...survivor,
	id: 'prof_dupe',
	firstName: null,
	lastName: 'Blopp',
	displayName: 'Caller (+15551112222)',
	email: null,
	phoneNumber: '+15551112222',
	smsConsent: true,
	consentSource: 'sms_reply',
	status: 'unknown',
	attributes: { vehicle: 'Accord', budget: '20k' },
	tags: ['phone']
};

function primeTx(overrides: Partial<Record<string, unknown>> = {}) {
	// mockResolvedValueOnce queues survive clearAllMocks — reset so each test's ordered
	// expectations start from empty rather than inheriting the previous test's leftovers.
	for (const model of Object.values(tx)) {
		for (const fn of Object.values(model)) fn.mockReset();
	}
	tx.pipelineCustomerProfile.findFirst
		.mockResolvedValueOnce(overrides.survivor ?? survivor)
		.mockResolvedValueOnce(overrides.duplicate ?? duplicate);
	tx.commIdentifier.findMany
		.mockResolvedValueOnce(overrides.duplicateIdentifiers ?? []) // duplicate's
		.mockResolvedValueOnce(overrides.survivorIdentifiers ?? []); // survivor's
	tx.commContainer.findMany.mockResolvedValue([]);
	tx.pipelineEvent.findMany.mockResolvedValue([]);
	tx.commContainer.updateMany.mockResolvedValue({ count: 2 });
	tx.pipelineEvent.updateMany.mockResolvedValue({ count: 5 });
	tx.pipelineCustomerProfile.update.mockResolvedValue({ id: 'prof_keep' });
	tx.profileMergeCandidate.updateMany.mockResolvedValue({ count: 0 });
}

describe('recordMergeCandidate', () => {
	beforeEach(() => vi.clearAllMocks());

	it('normalizes the pair so A/B and B/A are the same candidate', async () => {
		vi.mocked(prisma.profileMergeCandidate.findUnique).mockResolvedValue(null as any);
		vi.mocked(prisma.profileMergeCandidate.create).mockResolvedValue({ id: 'cand_1' } as any);

		await recordMergeCandidate({
			companyId: 'comp_1',
			primaryProfileId: 'zzz',
			duplicateProfileId: 'aaa',
			reason: 'email_match'
		});

		expect(prisma.profileMergeCandidate.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ primaryProfileId: 'aaa', duplicateProfileId: 'zzz' })
			})
		);
	});

	it('does not create a second row for a pair already raised', async () => {
		vi.mocked(prisma.profileMergeCandidate.findUnique).mockResolvedValue({
			id: 'cand_existing',
			status: 'dismissed'
		} as any);

		const result = await recordMergeCandidate({
			companyId: 'comp_1',
			primaryProfileId: 'aaa',
			duplicateProfileId: 'zzz',
			reason: 'email_match'
		});

		expect(result).toMatchObject({ id: 'cand_existing' });
		expect(prisma.profileMergeCandidate.create).not.toHaveBeenCalled();
	});

	it('ignores a profile paired with itself', async () => {
		const result = await recordMergeCandidate({
			companyId: 'comp_1',
			primaryProfileId: 'same',
			duplicateProfileId: 'same',
			reason: 'noise'
		});
		expect(result).toBeNull();
		expect(prisma.profileMergeCandidate.create).not.toHaveBeenCalled();
	});
});

describe('mergeProfiles', () => {
	beforeEach(() => vi.clearAllMocks());

	it('refuses to merge a profile into itself', async () => {
		await expect(
			mergeProfiles({ companyId: 'comp_1', survivorId: 'x', duplicateId: 'x' })
		).rejects.toThrow(/into itself/);
	});

	it('refuses to merge an already-merged tombstone', async () => {
		primeTx({ duplicate: { ...duplicate, mergedInto: 'someone_else' } });
		await expect(
			mergeProfiles({ companyId: 'comp_1', survivorId: 'prof_keep', duplicateId: 'prof_dupe' })
		).rejects.toThrow(/already merged/);
	});

	it('keeps survivor values and fills its blanks from the duplicate', async () => {
		primeTx();
		await mergeProfiles({ companyId: 'comp_1', survivorId: 'prof_keep', duplicateId: 'prof_dupe' });

		const survivorUpdate = tx.pipelineCustomerProfile.update.mock.calls.find(
			(c: any) => c[0].where.id === 'prof_keep'
		)![0];

		expect(survivorUpdate.data).toMatchObject({
			firstName: 'Sam', // survivor wins
			lastName: 'Blopp', // duplicate fills the blank
			email: 'sam@example.com',
			phoneNumber: '+15551112222',
			smsConsent: true // either side granting consent stands
		});
		// Survivor wins key collisions, duplicate-only keys survive.
		expect(survivorUpdate.data.attributes).toEqual({ vehicle: 'Civic', budget: '20k' });
		expect(survivorUpdate.data.tags).toEqual(['email', 'phone']);
	});

	it('tombstones the duplicate and frees its unique identifiers', async () => {
		primeTx();
		await mergeProfiles({ companyId: 'comp_1', survivorId: 'prof_keep', duplicateId: 'prof_dupe' });

		const dupeUpdate = tx.pipelineCustomerProfile.update.mock.calls.find(
			(c: any) => c[0].where.id === 'prof_dupe'
		)![0];

		expect(dupeUpdate.data).toEqual({
			email: null,
			phoneNumber: null,
			mergedInto: 'prof_keep',
			status: 'merged'
		});
	});

	it('drops duplicate identifiers the survivor already has, moves the rest', async () => {
		primeTx({
			duplicateIdentifiers: [
				{ id: 'id_dup', kind: 'phone', value: '+15551112222' },
				{ id: 'id_new', kind: 'email', value: 'other@example.com' }
			],
			survivorIdentifiers: [{ kind: 'phone', value: '+15551112222' }]
		});

		const result = await mergeProfiles({
			companyId: 'comp_1',
			survivorId: 'prof_keep',
			duplicateId: 'prof_dupe'
		});

		expect(tx.commIdentifier.delete).toHaveBeenCalledWith({ where: { id: 'id_dup' } });
		expect(tx.commIdentifier.update).toHaveBeenCalledWith({
			where: { id: 'id_new' },
			data: { customerProfileId: 'prof_keep' }
		});
		expect(result.moved).toEqual({ identifiers: 1, containers: 2, events: 5 });
	});

	it('stores a reversal snapshot on the resolved candidate', async () => {
		primeTx();
		await mergeProfiles({
			companyId: 'comp_1',
			survivorId: 'prof_keep',
			duplicateId: 'prof_dupe',
			userId: 'user_1',
			candidateId: 'cand_1'
		});

		const call = tx.profileMergeCandidate.update.mock.calls[0][0];
		expect(call.where).toEqual({ id: 'cand_1' });
		expect(call.data.status).toBe('merged');
		expect(call.data.resolvedByUserId).toBe('user_1');
		expect(call.data.mergeSnapshot.duplicate).toMatchObject({
			id: 'prof_dupe',
			phoneNumber: '+15551112222'
		});
	});

	it('dismisses other pending candidates naming the tombstoned profile', async () => {
		primeTx();
		await mergeProfiles({
			companyId: 'comp_1',
			survivorId: 'prof_keep',
			duplicateId: 'prof_dupe',
			candidateId: 'cand_1'
		});

		expect(tx.profileMergeCandidate.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ status: 'dismissed' })
			})
		);
	});
});
