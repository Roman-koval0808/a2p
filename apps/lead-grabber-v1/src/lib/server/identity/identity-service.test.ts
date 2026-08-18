import { describe, it, expect, vi, beforeEach } from 'vitest';

const mergeProfiles = vi.fn();

vi.mock('./merge-service', () => ({
	mergeProfiles: (...args: unknown[]) => mergeProfiles(...args)
}));

const pipelineCustomerProfile = {
	findUnique: vi.fn(),
	findFirst: vi.fn(),
	update: vi.fn()
};
const commIdentifier = { upsert: vi.fn().mockResolvedValue({}) };

vi.mock('$lib/db', () => ({
	prisma: {
		get pipelineCustomerProfile() {
			return pipelineCustomerProfile;
		},
		get commIdentifier() {
			return commIdentifier;
		}
	}
}));

vi.mock('$lib/server/number-lookup', () => ({ getLineType: vi.fn().mockResolvedValue('mobile') }));

import { enrichProfilePostTranscription } from './identity-service';

const CURRENT = { id: 'profile_call', companyId: 'company_1', email: null, displayName: null };
const BY_EMAIL = { id: 'profile_email', companyId: 'company_1', email: 'bert@x.com' };

beforeEach(() => {
	vi.clearAllMocks();
	pipelineCustomerProfile.findUnique.mockResolvedValue(CURRENT);
	pipelineCustomerProfile.update.mockResolvedValue(CURRENT);
	pipelineCustomerProfile.findFirst.mockResolvedValue(null);
});

/**
 * "Exact match on something the customer typed → merge automatically. A guess that two records
 * look similar → don't."
 */
describe('enrichProfilePostTranscription — exact typed email match merges itself', () => {
	it('auto-merges when the customer supplied the address', async () => {
		pipelineCustomerProfile.findFirst.mockResolvedValueOnce(BY_EMAIL);
		mergeProfiles.mockResolvedValue({ survivorId: 'profile_email', mergedId: 'profile_call' });
		pipelineCustomerProfile.findUnique
			.mockResolvedValueOnce(CURRENT)
			.mockResolvedValueOnce(BY_EMAIL);

		const res = await enrichProfilePostTranscription(null, {
			companyId: 'company_1',
			customerProfileId: 'profile_call',
			extractedEmail: 'Bert@X.com',
			emailSource: 'typed'
		});

		// The record already keyed by the exclusive identifier survives.
		expect(mergeProfiles).toHaveBeenCalledWith(
			expect.objectContaining({ survivorId: 'profile_email', duplicateId: 'profile_call' })
		);
		expect(res.merged).toEqual({ survivorId: 'profile_email', mergedId: 'profile_call' });
		expect(res.mergeCandidate).toBeUndefined();
	});

	it('normalises before matching — Bert@X.com and bert@x.com are one person', async () => {
		pipelineCustomerProfile.findFirst.mockResolvedValueOnce(BY_EMAIL);
		mergeProfiles.mockResolvedValue({ survivorId: 'profile_email', mergedId: 'profile_call' });
		pipelineCustomerProfile.findUnique
			.mockResolvedValueOnce(CURRENT)
			.mockResolvedValueOnce(BY_EMAIL);

		await enrichProfilePostTranscription(null, {
			companyId: 'company_1',
			customerProfileId: 'profile_call',
			extractedEmail: '  Bert@X.com  ',
			emailSource: 'typed'
		});

		expect(pipelineCustomerProfile.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({ where: expect.objectContaining({ email: 'bert@x.com' }) })
		);
	});

	it('only flags an address inferred from a transcript — a misheard email must not merge', async () => {
		pipelineCustomerProfile.findFirst.mockResolvedValueOnce(BY_EMAIL);

		const res = await enrichProfilePostTranscription(null, {
			companyId: 'company_1',
			customerProfileId: 'profile_call',
			extractedEmail: 'bert@x.com',
			emailSource: 'inferred'
		});

		expect(mergeProfiles).not.toHaveBeenCalled();
		expect(res.mergeCandidate?.profileId).toBe('profile_email');
	});

	it('defaults to flagging when the caller says nothing about provenance', async () => {
		pipelineCustomerProfile.findFirst.mockResolvedValueOnce(BY_EMAIL);

		const res = await enrichProfilePostTranscription(null, {
			companyId: 'company_1',
			customerProfileId: 'profile_call',
			extractedEmail: 'bert@x.com'
		});

		expect(mergeProfiles).not.toHaveBeenCalled();
		expect(res.mergeCandidate).toBeDefined();
	});

	it('falls back to a candidate rather than losing the enrichment when the merge fails', async () => {
		pipelineCustomerProfile.findFirst.mockResolvedValueOnce(BY_EMAIL);
		mergeProfiles.mockRejectedValue(new Error('boom'));

		const res = await enrichProfilePostTranscription(null, {
			companyId: 'company_1',
			customerProfileId: 'profile_call',
			extractedEmail: 'bert@x.com',
			emailSource: 'typed'
		});

		expect(res.merged).toBeUndefined();
		expect(res.mergeCandidate?.profileId).toBe('profile_email');
	});

	it('a name lookalike is never a merge — two people can share a name', async () => {
		// No email here, so the only lookup is the name one.
		pipelineCustomerProfile.findFirst.mockResolvedValueOnce({ id: 'profile_namesake' });

		const res = await enrichProfilePostTranscription(null, {
			companyId: 'company_1',
			customerProfileId: 'profile_call',
			extractedName: 'Bert Smith',
			emailSource: 'typed'
		});

		expect(mergeProfiles).not.toHaveBeenCalled();
		expect(res.mergeCandidate?.reason).toContain('name_match');
	});
});
