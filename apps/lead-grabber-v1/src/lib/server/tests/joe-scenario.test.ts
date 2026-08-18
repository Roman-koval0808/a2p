// Scenario 2 — Joe and the furnace, end to end.
//
// The story, as it was given to us:
//
//    1 Aug — Joe rings Total Trades. Wants a price on a new furnace. Says he'll be away for two
//            weeks and asks Total Trades to call him when he gets back. Live with a rep.
//          → we thank him by SMS or email, Crispin approves it before it goes, and if we have
//            neither a mobile nor an email we send nothing at all.
//   13 Aug — the daily sweep starts reaching out. No answer.
//   14 Aug — we try again. We reach his answering service, which is not reaching him.
//   15 Aug — we try again and actually speak to him. The daily calling stops.
//
// The DB is mocked at the client level; the real parser, writer, sweep, handoff and
// callback-attempts modules run.
//
// What this file is really pinning down is the thing that made scenario 2 look built and do
// nothing: Joe's sentence carries the request in one clause ("call me when I get back") and the
// date in another ("away for two weeks"), and the extraction schema only has a field for the
// first. See `resolveReturnWindow`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';
import { resolveReturnWindow, daysFromRawTimeframe, resolveCalculatedTargetDate } from '../ai/scheduled-intent-parser';
import { writeScheduledIntent } from '../scheduled-intent-writer';
import { checkDueScheduledIntents, verifyDueIntent } from '../scheduled-intents-sweep';
import { haveWeReachedThem, decideNextAttempt, readTrail, canAutoDial, MIN_CONNECT_SECONDS } from '../callback-attempts';

const { prismaMock } = vi.hoisted(() => ({
	prismaMock: {
		$transaction: vi.fn(),
		contact: { findUnique: vi.fn(), findFirst: vi.fn() },
		company: { findUnique: vi.fn() },
		commContainer: { findFirst: vi.fn() },
		scheduledIntent: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
		communicationLog: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), update: vi.fn() },
		communicationThread: { upsert: vi.fn() },
		appointment: { findFirst: vi.fn() },
		transaction: { findFirst: vi.fn() },
		smsConsent: { findFirst: vi.fn() }
	}
}));

vi.mock('$lib/db', () => ({ prisma: prismaMock }));
vi.mock('$lib/utils/communication-log', () => ({ logCommunication: vi.fn() }));
vi.mock('../anthropic', () => ({
	claudeJSON: vi.fn(),
	claudeText: vi.fn().mockResolvedValue('Hi Joe — following up about the furnace quote.'),
	CLAUDE_FAST: 'claude-fast'
}));
vi.mock('$env/static/private', () => ({ ANTHROPIC_AI_KEY: 'test-key' }));
vi.mock('../number-lookup', () => ({ getLineType: vi.fn().mockResolvedValue('mobile') }));

/** Joe's call: 1 Aug 2026, 09:00 Toronto. */
const JOE_CALL = new Date('2026-08-01T13:00:00Z');
const JOE_WORDS =
	"Hi, I'd like to get a price on a new furnace. I'm going to be away for two weeks — " +
	'give me a call when I get back.';

/**
 * The promise as the writer files it: due 13 Aug (his date, NO grace — he asked us to ring),
 * expiring 20 Aug.
 */
function joeRow(overrides: Record<string, any> = {}) {
	return {
		id: 'intent_joe',
		clientId: 'company_1',
		profileId: 'contact_joe',
		intentType: 'CUSTOMER_COMMITMENT_B',
		actor: 'BUSINESS',
		status: 'PENDING',
		dueAt: new Date('2026-08-13T13:00:00Z'),
		expiresAt: new Date('2026-08-20T13:00:00Z'),
		idempotencyKey: 'orch_callback_comm_joe',
		payload: {
			whatHeWants: 'a price on a new furnace',
			rawTimeframe: 'two weeks',
			calculatedTargetDate: '2026-08-15T13:00:00.000Z',
			confidence: 'HIGH',
			preferredChannel: 'phone',
			conversationId: 'container_joe',
			commLogId: 'comm_joe'
		},
		createdAt: JOE_CALL,
		updatedAt: JOE_CALL,
		...overrides
	};
}

