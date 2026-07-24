import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	processEmergencyVoicemail,
	handleTechDtmfResponse,
	extractTasksFromEmergencyCall
} from './s2-emergency-bridge';

vi.mock('$lib/db', () => ({
	prisma: {
		pipelineTimer: {
			create: vi.fn().mockResolvedValue({ id: 'tmr_1' }),
			update: vi.fn().mockResolvedValue({})
		},
		commTask: {
			create: vi.fn().mockImplementation((opts) => Promise.resolve({ id: 'task_1', ...opts.data }))
		}
	}
}));

describe('Scenario 2 Acceptance Tests — Emergency Bridge (§Part 3 & 5)', () => {
	it('2-8: Routine non-emergency voicemail DOES NOT trigger bridge (insisted test)', async () => {
		const result = await processEmergencyVoicemail({
			commId: 'c_1',
			companyId: 'comp_1',
			customerPhone: '+15551234567',
			transcript: 'Hi, I would like to inquire about your store hours tomorrow. Thanks!'
		});

		expect(result.isEmergency).toBe(false);
		expect(result.bridgeTriggered).toBe(false);
		expect(result.workOrder).toBeNull();
	});

	it('2-1: Emergency voicemail triggers bridge work order and extracts tasks on call end', async () => {
		const result = await processEmergencyVoicemail({
			commId: 'c_2',
			companyId: 'comp_1',
			customerPhone: '+15551234567',
			transcript: 'Help! Water everywhere, pipe burst in the basement!'
		});

		expect(result.isEmergency).toBe(true);
		expect(result.bridgeTriggered).toBe(true);
		expect(result.workOrder?.dialLadder.length).toBeGreaterThan(0);

		// DTMF 1 -> bridge customer
		const dtmfRes = await handleTechDtmfResponse({
			commId: 'c_2',
			dtmfDigit: '1',
			currentRung: 1,
			workOrder: result.workOrder!
		});
		expect(dtmfRes.action).toBe('bridge_customer');

		// Extract tasks from call
		const tasks = await extractTasksFromEmergencyCall({
			commId: 'c_2',
			techUserId: 'u_tech1',
			transcript: "I'll be there by 4pm to fix the burst pipe."
		});

		expect(tasks.length).toBeGreaterThan(0);
		expect(tasks[0].category).toBe('customer_promise');
		expect(tasks[0].ownerUserId).toBe('u_tech1');
		expect(tasks[0].due).toBeInstanceOf(Date);
	});

	it('2-2: Tech voicemail answers leg A, no keypress -> DOES NOT dial customer, moves to next rung', async () => {
		const workOrder = (
			await processEmergencyVoicemail({
				commId: 'c_3',
				companyId: 'comp_1',
				customerPhone: '+15551234567',
				transcript: 'Basement flooding, urgent!'
			})
		).workOrder!;

		// Timeout / no keypress (voicemail) -> digit is empty
		const res = await handleTechDtmfResponse({
			commId: 'c_3',
			dtmfDigit: '',
			currentRung: 1,
			workOrder
		});

		expect(res.action).toBe('next_rung');
		expect(res.nextTech?.rung).toBe(2);
	});

	it('2-3: Tech presses 2 (decline) -> moves to next rung', async () => {
		const workOrder = (
			await processEmergencyVoicemail({
				commId: 'c_4',
				companyId: 'comp_1',
				customerPhone: '+15551234567',
				transcript: 'Gas leak emergency!'
			})
		).workOrder!;

		const res = await handleTechDtmfResponse({
			commId: 'c_4',
			dtmfDigit: '2',
			currentRung: 1,
			workOrder
		});

		expect(res.action).toBe('next_rung');
		expect(res.nextTech?.rung).toBe(2);
	});

	it('2-4: Rung ladder exhausted -> escalates to owner', async () => {
		const workOrder = (
			await processEmergencyVoicemail({
				commId: 'c_5',
				companyId: 'comp_1',
				customerPhone: '+15551234567',
				transcript: 'Flooding emergency!'
			})
		).workOrder!;

		const res = await handleTechDtmfResponse({
			commId: 'c_5',
			dtmfDigit: '2',
			currentRung: workOrder.dialLadder.length, // At last rung
			workOrder
		});

		expect(res.action).toBe('exhausted');
	});
});
