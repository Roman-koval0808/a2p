import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fakePrisma } = vi.hoisted(() => ({ fakePrisma: {} as any }));
vi.mock('$lib/server/pipeline/profile-service', () => ({
	resolveAndMergeLocalProfile: vi.fn().mockResolvedValue({ id: 'prof_1' })
}));
vi.mock('$lib/db', () => ({ prisma: fakePrisma }));

import { runSalesVoicemailBooking } from './sales-booking';

function installDb(containers: any[] = []) {
	const state = { containers: [...containers], holds: [] as any[], approvals: [] as any[], timers: [] as any[] };
	let idc = 0;
	Object.assign(fakePrisma, {
		commContainer: {
			findMany: async ({ where }: any) =>
				state.containers.filter(
					(c) => c.companyId === where.companyId && c.customerProfileId === where.customerProfileId && c.state !== 'closed'
				),
			update: async ({ where, data }: any) => {
				const c = state.containers.find((x) => x.id === where.id);
				if (c) Object.assign(c, data);
				return c;
			}
		},
		commHold: {
			create: async ({ data }: any) => {
				const h = { id: `hold_${++idc}`, ...data };
				state.holds.push(h);
				return h;
			}
		},
		commApproval: {
			create: async ({ data }: any) => {
				const a = { id: `appr_${++idc}`, ...data };
				state.approvals.push(a);
				return a;
			}
		},
		commTask: { create: async ({ data }: any) => ({ id: `task_${++idc}`, ...data }) },
		pipelineTimer: {
			updateMany: async () => ({ count: 0 }),
			create: async ({ data }: any) => {
				const t = { id: `tmr_${++idc}`, ...data };
				state.timers.push(t);
				return t;
			},
			update: async ({ where, data }: any) => {
				const t = state.timers.find((x) => x.id === where.id);
				if (t) Object.assign(t, data);
				return t;
			}
		}
	});
	return state;
}

const salesContainer = {
	id: 'comm_s4',
	companyId: 'co_1',
	customerProfileId: 'prof_1',
	contactId: null,
	threadType: 'sales',
	state: 'open'
};

describe('runSalesVoicemailBooking (Scenario 4 wiring)', () => {
	beforeEach(() => vi.clearAllMocks());

	it('slot open → creates tentative hold + SMS approval keyed to the real container', async () => {
		const container = { ...salesContainer };
		const state = installDb([container]);
		const res = await runSalesVoicemailBooking({
			companyId: 'co_1',
			customerPhone: '+15551110000',
			contactId: 'contact_1',
			customerName: 'Bob',
			transcript: 'Interested in a Honda Civic test drive next Wednesday at 4 PM.',
			datetimeIso: '2026-07-29T16:00:00',
			vehicleInterest: 'Honda Civic',
			callStartTime: new Date('2026-07-24T12:00:00Z'),
			availableResources: { salespeople: ['u_sales_owner'], vehicles: ['v_civic'] }
		});

		expect(res.ran).toBe(true);
		expect(res.smsDrafted).toBe(true);
		expect(res.commId).toBe('comm_s4');
		expect(state.holds).toHaveLength(1);
		expect(state.holds[0].commId).toBe('comm_s4');
		expect(state.holds[0].status).toBe('tentative');
		expect(state.approvals).toHaveLength(1);
		expect(state.approvals[0].draftType).toBe('sms');
		expect(state.timers.some((t) => t.type === 'hold_expiry')).toBe(true);
		expect(container.contactId).toBe('contact_1'); // linked for reply matching
	});

	it('no open container for the customer → does not run (no orphan hold)', async () => {
		const state = installDb([]);
		const res = await runSalesVoicemailBooking({
			companyId: 'co_1',
			customerPhone: '+15551110000',
			transcript: 'Test drive please',
			datetimeIso: '2026-07-29T16:00:00',
			callStartTime: new Date('2026-07-24T12:00:00Z'),
			availableResources: { salespeople: ['u_sales_owner'], vehicles: ['v_civic'] }
		});
		expect(res.ran).toBe(false);
		expect(res.reason).toBe('no_container');
		expect(state.holds).toHaveLength(0);
	});
});