beforeEach(() => {
	vi.clearAllMocks();

	prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
	prismaMock.scheduledIntent.findUnique.mockResolvedValue(null);
	prismaMock.scheduledIntent.updateMany.mockResolvedValue({ count: 1 });
	prismaMock.scheduledIntent.create.mockResolvedValue({ id: 'intent_joe' } as any);
	prismaMock.communicationLog.findMany.mockResolvedValue([]);
	prismaMock.communicationLog.delete.mockResolvedValue({ id: 'queue_1' } as any);
	prismaMock.appointment.findFirst.mockResolvedValue(null);
	prismaMock.transaction.findFirst.mockResolvedValue(null);
	prismaMock.smsConsent.findFirst.mockResolvedValue(null);
	prismaMock.company.findUnique.mockResolvedValue({ name: 'Total Trades' } as any);
	prismaMock.commContainer.findFirst.mockResolvedValue({ id: 'container_joe', commRef: 'COM-4821' } as any);
	prismaMock.communicationLog.findUnique.mockResolvedValue({
		id: 'queue_1',
		companyId: 'company_1',
		customerId: 'contact_joe',
		metadata: {},
		communicationThreadId: null
	} as any);
	prismaMock.communicationThread.upsert.mockResolvedValue({ id: 'container_joe' } as any);
	prismaMock.communicationLog.update.mockResolvedValue({ id: 'queue_1' } as any);

	const joe = {
		id: 'contact_joe',
		name: 'Joe',
		cell: '+14165559876',
		phone: '+14165559876',
		email: null,
		landline: null
	};
	prismaMock.contact.findUnique.mockResolvedValue(joe as any);
	prismaMock.contact.findFirst.mockResolvedValue(joe as any);
	vi.mocked(logCommunication).mockResolvedValue({ id: 'queue_1' } as any);
});

describe('1 Aug — Joe rings: "a price on a furnace, away two weeks, call me when I get back"', () => {
	it('reads the return window out of the away clause', () => {
		const window = resolveReturnWindow(JOE_WORDS);
		expect(window).not.toBeNull();
		// His words, verbatim — the follow-up quotes them (§4).
		expect(window!.phrase).toBe('two weeks');
		expect(window!.days).toBe(14);
	});

	it('"two weeks" is 14 days, not 7', () => {
		// The phrase table matches `week` inside `weeks` and answered 7. Restoring the spelled-out
		// numbers alone left this at one week, which would have rung Joe on 8 Aug while he was
		// still away — a worse failure than not dating it at all.
		expect(daysFromRawTimeframe('two weeks')).toBe(14);
		expect(daysFromRawTimeframe('a couple of weeks')).toBe(14);
		expect(daysFromRawTimeframe('a fortnight')).toBe(14);
		expect(daysFromRawTimeframe('10 days')).toBe(10);
	});

	it('does not invent a return date from a duration mentioned in passing', () => {
		expect(resolveReturnWindow('My furnace has been making a noise for two weeks.')).toBeNull();
		expect(resolveReturnWindow("I'd like a price on a furnace.")).toBeNull();
	});

	it('"when I get back" alone is not a date — the away clause is what makes it one', () => {
		const undatable = resolveCalculatedTargetDate({
			reference: JOE_CALL,
			rawTimeframe: 'when I get back',
			timeframeDays: null,
			exactDateIso: null
		});
		expect(undatable).toBeNull();

		const dated = resolveCalculatedTargetDate({
			reference: JOE_CALL,
			rawTimeframe: resolveReturnWindow(JOE_WORDS)!.phrase,
			timeframeDays: resolveReturnWindow(JOE_WORDS)!.days,
			exactDateIso: null
		});
		expect(dated).toBe('2026-08-15T13:00:00.000Z');
	});

	it('files a BUSINESS promise due on his date with NO grace week', async () => {
		const written = await writeScheduledIntent({
			companyId: 'company_1',
			contactId: 'contact_joe',
			profileId: 'contact_joe',
			extraction: {
				hasFutureIntent: true,
				schedulable: true,
				actor: 'BUSINESS',
				whatHeWants: 'a price on a new furnace',
				rawTimeframe: 'two weeks',
				timeframeDays: 14,
				exactDateIso: null,
				calculatedTargetDate: '2026-08-15T13:00:00.000Z',
				confidence: 'HIGH',
				preferredChannel: 'phone'
			},
			channel: 'voice',
			conversationId: 'container_joe',
			commLogId: 'comm_joe',
			reference: JOE_CALL,
			idempotencyKey: 'orch_callback_comm_joe'
		});

		expect(written.recorded).toBe(true);
		const row = prismaMock.scheduledIntent.create.mock.calls[0][0].data;
		expect(row.actor).toBe('BUSINESS');
		expect(row.intentType).toBe('CUSTOMER_COMMITMENT_B');
		// 15 Aug, not 22 — the grace week is scenario A's, and applying it here would be being
		// late, not being patient.
		expect(row.dueAt.toISOString()).toBe('2026-08-15T13:00:00.000Z');
		// The conversation this belongs to, carried onto every attempt that follows.
		expect(row.payload.conversationId).toBe('container_joe');
	});
});

