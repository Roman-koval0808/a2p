import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared fake that IS the global prisma — the scenario modules use the global import directly.
const { fakePrisma } = vi.hoisted(() => ({ fakePrisma: {} as any }));
const listEvents = vi.fn();
vi.mock('$lib/server/google-calendar', () => ({ listEvents }));
vi.mock('$lib/server/pipeline/profile-service', () => ({
	resolveAndMergeLocalProfile: vi.fn().mockResolvedValue({ id: 'prof_1' })
}));
vi.mock('$lib/db', () => ({ prisma: fakePrisma }));

import { runSupportMeetingConfirmation } from './support-meeting';

function installDb(containers: any[] = []) {
	const state = { containers: [...containers], approvals: [] as any[], timers: [] as any[] };
	let idc = 0;
	Object.assign(fakePrisma, {
		commContainer: {
			findMany: async ({ where }: any) =>
				state.containers.filter(
					(c) => c.companyId === where.companyId && c.customerProfileId === where.customerProfileId && c.state !== 'closed'
				)
		},
		commApproval: {
			create: async ({ data }: any) => {
				const a = { id: `appr_${++idc}`, ...data };
				state.approvals.push(a);
				return a;
			}
		},
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

const supportContainer = {
	id: 'comm_s1',
	companyId: 'co_1',
	customerProfileId: 'prof_1',
	threadType: 'support',
	state: 'open'
};

describe('runSupportMeetingConfirmation (Scenario 1 wiring)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listEvents.mockResolvedValue([]);
	});

	it('no scheduling keyword or no datetime → does not invent a meeting (test 1-7)', async () => {
		installDb([supportContainer]);
		const res = await runSupportMeetingConfirmation({
			companyId: 'co_1',
			customerPhone: '+15551110000',
			transcript: 'Just had a question about my last invoice.',
			datetimeIso: null,
			callStartTime: new Date('2026-07-24T12:00:00Z')
		});
		expect(res.ran).toBe(false);
		expect(res.reason).toBe('no_meeting_signal');
	});

	it('calendar has a matching entry → drafts the confirmation email (test 1-4a)', async () => {
		listEvents.mockResolvedValue([
			{ id: 'ev1', title: 'Meeting', startTime: new Date('2026-07-25T14:00:00Z'), attendees: ['alice@example.com'] }
		]);
		const state = installDb([supportContainer]);
		const res = await runSupportMeetingConfirmation({
			companyId: 'co_1',
			customerPhone: '+15551110000',
			customerName: 'Alice',
			repEnteredEmail: 'alice@example.com',
			transcript: 'Can we schedule a meeting? My email is alice@example.com',
			datetimeIso: '2026-07-25T14:00:00Z',
			callStartTime: new Date('2026-07-24T12:00:00Z')
		});
		expect(res.ran).toBe(true);
		expect(res.draftCreated).toBe(true);
		expect(state.approvals).toHaveLength(1);
		expect(state.approvals[0].draftType).toBe('email');
	});

	it('calendar empty at T+0 → starts grace timer AND stages a tentative draft', async () => {
		listEvents.mockResolvedValue([]);
		const state = installDb([supportContainer]);
		const res = await runSupportMeetingConfirmation({
			companyId: 'co_1',
			customerPhone: '+15551110000',
			customerName: 'Alice',
			repEnteredEmail: 'alice@example.com',
			transcript: 'Can we schedule a meeting tomorrow? alice@example.com',
			datetimeIso: '2026-07-25T14:00:00',
			callStartTime: new Date('2026-07-24T12:00:00Z')
		});
		expect(res.ran).toBe(true);
		expect(res.draftCreated).toBe(true);
		expect(state.timers.some((t) => t.type === 'calendar_grace')).toBe(true);
		expect(state.approvals.some((a) => (a.contextPayload?.flags || []).includes('calendar_entry_tentative'))).toBe(true);
	});
});
