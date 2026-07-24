import { describe, it, expect, vi, beforeEach } from 'vitest';

const startDialLadder = vi.fn().mockResolvedValue(true);
vi.mock('$lib/server/emergency-dial', () => ({ startDialLadder }));
vi.mock('$lib/server/pipeline/profile-service', () => ({
	resolveAndMergeLocalProfile: vi.fn().mockResolvedValue({ id: 'prof_1' })
}));
vi.mock('$lib/db', () => ({ prisma: {} }));

import { startOrAdvanceEmergencyLadder } from './emergency-ladder';

const rota = [
	{ userId: 'u0', name: 'Primary', phone: '+15550000001', rung: 1 },
	{ userId: 'u1', name: 'Backup', phone: '+15550000002', rung: 2 },
	{ userId: 'u2', name: 'Owner', phone: '+15550000009', rung: 3 }
];

/** Minimal in-memory prisma double for the tables the helper touches. */
function makeDb(opts: { container?: any; slaTimer?: any; entries?: any[] } = {}) {
	const state = {
		containers: opts.container ? [opts.container] : [],
		timers: opts.slaTimer ? [opts.slaTimer] : [],
		entries: opts.entries || []
	};
	let idc = 0;
	const db: any = {
		company: { findUnique: vi.fn(async () => ({ id: 'co_1', settings: {} })) },
		commContainer: {
			findMany: vi.fn(async ({ where }: any) =>
				state.containers.filter(
					(c) => c.companyId === where.companyId && c.threadType === 'emergency' && c.state !== 'closed'
				)
			),
			update: vi.fn(async ({ where, data }: any) => {
				const c = state.containers.find((x) => x.id === where.id);
				if (c) Object.assign(c, data);
				return c;
			})
		},
		commEntry: {
			findMany: vi.fn(async () => state.entries)
		},
		pipelineTimer: {
			findFirst: vi.fn(async ({ where }: any) =>
				state.timers.find((t) => t.commId === where.commId && t.type === 'sla_breach' && t.status === 'registered') || null
			),
			updateMany: vi.fn(async () => ({ count: 0 })),
			create: vi.fn(async ({ data }: any) => {
				const t = { id: `tmr_${++idc}`, ...data };
				state.timers.push(t);
				return t;
			}),
			update: vi.fn(async ({ where, data }: any) => {
				const t = state.timers.find((x) => x.id === where.id);
				if (t) Object.assign(t, data);
				return t;
			})
		}
	};
	return { db, state };
}

const openEmergency = {
	id: 'comm_1',
	companyId: 'co_1',
	customerProfileId: 'prof_1',
	threadType: 'emergency',
	state: 'open',
	openedAt: new Date(Date.now() - 5 * 60 * 1000)
};

describe('startOrAdvanceEmergencyLadder', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		startDialLadder.mockResolvedValue(true);
	});

	it('FIRST emergency: dials rung 1 and records ladderState + SLA', async () => {
		const { db, state } = makeDb({ container: { ...openEmergency } });
		const res = await startOrAdvanceEmergencyLadder(
			{ companyId: 'co_1', customerNumber: '+15551110000', transcript: 'burst pipe flooding', dispatchFrom: '+15559990000', rota },
			db
		);
		expect(res.mode).toBe('started');
		expect(res.rungDialed).toBe(1);
		expect(startDialLadder).toHaveBeenCalledTimes(1);
		expect(startDialLadder.mock.calls[0][0].currentRung).toBe(1);
		const t = state.timers.find((x) => x.type === 'sla_breach');
		expect((t.payload as any).ladderState.dispatchedRungs).toEqual([1]);
	});

	it('REPEAT: advances to rung 2 and injects the transcript delta into the whisper', async () => {
		const slaTimer = {
			id: 'tmr_x',
			commId: 'comm_1',
			type: 'sla_breach',
			status: 'registered',
			payload: { ladderState: { currentRung: 1, dispatchedRungs: [1], whisperText: 'Emergency call, Customer, burst pipe. Press 1...' } }
		};
		const entries = [
			{ transcript: 'burst pipe in the basement', fromParty: '+15551110000', occurredAt: new Date(Date.now() - 5 * 60000) },
			{ transcript: 'the flooding is getting worse, I shut the main off', fromParty: '+15551110000', occurredAt: new Date() }
		];
		const { db, state } = makeDb({ container: { ...openEmergency }, slaTimer, entries });

		const res = await startOrAdvanceEmergencyLadder(
			{ companyId: 'co_1', customerNumber: '+15551110000', transcript: 'getting worse', dispatchFrom: '+15559990000', rota },
			db
		);

		expect(res.mode).toBe('advanced');
		expect(res.rungDialed).toBe(2);
		expect(startDialLadder.mock.calls[0][0].currentRung).toBe(2); // Backup tech
		expect(res.whisperText).toContain('SECOND CALL');
		expect(res.whisperText).toContain('worse');
		const t = state.timers[0];
		expect((t.payload as any).ladderState.dispatchedRungs).toEqual([1, 2]);
	});

	it('IDEMPOTENT: a repeat for an already-dialed rung does not re-dial', async () => {
		const slaTimer = {
			id: 'tmr_x',
			commId: 'comm_1',
			type: 'sla_breach',
			status: 'registered',
			// currentRung 3 == last rung; targetRung caps at 3 which is already dispatched
			payload: { ladderState: { currentRung: 3, dispatchedRungs: [1, 2, 3], whisperText: 'w' } }
		};
		const { db } = makeDb({ container: { ...openEmergency }, slaTimer, entries: [] });

		const res = await startOrAdvanceEmergencyLadder(
			{ companyId: 'co_1', customerNumber: '+15551110000', dispatchFrom: '+15559990000', rota },
			db
		);
		expect(res.mode).toBe('skipped_already_dialed');
		expect(startDialLadder).not.toHaveBeenCalled();
	});

	it('LEGACY fallback: no emergency container → dials rung 1 with no container state (no regression)', async () => {
		const { db } = makeDb({}); // no container
		const res = await startOrAdvanceEmergencyLadder(
			{ companyId: 'co_1', customerNumber: '+15551110000', transcript: 'gas leak', dispatchFrom: '+15559990000', rota },
			db
		);
		expect(res.mode).toBe('started_no_container');
		expect(startDialLadder).toHaveBeenCalledTimes(1);
	});

	it('no rota configured → returns no_rota, dials nobody', async () => {
		const { db } = makeDb({ container: { ...openEmergency } });
		const res = await startOrAdvanceEmergencyLadder(
			{ companyId: 'co_1', customerNumber: '+15551110000', dispatchFrom: '+15559990000', rota: [] },
			db
		);
		expect(res.mode).toBe('no_rota');
		expect(startDialLadder).not.toHaveBeenCalled();
	});
});
