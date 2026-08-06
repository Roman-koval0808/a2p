import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLineType, lookupNumberCached } from './number-lookup';

const numberLookup = {
	findUnique: vi.fn(),
	upsert: vi.fn().mockResolvedValue({})
};
const pipelineCustomerProfile = {
	findFirst: vi.fn().mockResolvedValue(null),
	update: vi.fn().mockResolvedValue({}),
	updateMany: vi.fn().mockResolvedValue({ count: 0 })
};

vi.mock('$lib/db', () => ({
	prisma: {
		get numberLookup() {
			return numberLookup;
		},
		get pipelineCustomerProfile() {
			return pipelineCustomerProfile;
		}
	}
}));

vi.mock('$env/dynamic/private', () => ({ env: { TELNYX_API_KEY: 'test-key' } }));

function telnyxCarrier(type: string, name = 'Test Carrier') {
	return {
		ok: true,
		json: async () => ({ data: { carrier: { type, name } } })
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	numberLookup.findUnique.mockResolvedValue(null);
	numberLookup.upsert.mockResolvedValue({});
});

describe('Number Lookup — line type (§4.3a)', () => {
	it('I-6: a hanging lookup times out and reports unknown rather than blocking the call', async () => {
		global.fetch = vi.fn().mockImplementation(
			() => new Promise((resolve) => setTimeout(() => resolve({ ok: false }), 5000))
		);

		const started = Date.now();
		const lineType = await getLineType('+15551234567');

		expect(lineType).toBe('unknown');
		// The call is live — the 1.5s cap is the point, not a detail.
		expect(Date.now() - started).toBeLessThan(3000);
	});

	it('never caches a failed lookup, so one Telnyx blip cannot pin a mobile to Tier 2 forever', async () => {
		global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

		expect(await getLineType('+15551234567')).toBe('unknown');
		expect(numberLookup.upsert).not.toHaveBeenCalled();
	});

	it('classifies a mobile and caches it', async () => {
		global.fetch = vi.fn().mockResolvedValue(telnyxCarrier('mobile'));

		expect(await getLineType('+15551234567')).toBe('mobile');
		expect(numberLookup.upsert).toHaveBeenCalledOnce();
	});

	it.each([
		['landline', 'landline'],
		['voip', 'voip']
	])('classifies %s as a shared line', async (carrierType, expected) => {
		global.fetch = vi.fn().mockResolvedValue(telnyxCarrier(carrierType));
		expect(await getLineType('+15551234567')).toBe(expected);
	});

	it('recognises toll-free from the NPA without spending a lookup', async () => {
		global.fetch = vi.fn();
		expect(await getLineType('+18005551234')).toBe('toll_free');
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('serves a cached classification without calling Telnyx again', async () => {
		numberLookup.findUnique.mockResolvedValue({
			phoneNumber: '+15551234567',
			lineType: 'mobile',
			lookedUpAt: new Date()
		});
		global.fetch = vi.fn();

		expect(await getLineType('+15551234567')).toBe('mobile');
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('re-checks a stale classification, because numbers get ported', async () => {
		const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
		numberLookup.findUnique.mockResolvedValue({
			phoneNumber: '+15551234567',
			lineType: 'landline',
			lookedUpAt: longAgo
		});
		global.fetch = vi.fn().mockResolvedValue(telnyxCarrier('mobile'));

		expect(await getLineType('+15551234567')).toBe('mobile');
		expect(global.fetch).toHaveBeenCalledOnce();
	});

	it('canonicalises the number, so one lookup serves every spelling of it', async () => {
		global.fetch = vi.fn().mockResolvedValue(telnyxCarrier('mobile'));

		await getLineType('(555) 123-4567');

		expect(global.fetch).toHaveBeenCalledWith(
			expect.stringContaining(encodeURIComponent('+15551234567')),
			expect.anything()
		);
	});

	it('asks Telnyx for carrier data — without ?type=carrier there is no line type', async () => {
		global.fetch = vi.fn().mockResolvedValue(telnyxCarrier('mobile'));

		await getLineType('+15551234567');

		expect(global.fetch).toHaveBeenCalledWith(
			expect.stringContaining('type=carrier'),
			expect.anything()
		);
	});
});

describe('lookupNumberCached', () => {
	it('stamps the line type onto the company profile once established', async () => {
		global.fetch = vi.fn().mockResolvedValue(telnyxCarrier('mobile', 'Acme Wireless'));
		numberLookup.findUnique
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ phoneNumber: '+15551234567', carrier: 'Acme Wireless' });

		const result = await lookupNumberCached('company_1', '+15551234567');

		expect(result?.lineType).toBe('mobile');
		expect(pipelineCustomerProfile.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ lineType: 'mobile' })
			})
		);
	});

	it('does not write an unknown line type onto the profile', async () => {
		global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

		const result = await lookupNumberCached('company_1', '+15551234567');

		expect(result?.lineType).toBe('unknown');
		expect(pipelineCustomerProfile.updateMany).not.toHaveBeenCalled();
	});
});
