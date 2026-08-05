// ClearSky Scheduled Intents — Ray Charbonneau scenario, end to end (tasks §8.1).
//
// The whole feature, walked as one story with the DB mocked at the client level:
//   4 Aug — Ray emails "we'll call in a couple of weeks" → a CRM note lands on his
//           profile and a schedule row is filed for 25 Aug. (No instant ack: the
//           Orchestrator drafts the real reply.)
//  10 Aug — his committed window means decay is paused and nurture goes quiet.
//  16 Aug — Ray calls. The 25 Aug row is SKIPPED at the trigger — no agent task.
//  25 Aug — alternate: he never called → the sweep hands off to the Orchestrator,
//           queueing a pending_approval draft quoting his exact phrase.
//
// It exercises the real modules (parser, writer, sweep, handoff,
// open-commitments) with only the Prisma client and the queue writer mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';
import { extractScheduledIntent } from '../ai/scheduled-intent-parser';
import { claudeJSON, CLAUDE_FAST } from '../anthropic';
import { writeScheduledIntent } from '../scheduled-intent-writer';
import { checkDueScheduledIntents, verifyDueIntent } from '../scheduled-intents-sweep';
import {
	committedWindowDays,
	effectiveInactiveDays,
	shouldSuppressMarketing
} from '../open-commitments';

