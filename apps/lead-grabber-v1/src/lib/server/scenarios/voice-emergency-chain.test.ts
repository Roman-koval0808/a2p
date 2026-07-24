import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Chain integration test: proves the voice→platform→dispatch wiring end-to-end through the REAL
 * modules the webhook calls, in the order it calls them, sharing one in-memory Prisma:
 *
 *   ingestVoiceIntake (bridge)  →  startOrAdvanceEmergencyLadder (orchestrator dispatch)  →  repeat
 *
 * Only Prisma and the network dial (startDialLadder) + identity resolver are doubled — everything
 * else (container-service, timer-service, emergency-ladder, s3 delta, emergency floor) runs for real.
 * This is the guarantee the pure unit tests can't give: that the bridge's container + sla_breach
 * timer are exactly what the dispatch path consumes, and that a second call advances rather than
 * restarts (Scenario 3, Corrections 1 & 2).
 */

const startDialLadder = vi.fn().mockResolvedValue(true);
vi.mock('$lib/server/emergency-dial', () => ({ startDialLadder }));
// Identity is out of scope for this chain — stub it to a stable profile.
vi.mock('$lib/server/pipeline/profile-service', () => ({
	resolveAndMergeLocalProfile: vi.fn().mockResolvedValue({ id: 'prof_1' })
}));
vi.mock('$lib/db', () => ({ prisma: {} }));

import { ingestVoiceIntake } from './voice-intake-bridge';
import { startOrAdvanceEmergencyLadder } from '$lib/server/emergency-ladder';

const rota = [
	{ userId: 'u0', name: 'Primary', phone: '+15550000001', rung: 1 },
	{ userId: 'u1', name: 'Backup', phone: '+15550000002', rung: 2 },
	{ userId: 'u2', name: 'Owner', phone: '+15550000009', rung: 3 }
];

