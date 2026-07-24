import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the identity resolver so intake never depends on the DB profile logic.
vi.mock('$lib/server/pipeline/profile-service', () => ({
	resolveAndMergeLocalProfile: vi.fn().mockResolvedValue({ id: 'prof_1' })
}));

vi.mock('$lib/db', () => ({ prisma: {} }));

import { ingestVoiceIntake } from './voice-intake-bridge';

/**
 * A tiny in-memory fake of the Prisma surface the bridge touches. It lets us assert the intake
 * seam (container/ref/entry/suppression/timer) without a real database — the same "mock prisma"
 * convention as orchestrator.test.ts.
 */
function makeDb(openContainers: any[] = []) {
	const state = {
		containers: [...openContainers] as any[],
		entries: [] as any[],
		timers: [] as any[],
		refSeq: 5000
	};
	let idc = 0;
	const db: any = {
		$queryRawUnsafe: vi.fn(async () => [{ nextval: ++state.refSeq }]),
		commContainer: {
			findMany: vi.fn(async ({ where }: any) =>
				state.containers.filter(
					(c) =>
						c.companyId === where.companyId &&
						c.customerProfileId === where.customerProfileId &&
						c.state !== 'closed'
				)
			),
			create: vi.fn(async ({ data }: any) => {
				const c = { id: `comm_${++idc}`, ...data };
				state.containers.push(c);
				return c;
			}),
			update: vi.fn(async ({ where, data }: any) => {
				const c = state.containers.find((x) => x.id === where.id);
				Object.assign(c, data);
				return c;
			})
		},
		commEntry: {
			create: vi.fn(async ({ data }: any) => {
				const e = { id: `entry_${++idc}`, ...data };
				state.entries.push(e);
				return e;
			})
		},
		pipelineTimer: {
			updateMany: vi.fn(async () => ({ count: 0 })),
			create: vi.fn(async ({ data }: any) => {
				const t = { id: `tmr_${++idc}`, ...data };
				state.timers.push(t);
				return t;
			}),
			update: vi.fn(async ({ where, data }: any) => {
				const t = state.timers.find((x) => x.id === where.id);
				Object.assign(t, data);
				return t;
			})
		}
	};
	return { db, state };
}

describe('ingestVoiceIntake — voice→container platform seam', () => {
	beforeEach(() => vi.clearAllMocks());

	it('I-8/I-9: creates a provisional container + ref + inbound entry at intake', async () => {
		const { db, state } = makeDb();
		const res = await ingestVoiceIntake(db, {
			companyId: 'co_1',
			customerPhone: '+15551112222',
			transcript: 'Just calling to ask about a quote for a bathroom renovation.',
			ivrOption: 2
		});

		expect(res.container).toBeTruthy();
		expect(res.container.commRef).toMatch(/^#\d+$/); // human ref allocated
		expect(res.container.lifecycle).toBe('provisional'); // I-9 — not in open-threads view yet
		expect(state.entries).toHaveLength(1); // I-8 — entry carries the comm_id
		expect(state.entries[0].commId).toBe(res.container.id);
		expect(res.threadType).toBe('sales'); // IVR option 2
		expect(res.isEmergency).toBe(false);
		expect(state.timers).toHaveLength(0); // no SLA clock for sales
	});

	it('emergency intake registers exactly one sla_breach timer + sets the SLA deadline', async () => {
		const { db, state } = makeDb();
		const res = await ingestVoiceIntake(db, {
			companyId: 'co_1',
			customerPhone: '+15551112222',
			transcript: 'My basement is flooding, there is a burst pipe, water everywhere!',
			ivrOption: 3
		});

		expect(res.threadType).toBe('emergency');
		expect(res.isEmergency).toBe(true);
		expect(res.actionsSuppressed).toBe(false);
		expect(res.slaDeadline).toBeInstanceOf(Date);
		expect(state.timers.filter((t) => t.type === 'sla_breach')).toHaveLength(1);
	});

	it('3-1b: a SECOND emergency during an open emergency is suppressed — stored, no 2nd SLA clock', async () => {
		const openEmergency = {
			id: 'comm_open',
			companyId: 'co_1',
			customerProfileId: 'prof_1',
			threadType: 'emergency',
			state: 'open',
			joinWindowSeconds: 2 * 3600,
			openedAt: new Date(Date.now() - 4 * 60 * 1000) // 4 minutes ago, inside the 2h window
		};
		const { db, state } = makeDb([openEmergency]);

		const res = await ingestVoiceIntake(db, {
			companyId: 'co_1',
			customerPhone: '+15551112222',
			transcript: 'The flooding is getting worse, I shut the main off!',
			ivrOption: 3
		});

		// New container + ref STILL created (the 2nd voicemail is a distinct communication)...
		expect(res.container.id).not.toBe('comm_open');
		// ...but actions are suppressed and the entry is stored (dedup suppresses actions, not storage).
		expect(res.actionsSuppressed).toBe(true);
		expect(res.suppressedAgainstCommId).toBe('comm_open');
		expect(state.entries).toHaveLength(1);
		expect(state.entries[0].dedupSuppressed).toBe(true);
		// No SECOND SLA clock.
		expect(state.timers.filter((t) => t.type === 'sla_breach')).toHaveLength(0);
		expect(res.slaDeadline).toBeNull();
	});

	it('3-8: a non-emergency call during an open emergency does NOT suppress (different thread_type)', async () => {
		const openEmergency = {
			id: 'comm_open',
			companyId: 'co_1',
			customerProfileId: 'prof_1',
			threadType: 'emergency',
			state: 'open',
			joinWindowSeconds: 2 * 3600,
			openedAt: new Date(Date.now() - 4 * 60 * 1000)
		};
		const { db } = makeDb([openEmergency]);

		const res = await ingestVoiceIntake(db, {
			companyId: 'co_1',
			customerPhone: '+15551112222',
			transcript: 'Hi, I just wanted to ask about my invoice and pricing for the sales quote.',
			ivrOption: 2
		});

		expect(res.threadType).toBe('sales');
		expect(res.actionsSuppressed).toBe(false); // different type → stands alone, must NOT fold in
		expect(res.suppressedAgainstCommId).toBeUndefined();
	});
});
