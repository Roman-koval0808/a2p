import { describe, it, expect } from 'vitest';
import { committedWindowDays, effectiveInactiveDays, type CommitmentWindow } from './open-commitments';
import { calculateDecayedScore, evaluateDemotion } from './profiledb/scoring.service';

/** Ray's timeline: emailed 4 Aug, said he'd call in ~2 weeks, due 25 Aug (14 Aug target + 7 grace). */
const AUG_4 = new Date('2026-08-04T13:00:00Z');
const AUG_10 = new Date('2026-08-10T13:00:00Z');
const AUG_25 = new Date('2026-08-25T13:00:00Z');
const SEP_8 = new Date('2026-09-08T13:00:00Z');

const rayCommitment: CommitmentWindow = {
	kind: 'scheduled_intent',
	startedAt: AUG_4,
	resolvesAt: AUG_25
};

describe('committedWindowDays', () => {
	it('counts only the window the customer told us about', () => {
		// 4 Aug → 25 Aug = 21 days; on 10 Aug, the covered period is 6 days.
		expect(committedWindowDays([rayCommitment], AUG_4, AUG_10)).toBe(6);
	});

	it('a window is bounded by last contact — days before it still decay', () => {
		// Last heard 20 Jul (before he told us). Only 4 Aug → 10 Aug counts.
		const last = new Date('2026-07-20T13:00:00Z');
		expect(committedWindowDays([rayCommitment], last, AUG_10)).toBe(6);
	});

	it('a commitment with no date (a quote) contributes nothing', () => {
		const quote: CommitmentWindow = { kind: 'transaction', startedAt: AUG_4, resolvesAt: null };
		expect(committedWindowDays([quote], AUG_4, AUG_10)).toBe(0);
	});

	it('after the window closes, days beyond it are no longer protected', () => {
		// After dueAt passes, the window is over — the clock runs normally again.
		expect(committedWindowDays([rayCommitment], AUG_4, SEP_8)).toBe(21);
		expect(committedWindowDays([rayCommitment], AUG_4, AUG_25)).toBe(21);
	});
});

describe('effectiveInactiveDays', () => {
	it('Ray on 10 Aug: zero effective inactivity — he told us his plan', () => {
		expect(effectiveInactiveDays(AUG_4, [rayCommitment], AUG_10)).toBe(0);
	});

	it('no commitment → plain elapsed days', () => {
		expect(effectiveInactiveDays(AUG_4, [], AUG_10)).toBe(6);
	});

	it('never negative', () => {
		expect(effectiveInactiveDays(AUG_4, [rayCommitment], new Date('2026-08-05T13:00:00Z'))).toBe(0);
	});
});

describe('decay protection (§7) — the score counts interest, and a stated plan is interest', () => {
	it('the committed window is subtracted from the inactivity count', () => {
		// 6 days elapsed, 6 protected → score holds at raw.
		expect(calculateDecayedScore(60, AUG_4, 'active', AUG_10, 6)).toBe(60);
		// Without protection the same 6 days decay the score.
		expect(calculateDecayedScore(60, AUG_4, 'active', AUG_10)).toBeLessThan(60);
	});

	it('demotion is suppressed inside the window and allowed once it closes', () => {
		const last = new Date('2026-08-01T13:00:00Z');
		// 9 days of silence, all of it inside the committed window → no demotion.
		const held = evaluateDemotion(45, last, 'active', AUG_10, 21);
		expect(held.demoted).toBe(false);
		expect(held.scoreLive).toBe(45);
		// Same profile, no commitment → 9 unprotected days decay below the threshold.
		const exposed = evaluateDemotion(45, last, 'active', AUG_10, 0);
		expect(exposed.demoted).toBe(true);
	});

	it('committedDays defaults to 0 — existing callers are unchanged', () => {
		expect(calculateDecayedScore(60, AUG_4, 'active', AUG_10)).toBe(calculateDecayedScore(60, AUG_4, 'active', AUG_10, 0));
	});
});