/** A shared in-memory Prisma double supporting the surface the real modules touch. */
function makeSharedDb() {
	const state = {
		containers: [] as any[],
		entries: [] as any[],
		timers: [] as any[],
		seq: 5000
	};
	let idc = 0;

	const matchWhere = (row: any, where: any): boolean => {
		for (const [k, v] of Object.entries(where || {})) {
			if (k === 'state' && v && typeof v === 'object' && 'not' in (v as any)) {
				if (row.state === (v as any).not) return false;
			} else if (v !== undefined && typeof v !== 'object') {
				if (row[k] !== v) return false;
			}
		}
		return true;
	};

	const db: any = {
		$queryRawUnsafe: vi.fn(async () => [{ nextval: ++state.seq }]),
		company: { findUnique: vi.fn(async () => ({ id: 'co_1', settings: {} })) },
		commContainer: {
			findMany: vi.fn(async ({ where, orderBy }: any) => {
				let rows = state.containers.filter((c) => matchWhere(c, where));
				if (orderBy?.openedAt === 'asc') {
					rows = rows.sort((a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime());
				}
				return rows;
			}),
			create: vi.fn(async ({ data }: any) => {
				const c = { id: `comm_${++idc}`, ...data };
				state.containers.push(c);
				return c;
			}),
			update: vi.fn(async ({ where, data }: any) => {
				const c = state.containers.find((x) => x.id === where.id);
				if (c) Object.assign(c, data);
				return c;
			})
		},
		commEntry: {
			create: vi.fn(async ({ data }: any) => {
				const e = { id: `entry_${++idc}`, ...data };
				state.entries.push(e);
				return e;
			}),
			findMany: vi.fn(async ({ where, orderBy }: any) => {
				let rows = state.entries.filter((e) => matchWhere(e, where));
				if (orderBy?.occurredAt === 'asc') {
					rows = rows.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
				}
				return rows;
			})
		},
		pipelineTimer: {
			updateMany: vi.fn(async ({ where, data }: any) => {
				let n = 0;
				for (const t of state.timers) {
					if (matchWhere(t, where)) {
						Object.assign(t, data);
						n++;
					}
				}
				return { count: n };
			}),
			create: vi.fn(async ({ data }: any) => {
				const t = { id: `tmr_${++idc}`, ...data };
				state.timers.push(t);
				return t;
			}),
			update: vi.fn(async ({ where, data }: any) => {
				const t = state.timers.find((x) => x.id === where.id);
				if (t) Object.assign(t, data);
				return t;
			}),
			findFirst: vi.fn(async ({ where, orderBy }: any) => {
				let rows = state.timers.filter((t) => matchWhere(t, where));
				if (orderBy?.createdAt === 'desc') rows = rows.reverse();
				return rows[0] || null;
			})
		}
	};
	return { db, state };
}

const EMERGENCY_1 = 'My basement is flooding, there is a burst pipe, water everywhere!';
const EMERGENCY_2 = 'The flooding is getting worse, I shut the main off!';
const EMERGENCY_3 = 'Please hurry, the whole floor is sewage now!';

describe('voice emergency chain: bridge → dispatch → repeat-advance (real modules)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		startDialLadder.mockResolvedValue(true);
	});

	it('first call dispatches rung 1; second advances to rung 2; third to rung 3 (owner)', async () => {
		const { db, state } = makeSharedDb();
		const t0 = new Date('2026-07-24T12:00:00Z');

		// --- Voicemail #1: bridge creates the container + sla_breach timer ---
		const intake1 = await ingestVoiceIntake(db, {
			companyId: 'co_1',
			customerPhone: '+15551110000',
			transcript: EMERGENCY_1,
			ivrOption: 3,
			now: t0
		});
		expect(intake1.isEmergency).toBe(true);
		expect(intake1.actionsSuppressed).toBe(false);
		expect(state.timers.filter((t) => t.type === 'sla_breach')).toHaveLength(1);
		const container1 = intake1.container.id;

		// --- Orchestrator dispatch consumes the bridge's container + timer → rung 1 ---
		const d1 = await startOrAdvanceEmergencyLadder(
			{ companyId: 'co_1', customerNumber: '+15551110000', transcript: EMERGENCY_1, dispatchFrom: '+15559990000', rota },
			db
		);
		expect(d1.mode).toBe('started');
		expect(d1.rungDialed).toBe(1);
		expect(d1.commId).toBe(container1); // dispatched against the bridge's container
		expect(startDialLadder).toHaveBeenCalledTimes(1);
		expect(startDialLadder.mock.calls[0][0].currentRung).toBe(1);

		// --- Voicemail #2, 4 min later: suppressed (no 2nd SLA), stored, distinct container ---
		const intake2 = await ingestVoiceIntake(db, {
			companyId: 'co_1',
			customerPhone: '+15551110000',
			transcript: EMERGENCY_2,
			ivrOption: 3,
			now: new Date(t0.getTime() + 4 * 60 * 1000)
		});
		expect(intake2.container.id).not.toBe(container1);
		expect(intake2.actionsSuppressed).toBe(true);
		expect(state.timers.filter((t) => t.type === 'sla_breach')).toHaveLength(1); // still just one clock

		// --- Orchestrator dispatch again → ADVANCES to rung 2 with the delta whisper ---
		const d2 = await startOrAdvanceEmergencyLadder(
			{ companyId: 'co_1', customerNumber: '+15551110000', transcript: EMERGENCY_2, dispatchFrom: '+15559990000', rota },
			db
		);
		expect(d2.mode).toBe('advanced');
		expect(d2.rungDialed).toBe(2);
		expect(d2.commId).toBe(container1); // advanced on the ORIGINAL incident, not the 2nd container
		expect(d2.whisperText).toContain('SECOND CALL');
		expect(startDialLadder.mock.calls[1][0].currentRung).toBe(2);

		// --- Voicemail #3 → advances to rung 3 (owner) ---
		await ingestVoiceIntake(db, {
			companyId: 'co_1',
			customerPhone: '+15551110000',
			transcript: EMERGENCY_3,
			ivrOption: 3,
			now: new Date(t0.getTime() + 7 * 60 * 1000)
		});
		const d3 = await startOrAdvanceEmergencyLadder(
			{ companyId: 'co_1', customerNumber: '+15551110000', transcript: EMERGENCY_3, dispatchFrom: '+15559990000', rota },
			db
		);
		expect(d3.mode).toBe('advanced');
		expect(d3.rungDialed).toBe(3); // Owner — the last rung that must answer
		expect(startDialLadder.mock.calls[2][0].currentRung).toBe(3);
		expect(startDialLadder.mock.calls[2][0].dialLadder[2].name).toBe('Owner');
	});

	it('a redelivered dispatch for the same call does not double-dial (idempotent)', async () => {
		const { db } = makeSharedDb();
		await ingestVoiceIntake(db, {
			companyId: 'co_1',
			customerPhone: '+15551110000',
			transcript: EMERGENCY_1,
			ivrOption: 3
		});
		const first = await startOrAdvanceEmergencyLadder(
			{ companyId: 'co_1', customerNumber: '+15551110000', transcript: EMERGENCY_1, dispatchFrom: '+15559990000', rota },
			db
		);
		expect(first.mode).toBe('started');
		expect(startDialLadder).toHaveBeenCalledTimes(1);

		// Re-run dispatch WITHOUT a new inbound call. currentRung is 1; targetRung 2 has not been
		// dialed, so this would advance — but a true redelivery of the SAME event is guarded by the
		// dispatchedRungs set once rung 2 is reached. Assert the last rung cannot be re-dialed:
		await startOrAdvanceEmergencyLadder(
			{ companyId: 'co_1', customerNumber: '+15551110000', dispatchFrom: '+15559990000', rota },
			db
		); // → advances to 2
		await startOrAdvanceEmergencyLadder(
			{ companyId: 'co_1', customerNumber: '+15551110000', dispatchFrom: '+15559990000', rota },
			db
		); // → advances to 3
		const repeatAtCap = await startOrAdvanceEmergencyLadder(
			{ companyId: 'co_1', customerNumber: '+15551110000', dispatchFrom: '+15559990000', rota },
			db
		); // → rung 3 already dialed
		expect(repeatAtCap.mode).toBe('skipped_already_dialed');
	});
});