const { prismaMock } = vi.hoisted(() => ({
	prismaMock: {
		$transaction: vi.fn(),
		contact: { findUnique: vi.fn() },
		company: { findUnique: vi.fn() },
		scheduledIntent: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
		communicationLog: { findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
		appointment: { findFirst: vi.fn(), findMany: vi.fn() },
		transaction: { findFirst: vi.fn(), findMany: vi.fn() },
		smsConsent: { findFirst: vi.fn() }
	}
}));

vi.mock('$lib/db', () => ({ prisma: prismaMock }));

vi.mock('$lib/utils/communication-log', () => ({ logCommunication: vi.fn() }));

vi.mock('../anthropic', () => ({
	claudeJSON: vi.fn(),
	CLAUDE_FAST: 'claude-fast'
}));

/** Ray's row, exactly as the writer files it: due 25 Aug, expires 8 Sep (§3). */
const RAY_REFERENCE = new Date('2026-08-04T13:00:00Z'); // 09:00 Toronto
const rayIntentRow = {
	id: 'intent_ray',
	clientId: 'company_1',
	profileId: 'contact_1',
	intentType: 'CUSTOMER_COMMITMENT_A',
	dueAt: new Date('2026-08-25T13:00:00Z'),
	expiresAt: new Date('2026-09-08T13:00:00Z'),
	status: 'PENDING',
	actor: 'CUSTOMER',
	payload: {
		whatHeWants: 'air conditioning',
		rawTimeframe: 'a couple of weeks',
		preferredChannel: 'call',
		calculatedTargetDate: '2026-08-18T13:00:00.000Z',
		confidence: 'HIGH',
		conversationId: 'thread_1',
		referenceIso: RAY_REFERENCE.toISOString()
	},
	createdAt: RAY_REFERENCE,
	updatedAt: RAY_REFERENCE
};

beforeEach(() => {
	vi.clearAllMocks();

	prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
	prismaMock.scheduledIntent.findUnique.mockResolvedValue(null);
	prismaMock.scheduledIntent.updateMany.mockResolvedValue({ count: 1 });
	prismaMock.communicationLog.delete.mockResolvedValue({ id: 'queue_1' } as any);
	prismaMock.appointment.findFirst.mockResolvedValue(null);
	prismaMock.transaction.findFirst.mockResolvedValue(null);
	prismaMock.appointment.findMany.mockResolvedValue([]);
	prismaMock.transaction.findMany.mockResolvedValue([]);
	prismaMock.smsConsent.findFirst.mockResolvedValue(null);
	prismaMock.company.findUnique.mockResolvedValue({ name: 'Total Trades' } as any);
	prismaMock.contact.findUnique.mockResolvedValue({
		id: 'contact_1',
		name: 'Ray Charbonneau',
		cell: '+14165551234',
		phone: null,
		email: 'ray@example.com',
		landline: null
	} as any);
	vi.mocked(logCommunication).mockResolvedValue({ id: 'queue_1' } as any);
	vi.mocked(claudeJSON).mockResolvedValue({
		hasFutureIntent: true,
		whatHeWants: 'air conditioning',
		rawTimeframe: 'a couple of weeks',
		timeframeDays: 14,
		exactDateIso: null,
		confidence: 'HIGH',
		actor: 'CUSTOMER',
		preferredChannel: 'call'
	});
});

describe('4 Aug — Ray emails "call in a couple of weeks"', () => {
	it('parses the message into a schedulable 18 Aug target', async () => {
		const extraction = await extractScheduledIntent(
			'Hi, we moved into the new house and need air conditioning. I will call you in a couple of weeks. — Ray',
			'test-key',
			{ reference: RAY_REFERENCE, timeZone: 'America/Toronto' }
		);
		expect(extraction).not.toBeNull();
		expect(extraction!.actor).toBe('CUSTOMER');
		expect(extraction!.schedulable).toBe(true);
		expect(extraction!.calculatedTargetDate).toBe('2026-08-18T13:00:00.000Z');
	});

	it('writes the dual record: CRM note for Total Trades + schedule row for 25 Aug (expires 8 Sep)', async () => {
		const extraction = (await extractScheduledIntent(
			'I will call in a couple of weeks about AC. — Ray',
			'test-key',
			{ reference: RAY_REFERENCE }
		))!;

		prismaMock.scheduledIntent.create.mockResolvedValue({ id: 'intent_ray' } as any);
		prismaMock.communicationLog.create.mockResolvedValue({ id: 'note_1' } as any);

		const out = await writeScheduledIntent({
			companyId: 'company_1',
			contactId: 'contact_1',
			profileId: 'contact_1',
			extraction,
			channel: 'email',
			conversationId: 'thread_1',
			reference: RAY_REFERENCE,
			idempotencyKey: 'si-email-msg_1'
		});

		expect(out.recorded).toBe(true);
		// His date + 7 days grace (§3) — the spec's 25 Aug / 8 Sep.
		expect(out.dueAt).toBe('2026-08-25T13:00:00.000Z');
		expect(out.expiresAt).toBe('2026-09-08T13:00:00.000Z');

		// Total Trades' record: a factual note with his words, flagged as ours.
		const note = vi.mocked(prismaMock.communicationLog.create).mock.calls[0][0].data;
		expect(note.metadata).toMatchObject({ scheduled_intent_note: true, intentId: 'intent_ray' });
		expect(note.summary).toContain('air conditioning');
		expect(note.summary).toContain('around Aug 25');

		// Our record: the plan, quoting him.
		const row = vi.mocked(prismaMock.scheduledIntent.create).mock.calls[0][0];
		expect(row.data.actor).toBe('CUSTOMER');
		expect(row.data.payload.rawTimeframe).toBe('a couple of weeks');
	});
});

describe('10 Aug — the committed window is doing its job (§7)', () => {
	const windows = [
		{
			kind: 'scheduled_intent' as const,
			startedAt: RAY_REFERENCE,
			resolvesAt: new Date('2026-08-25T13:00:00Z')
		}
	];
	const now = new Date('2026-08-10T13:00:00Z');

	it('decay is paused: the days he told us about are subtracted from inactivity', () => {
		// 6 days since his email, and all 6 were inside the window he told us about.
		expect(committedWindowDays(windows, RAY_REFERENCE, now)).toBe(6);
		expect(effectiveInactiveDays(RAY_REFERENCE, windows, now)).toBe(0);
		// Without the commitment the clock runs normally.
		expect(effectiveInactiveDays(RAY_REFERENCE, [], now)).toBe(6);
	});

	it('nurture and keep-in-touch are suppressed; obligations (service reminders) are not', async () => {
		prismaMock.scheduledIntent.findMany.mockResolvedValue([{ id: 'intent_ray' }]);

		expect(await shouldSuppressMarketing('contact_1', 'nurture', now)).toBe(true);
		expect(await shouldSuppressMarketing('contact_1', 'keep_in_touch', now)).toBe(true);
		expect(await shouldSuppressMarketing('contact_1', 'service_reminder', now)).toBe(false);
	});
});

describe('16 Aug — Ray actually calls', () => {
	it('the 25 Aug row is SKIPPED at the trigger: he did what he said, nothing reaches the queue', async () => {
		prismaMock.communicationLog.findMany.mockResolvedValue([
			{ id: 'inbound_2', metadata: { thread_id: 'thread_1', subject: 'Re: estimate' } }
		]);

		const verdict = await verifyDueIntent({
			id: 'intent_ray',
			clientId: 'company_1',
			profileId: 'contact_1',
			createdAt: RAY_REFERENCE
		});
		expect(verdict.pass).toBe(false);
		expect(verdict.reason).toBe('customer_contacted_since');

		// And our own automated ack never counts as contact (§5).
		prismaMock.communicationLog.findMany.mockResolvedValue([
			{ id: 'ack_1', metadata: { scheduled_intent_ack: true } }
		]);
		expect(
			(await verifyDueIntent({ id: 'intent_ray', clientId: 'company_1', profileId: 'contact_1', createdAt: RAY_REFERENCE })).pass
		).toBe(true);

		// Full sweep on the trigger date: the row is marked SKIPPED, no draft queued.
		prismaMock.communicationLog.findMany.mockResolvedValue([
			{ id: 'inbound_2', metadata: { thread_id: 'thread_1' } }
		]);
		prismaMock.scheduledIntent.findMany.mockResolvedValue([rayIntentRow]);

		const out = await checkDueScheduledIntents(new Date('2026-08-25T13:00:00Z'));
		expect(out.due).toBe(1);
		expect(out.skipped).toBe(1);
		expect(out.handedOff).toBe(0);
		expect(vi.mocked(logCommunication)).not.toHaveBeenCalled();
		expect(prismaMock.scheduledIntent.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ status: 'SKIPPED' }) })
		);
	});
});

