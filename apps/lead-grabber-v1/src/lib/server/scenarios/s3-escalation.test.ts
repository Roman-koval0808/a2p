import { describe, it, expect, vi } from 'vitest';
import {
	analyzeRepeatContactDelta,
	processSecondEmergencyVoicemail,
	handleBridgeFailure
} from './s3-escalation';
import { shouldSuppressActions } from '$lib/server/container/container-service';

vi.mock('$lib/db', () => ({
	prisma: {
		commEntry: {
			create: vi.fn().mockImplementation((opts) => Promise.resolve({ id: 'entry_2', ...opts.data }))
		}
	}
}));

describe('Scenario 3 Acceptance Tests — Escalation & Dedup (§Part 3 & 5)', () => {
	it('3-8: Unrelated sales message during open emergency DOES NOT suppress (insisted test)', () => {
		const now = new Date('2026-08-04T10:00:00Z');
		const openEmergencyContainer = {
			id: 'c_emerg_1',
			threadType: 'emergency' as const,
			openedAt: new Date('2026-08-04T09:30:00Z'),
			joinWindowSeconds: 7200,
			state: 'open' as const
		};

		// Incoming signal is sales -> suppression MUST NOT fire!
		const suppression = shouldSuppressActions({
			incomingType: 'sales',
			openContainers: [openEmergencyContainer],
			now
		});

		expect(suppression.suppress).toBe(false);
	});

	it('3-1 & 3-1b: Second emergency voicemail suppresses new bridge/SLA clock but stores recording and appends entry', async () => {
		const existingContainer = {
			id: 'c_emerg_1',
			commRef: '#4412',
			threadType: 'emergency',
			state: 'open'
		};

		const initialWorkOrder = {
			commId: 'c_emerg_1',
			customerNumber: '+15551234567',
			dialLadder: [
				{ userId: 'u_tech1', name: 'Primary', phone: '+15550000001', rung: 1 },
				{ userId: 'u_tech2', name: 'Backup', phone: '+15550000002', rung: 2 },
				{ userId: 'u_owner', name: 'Owner', phone: '+15550000009', rung: 4 }
			],
			currentRung: 1,
			maxAttemptsPerRung: 1,
			whisperText: 'Emergency call, John Smith',
			emergencySummary: 'Flooding',
			slaDeadline: new Date(Date.now() + 600000),
			escalationPolicy: 'ladder_with_dtmf'
		};

		const res = await processSecondEmergencyVoicemail({
			companyId: 'comp_1',
			customerPhone: '+15551234567',
			firstTranscript: 'Water leak in basement.',
			secondTranscript: 'Water leak getting worse, water rising fast!',
			existingContainer,
			workOrder: initialWorkOrder
		});

		// Entry stored & dedupSuppressed set on entry
		expect(res.entry).toBeDefined();
		expect(res.entry.dedupSuppressed).toBe(true);

		// Escalation advanced to backup tech immediately!
		expect(res.escalationAdvanced).toBe(true);
		expect(res.nextTech.rung).toBe(2);
		expect(res.updatedWorkOrder.whisperText).toContain('SECOND CALL');
	});

	it('3-2: Second voicemail with new callback number updates next attempt number and flags delta', () => {
		const delta = analyzeRepeatContactDelta(
			'Water leak in basement.',
			"Call my cell at 555-999-8888, don't call the home phone!",
			'+15551234567',
			'+15559998888'
		);

		expect(delta.callbackNumberChanged).toBe(true);
		expect(delta.newCallbackNumber).toBe('+15559998888');
		expect(delta.deltaText).toContain('New callback number');
	});

	it('3-3: Second voicemail with worsening condition updates whisper text', () => {
		const delta = analyzeRepeatContactDelta(
			'Water leak in basement.',
			"It is getting worse and water is everywhere!",
			'+15551234567',
			'+15551234567'
		);

		expect(delta.severityIncreased).toBe(true);
		expect(delta.deltaText).toContain('getting worse');
	});

	it('3-5 & Five Failure Types: Customer no-answer triggers retry schedule; drop under 30s is not resolution', async () => {
		// Failure 3: customer no answer -> retry schedule
		const custNoAns = await handleBridgeFailure({
			commId: 'c_emerg_1',
			failureType: 'customer_no_answer',
			workOrder: {} as any
		});
		expect(custNoAns.action).toBe('retry_customer_schedule');
		expect(custNoAns.retryDelaySeconds).toBe(120);

		// Failure 5: drop under 30s -> not resolution, retry immediately
		const dropUnder30 = await handleBridgeFailure({
			commId: 'c_emerg_1',
			failureType: 'bridge_dropped_under_30s',
			attemptDurationSeconds: 12,
			workOrder: {} as any
		});
		expect(dropUnder30.action).toBe('next_rung_immediately');
	});
});