describe('the thank-you is a send, so it needs something to send to', () => {
	it('a caller with neither mobile nor email cannot be auto-dialled either (§3.5)', async () => {
		prismaMock.contact.findFirst.mockResolvedValue({
			phone: '+14165550000',
			email: null,
			cell: null
		} as any);
		const { getLineType } = await import('../number-lookup');
		vi.mocked(getLineType).mockResolvedValueOnce('landline' as any);

		const verdict = await canAutoDial({ companyId: 'company_1', contactId: 'contact_joe' });
		// A landline identifies a handset, not a person. We don't know who to ask for.
		expect(verdict.allowed).toBe(false);
		expect(verdict.reason).toBe('shared_line_landline');
	});

	it('an email on file is enough — Tier 1 resolves the person even off a shared line', async () => {
		prismaMock.contact.findFirst.mockResolvedValue({
			phone: '+14165550000',
			email: 'joe@example.com',
			cell: null
		} as any);
		const verdict = await canAutoDial({ companyId: 'company_1', contactId: 'contact_joe' });
		expect(verdict.allowed).toBe(true);
		expect(verdict.reason).toBe('email_on_file');
	});
});

describe('a polite reply is not us keeping our promise', () => {
	it('Joe texting "thanks" does NOT discharge the callback we owe him', async () => {
		// He replies to the approved thank-you SMS on 2 Aug. Under the old gate this skipped the
		// row outright, and the daily calling — which runs after the gate — never happened at all.
		prismaMock.communicationLog.findMany.mockResolvedValue([
			{ id: 'log_thanks', metadata: { thread_id: 't' } }
		] as any);

		const verdict = await verifyDueIntent(joeRow());
		expect(verdict.pass).toBe(true);
	});

	it('but for scenario A — where HE said he would ring — it still does', async () => {
		prismaMock.communicationLog.findMany.mockResolvedValue([
			{ id: 'log_ray', metadata: { thread_id: 't' } }
		] as any);

		const verdict = await verifyDueIntent(joeRow({ actor: 'CUSTOMER' }));
		expect(verdict.pass).toBe(false);
		expect(verdict.reason).toBe('customer_contacted_since');
	});
});

describe('13 Aug — the sweep starts calling', () => {
	it('queues the attempt and schedules tomorrow when there is no answer', async () => {
		prismaMock.scheduledIntent.findMany.mockResolvedValue([joeRow()] as any);

		const out = await checkDueScheduledIntents(new Date('2026-08-13T13:00:00Z'));

		expect(out.handedOff).toBe(1);
		expect(out.reached).toBe(0);

		// Tomorrow's attempt exists, carrying the trail.
		const retry = prismaMock.scheduledIntent.create.mock.calls[0][0].data;
		expect(retry.dueAt.toISOString().slice(0, 10)).toBe('2026-08-14');
		expect(retry.actor).toBe('BUSINESS');
		expect(retry.payload.callbackAttempts_history).toHaveLength(1);
		expect(retry.payload.rootIntentId).toBe('intent_joe');
		// The window we search for contact stays pinned to the promise, not to this row.
		expect(retry.payload.promiseSince).toBe(JOE_CALL.toISOString());
		// Keyed off the root, so re-running 13 Aug cannot fork the chain.
		expect(retry.idempotencyKey).toBe('cb_intent_joe_attempt_2');
	});

	it('tags the attempt with the original conversation\'s COM id', async () => {
		prismaMock.scheduledIntent.findMany.mockResolvedValue([joeRow()] as any);

		await checkDueScheduledIntents(new Date('2026-08-13T13:00:00Z'));

		// The container is re-read under BOTH companyId and contactId — a payload pointing at
		// another customer's thread can never be honoured.
		expect(prismaMock.commContainer.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'container_joe', companyId: 'company_1', contactId: 'contact_joe' }
			})
		);
		expect(prismaMock.communicationThread.upsert).toHaveBeenCalled();
	});
});