describe('25 Aug — alternate: Ray never called back', () => {
	it('the sweep hands off to the Orchestrator: an agent draft quoting his exact phrase', async () => {
		prismaMock.communicationLog.findMany.mockResolvedValue([]);
		prismaMock.scheduledIntent.findMany.mockResolvedValue([rayIntentRow]);

		const out = await checkDueScheduledIntents(new Date('2026-08-25T13:00:00Z'));

		expect(out.due).toBe(1);
		expect(out.handedOff).toBe(1);
		expect(out.skipped).toBe(0);

		// The draft is personalised and quotes HIS words (§9) — not a batch message.
		const logged = vi.mocked(logCommunication).mock.calls[0][0];
		expect(logged.content).toContain('a couple of weeks');
		expect(logged.content).toContain('air conditioning');
		expect(logged.summary).toContain('[SCHED-INTENT] Ray Charbonneau');
		expect(logged.summary).toContain('+14165551234');
		expect(logged.status).toBe('pending_approval');
		expect(logged.metadata).toMatchObject({
			action: 'SCHED-INTENT-FOLLOWUP',
			intentId: 'intent_ray',
			channel: 'voice',
			companyName: 'Total Trades'
		});

		// The row is claimed PENDING → DONE only after the draft landed.
		expect(prismaMock.scheduledIntent.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: 'intent_ray', status: 'PENDING' } })
		);
	});

	it('rows past expiry are marked EXPIRED, never queued (§12)', async () => {
		const stale = { ...rayIntentRow, expiresAt: new Date('2026-09-08T13:00:00Z') };
		prismaMock.scheduledIntent.findMany.mockResolvedValue([stale]);

		const out = await checkDueScheduledIntents(new Date('2026-09-09T13:00:00Z'));

		expect(out.expired).toBe(1);
		expect(out.handedOff).toBe(0);
		expect(vi.mocked(logCommunication)).not.toHaveBeenCalled();
		expect(prismaMock.scheduledIntent.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ status: 'EXPIRED' }) })
		);
	});
});
