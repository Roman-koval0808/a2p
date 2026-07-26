import { describe, it, expect, vi } from 'vitest';
import {
	processSalesVoicemailBooking,
	parseSmsReplyIntent,
	handleInboundSmsReply
} from './s4-sms-booking';
import { canAutoClose } from '$lib/server/timer/timer-service';

vi.mock('$lib/db', () => ({
	prisma: {
		commHold: {
			create: vi.fn().mockImplementation((opts) => Promise.resolve({ id: 'hold_1', ...opts.data })),
			update: vi.fn().mockResolvedValue({})
		},
		commTask: {
			create: vi.fn().mockImplementation((opts) => Promise.resolve({ id: 'task_1', ...opts.data }))
		},
		commApproval: {
			create: vi.fn().mockImplementation((opts) => Promise.resolve({ id: 'appr_1', ...opts.data }))
		},
		pipelineTimer: {
			create: vi.fn().mockResolvedValue({ id: 'tmr_1' }),
			update: vi.fn().mockResolvedValue({}),
			updateMany: vi.fn().mockResolvedValue({})
		}
	}
}));

describe('Scenario 4 Acceptance Tests — Sales Voicemail & SMS Loop (§Part 3 & 5)', () => {
	const callStartTime = new Date('2026-08-01T12:00:00Z'); // Saturday

	it('4-2: "Tuesday at 10:00" bare weekday resolves to explicit date in SMS draft', async () => {
		const res = await processSalesVoicemailBooking({
			commId: 'c_sales_1',
			companyId: 'comp_1',
			customerPhone: '+15551234567',
			transcriptWeekday: 'Tuesday',
			productInterest: 'Civic',
			callStartTime,
			availableResources: { personnel: ['u_sales1'], assets: ['v_civic1'] }
		});

		expect(res.slotAvailable).toBe(true);
		expect(res.smsDrafted).toBe(true);
		expect(res.explicitDateText).toContain('Tuesday');
		expect(res.explicitDateText).toContain('August 4');
		expect(res.approval.draftContent).toContain('August 4');
	});

	it('4-3: Personnel/slot taken -> DOES NOT send confirmation, creates human task', async () => {
		const res = await processSalesVoicemailBooking({
			commId: 'c_sales_2',
			companyId: 'comp_1',
			customerPhone: '+15551234567',
			transcriptWeekday: 'Tuesday',
			productInterest: 'Civic',
			callStartTime,
			availableResources: { personnel: [], assets: [] } // No resource available!
		});

		expect(res.slotAvailable).toBe(false);
		expect(res.smsDrafted).toBe(false);
		expect(res.taskCreated).toBe(true);
		expect(res.task?.ownerUserId).toBeDefined();
		expect(res.task?.due).toBeInstanceOf(Date);
	});

	it('4-4: Customer replies "can we do 11 instead" -> routes to human, hold is preserved', async () => {
		const pendingHolds = [{ id: 'hold_1', status: 'tentative' }];
		const res = await handleInboundSmsReply({
			commId: 'c_sales_3',
			customerPhone: '+15551234567',
			replyText: 'can we do 11 instead?',
			pendingHolds
		});

		expect(res.intent).toBe('counter_propose');
		expect(res.routedToHuman).toBe(true);
		expect(res.holdPreserved).toBe(true);
	});

	it('4-5: Customer replies "YES" -> booked and hold confirmed', async () => {
		const pendingHolds = [{ id: 'hold_1', status: 'tentative' }];
		const res = await handleInboundSmsReply({
			commId: 'c_sales_4',
			customerPhone: '+15551234567',
			replyText: 'YES',
			pendingHolds
		});

		expect(res.intent).toBe('confirm');
		expect(res.booked).toBe(true);
		expect(res.terminalState).toBe('booked');
	});

	it('4-6: Customer replies "STOP" -> platform opt-out, hold released, human notified', async () => {
		const pendingHolds = [{ id: 'hold_1', status: 'tentative' }];
		const res = await handleInboundSmsReply({
			commId: 'c_sales_5',
			customerPhone: '+15551234567',
			replyText: 'STOP',
			pendingHolds
		});

		expect(res.intent).toBe('opt_out');
		expect(res.terminalState).toBe('declined');
		expect(res.task).toBeDefined();
	});

	it('4-7: Customer replies "how much is the Civic" -> intent is question, routes to human', async () => {
		const pendingHolds = [{ id: 'hold_1', status: 'tentative' }];
		const res = await handleInboundSmsReply({
			commId: 'c_sales_6',
			customerPhone: '+15551234567',
			replyText: 'how much is the Civic?',
			pendingHolds
		});

		expect(res.intent).toBe('question');
		expect(res.routedToHuman).toBe(true);
	});

	it('4-8: Hold expiry vs approval deadline (insisted test) -> active tentative hold prevents auto-close', () => {
		const container = {
			closurePolicy: 'auto',
			slaDeadline: null
		};

		const canClose = canAutoClose(container, {
			hasOpenPromise: false,
			hasPendingApproval: false,
			hasTentativeHold: true // Active hold exists!
		});

		expect(canClose).toBe(false); // MUST NOT auto-close!
	});

	it('4-9: Two pending confirmations for same number -> routes to human without guessing', async () => {
		const multipleHolds = [
			{ id: 'hold_1', status: 'tentative' },
			{ id: 'hold_2', status: 'tentative' }
		];

		const res = await handleInboundSmsReply({
			commId: 'c_sales_7',
			customerPhone: '+15551234567',
			replyText: 'YES',
			pendingHolds: multipleHolds
		});

		expect(res.routedToHuman).toBe(true);
		expect(res.reason).toBe('multiple_pending_confirmations');
	});

	it('4-10: Landline caller -> skips SMS, creates phone-call task for rep', async () => {
		const res = await processSalesVoicemailBooking({
			commId: 'c_sales_8',
			companyId: 'comp_1',
			customerPhone: '+15551234567',
			isLandline: true,
			callStartTime,
			availableResources: { personnel: ['u_sales1'], assets: ['v_civic1'] }
		});

		expect(res.isLandline).toBe(true);
		expect(res.smsDrafted).toBe(false);
		expect(res.taskCreated).toBe(true);
		expect(res.task?.description).toContain('Landline cannot receive SMS');
	});
});
