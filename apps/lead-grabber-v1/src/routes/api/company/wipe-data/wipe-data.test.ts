import { describe, it, expect, vi } from 'vitest';
import { POST } from './+server';
import { prisma } from '$lib/db';

vi.mock('$lib/db', () => ({
	prisma: {
		$transaction: vi.fn().mockImplementation((promises) => Promise.all(promises)),
		dropCall: { deleteMany: vi.fn().mockResolvedValue({ count: 5 }) },
		commApproval: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
		commHold: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
		commTask: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
		pipelineTimer: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
		commEntry: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
		commRefAlias: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
		threadReassignmentLog: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
		commContainer: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
		pipelineCustomerProfile: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
		communicationLog: { deleteMany: vi.fn().mockResolvedValue({ count: 10 }) },
		communicationThread: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
		message: { deleteMany: vi.fn().mockResolvedValue({ count: 8 }) },
		contact: { deleteMany: vi.fn().mockResolvedValue({ count: 4 }) },
		notification: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) }
	}
}));

vi.mock('$lib/server/profiledb/telemetry', () => ({
	clearTenantTelemetry: vi.fn().mockResolvedValue({ status: 200 })
}));

describe('Wipe Data API (+server.ts)', () => {
	it('Wipes dropped calls (dropCall) alongside communication logs and A2P containers', async () => {
		const locals = {
			user: {
				id: 'u_test',
				company: { id: 'comp_test' }
			}
		} as any;

		const response = await POST({ locals } as any);
		const json = await response.json();

		expect(response.status).toBe(200);
		expect(json.success).toBe(true);
		expect(prisma.dropCall.deleteMany).toHaveBeenCalledWith({ where: { companyId: 'comp_test' } });
		expect(prisma.commContainer.deleteMany).toHaveBeenCalledWith({ where: { companyId: 'comp_test' } });
		expect(prisma.communicationLog.deleteMany).toHaveBeenCalledWith({ where: { companyId: 'comp_test' } });
	});
});