describe('14 Aug — we reach his answering service', () => {
	it('a machine-detected call is not contact, so we try again', async () => {
		prismaMock.communicationLog.findMany.mockResolvedValue([
			{
				direction: 'outbound',
				duration: 45,
				metadata: { machine_detection: 'machine' },
				created: new Date('2026-08-14T14:00:00Z')
			}
		] as any);

		const reached = await haveWeReachedThem({
			companyId: 'company_1',
			contactId: 'contact_joe',
			since: JOE_CALL
		});
		// 45 seconds, comfortably over the threshold — and still not him. The machine flag is
		// checked before the duration precisely so a long message left on a machine can't pass.
		expect(reached.reached).toBe(false);
	});

	it('a twelve-second connect is not contact either', async () => {
		prismaMock.communicationLog.findMany.mockResolvedValue([
			{ direction: 'outbound', duration: 12, metadata: {}, created: new Date('2026-08-14T14:00:00Z') }
		] as any);

		const reached = await haveWeReachedThem({
			companyId: 'company_1',
			contactId: 'contact_joe',
			since: JOE_CALL
		});
		expect(reached.reached).toBe(false);
		expect(12).toBeLessThan(MIN_CONNECT_SECONDS);
	});

	it('keeps trying — there is no attempt cap, only the promise expiring', () => {
		const decision = decideNextAttempt({
			reached: { reached: false, reason: 'no_conversation_yet' },
			attemptsSoFar: 6,
			now: new Date('2026-08-14T13:00:00Z')
		});
		expect(decision.action).toBe('try_again');
		expect(decision.attempt).toBe(7);
	});

	it('the trail accumulates across the chain', async () => {
		prismaMock.scheduledIntent.findMany.mockResolvedValue([
			joeRow({
				id: 'intent_joe_2',
				dueAt: new Date('2026-08-14T13:00:00Z'),
				createdAt: new Date('2026-08-13T13:00:00Z'),
				payload: {
					...joeRow().payload,
					rootIntentId: 'intent_joe',
					promiseSince: JOE_CALL.toISOString(),
					callbackAttempts_history: [
						{ n: 1, at: '2026-08-13T13:00:00.000Z', outcome: 'no_conversation_yet' }
					]
				}
			})
		] as any);

		await checkDueScheduledIntents(new Date('2026-08-14T13:00:00Z'));

		const retry = prismaMock.scheduledIntent.create.mock.calls[0][0].data;
		expect(retry.payload.callbackAttempts_history).toHaveLength(2);
		expect(retry.idempotencyKey).toBe('cb_intent_joe_attempt_3');
		// Still measured from 1 Aug, not from yesterday's row.
		expect(retry.payload.promiseSince).toBe(JOE_CALL.toISOString());
	});
});

describe('15 Aug — we actually speak to him', () => {
	it('a real conversation stops the daily calling', async () => {
		prismaMock.scheduledIntent.findMany.mockResolvedValue([
			joeRow({ dueAt: new Date('2026-08-15T13:00:00Z') })
		] as any);
		prismaMock.communicationLog.findMany.mockResolvedValue([
			{ direction: 'outbound', duration: 240, metadata: {}, created: new Date('2026-08-15T14:00:00Z') }
		] as any);

		const out = await checkDueScheduledIntents(new Date('2026-08-15T15:00:00Z'));

		expect(out.reached).toBe(1);
		// "Once we reach him we remove the condition that we need to call each day."
		expect(prismaMock.scheduledIntent.create).not.toHaveBeenCalled();
		// No further draft is queued either — what happens next is decided by what he said.
		expect(logCommunication).not.toHaveBeenCalled();
	});

	it('him ringing us counts too, however it happened', async () => {
		prismaMock.communicationLog.findMany.mockResolvedValue([
			{ direction: 'inbound', duration: 5, metadata: {}, created: new Date('2026-08-15T09:00:00Z') }
		] as any);

		const reached = await haveWeReachedThem({
			companyId: 'company_1',
			contactId: 'contact_joe',
			since: JOE_CALL
		});
		expect(reached.reached).toBe(true);
		expect(reached.reason).toBe('customer_called_us');
	});
});

describe('20 Aug — the promise expires without us ever reaching him (§3.4)', () => {
	it('is reported as a service failure, not a lapsed opportunity', async () => {
		const errors: string[] = [];
		const spy = vi.spyOn(console, 'error').mockImplementation((...a: any[]) => {
			errors.push(a.join(' '));
		});

		prismaMock.scheduledIntent.findMany.mockResolvedValue([
			joeRow({
				payload: {
					...joeRow().payload,
					rootIntentId: 'intent_joe',
					callbackAttempts_history: [
						{ n: 1, at: '2026-08-13T13:00:00.000Z', outcome: 'no_conversation_yet' },
						{ n: 2, at: '2026-08-14T13:00:00.000Z', outcome: 'no_conversation_yet' }
					]
				}
			})
		] as any);

		const out = await checkDueScheduledIntents(new Date('2026-08-21T13:00:00Z'));

		expect(out.expired).toBe(1);
		// WE broke this promise. An expired mode-A row is a customer who went quiet; this is not
		// that, and it must not sit in the same pile looking like an untaken lead.
		expect(out.failedPromises).toBe(1);
		expect(errors.join('\n')).toContain('SERVICE FAILURE');
		// The person picking it up gets what we tried.
		expect(errors.join('\n')).toContain('#1');
		expect(errors.join('\n')).toContain('#2');

		spy.mockRestore();
	});
});

describe('readTrail', () => {
	it('reads a promise written before the trail existed as N unrecorded attempts', () => {
		const trail = readTrail({ callbackAttempts: 3 });
		expect(trail.attempts).toHaveLength(3);
		expect(trail.attempts[0].at).toBe('unrecorded');
	});

	it('a fresh promise has no attempts', () => {
		expect(readTrail({}).attempts).toEqual([]);
		expect(readTrail(null).attempts).toEqual([]);
	});
});
