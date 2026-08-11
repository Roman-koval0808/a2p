import { describe, it, expect, vi, beforeEach } from 'vitest';

const communicationLog = { findMany: vi.fn() };
vi.mock('$lib/db', () => ({
	prisma: {
		get communicationLog() {
			return communicationLog;
		}
	}
}));

import {
	haveWeReachedThem,
	decideNextAttempt,
	attemptsSoFar,
	MAX_ATTEMPTS,
	MIN_CONNECT_SECONDS
} from './callback-attempts';

const SINCE = new Date('2026-08-01T10:00:00Z');
const NOW = new Date('2026-08-13T10:00:00Z');

beforeEach(() => {
	vi.clearAllMocks();
	communicationLog.findMany.mockResolvedValue([]);
});

describe('haveWeReachedThem — an answering machine is not the customer', () => {
	it('a short connected call is the voicemail greeting, not him', async () => {
		communicationLog.findMany.mockResolvedValue([
			{ direction: 'outbound', duration: 12, metadata: {}, created: NOW }
		]);
		const r = await haveWeReachedThem({ companyId: 'c', contactId: 'joe', since: SINCE });
		expect(r.reached).toBe(false);
	});

	it('a long enough conversation counts', async () => {
		communicationLog.findMany.mockResolvedValue([
			{ direction: 'outbound', duration: MIN_CONNECT_SECONDS + 5, metadata: {}, created: NOW }
		]);
		const r = await haveWeReachedThem({ companyId: 'c', contactId: 'joe', since: SINCE });
		expect(r.reached).toBe(true);
	});

	it('machine detection overrides duration — a long greeting is still a machine', async () => {
		communicationLog.findMany.mockResolvedValue([
			{ direction: 'outbound', duration: 90, metadata: { answered_by: 'machine' }, created: NOW }
		]);
		const r = await haveWeReachedThem({ companyId: 'c', contactId: 'joe', since: SINCE });
		expect(r.reached).toBe(false);
	});

	it('him ringing us discharges the obligation however it happened', async () => {
		communicationLog.findMany.mockResolvedValue([
			{ direction: 'inbound', duration: 3, metadata: {}, created: NOW }
		]);
		const r = await haveWeReachedThem({ companyId: 'c', contactId: 'joe', since: SINCE });
		expect(r.reached).toBe(true);
		expect(r.reason).toBe('customer_called_us');
	});
});

describe('decideNextAttempt — try again tomorrow, but not forever', () => {
	it('no answer on the first try schedules tomorrow', () => {
		const d = decideNextAttempt({
			reached: { reached: false, reason: 'x' },
			attemptsSoFar: 0,
			now: NOW
		});
		expect(d.action).toBe('try_again');
		expect(d.nextAt?.getDate()).toBe(NOW.getDate() + 1);
	});

	it('stops the moment we reach him', () => {
		const d = decideNextAttempt({
			reached: { reached: true, reason: 'spoke_for_45s' },
			attemptsSoFar: 2,
			now: NOW
		});
		expect(d.action).toBe('stop_reached');
		expect(d.nextAt).toBeNull();
	});

	it('hands over to a human rather than dialling forever', () => {
		const d = decideNextAttempt({
			reached: { reached: false, reason: 'x' },
			attemptsSoFar: MAX_ATTEMPTS - 1,
			now: NOW
		});
		expect(d.action).toBe('stop_exhausted');
		expect(d.nextAt).toBeNull();
	});
});

describe('attemptsSoFar', () => {
	it('starts at zero for a promise never tried', () => {
		expect(attemptsSoFar(null)).toBe(0);
		expect(attemptsSoFar({})).toBe(0);
	});
	it('reads the count the previous attempt wrote', () => {
		expect(attemptsSoFar({ callbackAttempts: 3 })).toBe(3);
	});
});
