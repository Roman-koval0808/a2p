import { describe, it, expect, vi } from 'vitest';
import { lookupNumberCached } from './number-lookup';

vi.mock('$lib/db', () => ({
	prisma: {
		pipelineCustomerProfile: {
			findFirst: vi.fn().mockResolvedValue(null),
			update: vi.fn().mockResolvedValue({})
		}
	}
}));

describe('Number Lookup Unit Tests (Infrastructure Part 1.3)', () => {
	it('I-6: Number lookup times out gracefully and NEVER blocks the pipeline', async () => {
		// Mock slow fetch that hangs
		global.fetch = vi.fn().mockImplementation(
			() => new Promise((resolve) => setTimeout(() => resolve({ ok: false }), 5000))
		);

		const result = await lookupNumberCached('company_1', '+15551234567');
		expect(result).toBeDefined();
		expect(result?.lineType).toBe('unknown');
		expect(result?.carrier).toBe('unknown');
	});
});
