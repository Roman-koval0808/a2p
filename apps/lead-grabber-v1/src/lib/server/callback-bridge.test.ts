// Does the leadbox callback actually walk the emergency dial ladder the way the brief describes,
// and — the constraint that matters — WITHOUT changing what an emergency does?
//
// callback-routing.test.ts covers the decision (which window, which rep). This covers the bridge:
// the work order the ladder receives, the accept/decline/no-answer transitions, the walk to the
// next representative, and termination. It drives the REAL functions the Telnyx webhook calls
// (`handleTechDtmfResponse`, `handleBridgeFailure`, `startDialLadder`) with `fetch` stubbed, so a
// change to any of them fails here.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleTechDtmfResponse } from './scenarios/s2-emergency-bridge';
import { handleBridgeFailure } from './scenarios/s3-escalation';
import { callbackWhisperText, buildRepRota } from './callback-routing';
import type { EmergencyBridgeWorkOrder } from './scenarios/s2-emergency-bridge';

vi.mock('$env/static/private', () => ({
	TELNYX_API_KEY: 'test-key',
	TELNYX_CONNECTION_ID: 'test-conn'
}));

vi.mock('$lib/db', () => ({ prisma: {} }));

const logged: any[] = [];
vi.mock('$lib/utils/communication-log', () => ({
	logCommunication: vi.fn(async (row: any) => {
		logged.push(row);
		return { id: 'log_1' };
	})
}));

vi.mock('$lib/company-numbers', () => ({
	getCompanyAndFlowByPhoneNumber: vi.fn(async () => ({ companyId: 'co_1' }))
}));

const JOE = { userId: 'u_joe', name: 'Joe Sales', phone: '+15550000001', rung: 1 };
const ANN = { userId: 'u_ann', name: 'Ann Backup', phone: '+15550000002', rung: 2 };

function callbackWorkOrder(over: Partial<EmergencyBridgeWorkOrder> = {}): EmergencyBridgeWorkOrder {
	return {
		commId: 'comm_leadbox_1',
		personId: null,
		customerNumber: '+15551234567', // Robert
		dialLadder: [JOE, ANN],
		currentRung: 1,
		maxAttemptsPerRung: 1,
		whisperText: callbackWhisperText({
			customerName: 'Robert Betts',
			message: 'Requested Call back. Preferred Time: ASAP',
			preference: 'ASAP'
		}),
		emergencySummary: 'Callback request (ASAP)',
		slaDeadline: new Date(),
		escalationPolicy: 'ladder_with_dtmf',
		kind: 'callback',
		...over
	};
}

function emergencyWorkOrder(over: Partial<EmergencyBridgeWorkOrder> = {}): EmergencyBridgeWorkOrder {
	return {
		commId: 'comm_emergency_1',
		personId: null,
		customerNumber: '+15559999999',
		dialLadder: [JOE, ANN],
		currentRung: 1,
		maxAttemptsPerRung: 1,
		whisperText: 'Emergency call, burst pipe. Press 1 to connect, press 2 to decline.',
		emergencySummary: 'burst pipe',
		slaDeadline: new Date(),
		escalationPolicy: 'ladder_with_dtmf',
		// no `kind` — exactly as every existing emergency caller builds it
		...over
	};
}

beforeEach(() => {
	logged.length = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok: true, json: async () => ({ data: { call_control_id: 'cc_1' } }) }))
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('what the rep hears', () => {
	it('names the customer, the request, the message, and the keypad contract', () => {
		const wo = callbackWorkOrder();
		expect(wo.whisperText).toContain('Robert Betts');
		expect(wo.whisperText).toContain('Requested Call back');
		expect(wo.whisperText).toContain('Press 1 to accept, press 2 to decline.');
	});

	it('bridges back to the CUSTOMER, not to the company', () => {
		expect(callbackWorkOrder().customerNumber).toBe('+15551234567');
	});
});

describe('press 1 accept / press 2 decline / no answer', () => {
	const wo = callbackWorkOrder();

	it('1 bridges the customer', async () => {
		expect(await handleTechDtmfResponse({ commId: wo.commId, dtmfDigit: '1', currentRung: 1, workOrder: wo }))
			.toEqual({ action: 'bridge_customer' });
	});

	it('2 advances to the next representative on the list', async () => {
		const r = await handleTechDtmfResponse({
			commId: wo.commId,
			dtmfDigit: '2',
			currentRung: 1,
			workOrder: wo
		});
		expect(r.action).toBe('next_rung');
		expect(r.nextTech?.name).toBe('Ann Backup');
	});

	it('declining on the LAST rep exhausts the ladder rather than looping', async () => {
		const r = await handleTechDtmfResponse({
			commId: wo.commId,
			dtmfDigit: '2',
			currentRung: 2,
			workOrder: wo
		});
		expect(r.action).toBe('exhausted');
	});

	it('no answer and a silent voicemail both advance, same as a decline', async () => {
		for (const failureType of ['tech_no_answer', 'tech_voicemail_no_dtmf'] as const) {
			const r = await handleBridgeFailure({ commId: wo.commId, failureType, workOrder: wo });
			expect(r.action).toBe('next_rung_immediately');
		}
	});

	it('handleBridgeFailure never touches the database, so a synthetic commId is safe', async () => {
		// The callback path passes a CommunicationLog id or a `callback-<uuid>` string where the
		// emergency path passes a container id. This is the function both webhook branches call.
		const r = await handleBridgeFailure({
			commId: 'callback-not-a-real-row',
			failureType: 'tech_no_answer',
			workOrder: callbackWorkOrder({ commId: 'callback-not-a-real-row' })
		});
		expect(r.action).toBe('next_rung_immediately');
	});
});

describe('startDialLadder walks the list and stops', () => {
	it('dials rung 1 (Joe) first', async () => {
		const { startDialLadder } = await import('./emergency-dial');
		expect(await startDialLadder(callbackWorkOrder(), '+15550000000')).toBe(true);

		const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
		expect(body.to).toBe(JOE.phone);
	});

	it('dials rung 2 (Ann) after the ladder advances', async () => {
		const { startDialLadder } = await import('./emergency-dial');
		await startDialLadder(callbackWorkOrder({ currentRung: 2 }), '+15550000000');
		const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
		expect(body.to).toBe(ANN.phone);
	});

	it('stops when the list is exhausted instead of dialling nobody', async () => {
		const { startDialLadder } = await import('./emergency-dial');
		expect(await startDialLadder(callbackWorkOrder({ currentRung: 3 }), '+15550000000')).toBe(false);
		expect((globalThis.fetch as any).mock.calls).toHaveLength(0);
	});

	it('carries the work order in client_state so the webhook can resume the ladder', async () => {
		const { startDialLadder } = await import('./emergency-dial');
		await startDialLadder(callbackWorkOrder(), '+15550000000');
		const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
		const state = JSON.parse(Buffer.from(body.client_state, 'base64').toString());
		expect(state.isDialLadderTechLeg).toBe(true);
		expect(state.workOrder.customerNumber).toBe('+15551234567');
		expect(state.workOrder.dialLadder).toHaveLength(2);
	});
});

describe('the emergency ladder is not affected', () => {
	it('an emergency work order still logs the exact strings it always did', async () => {
		const { startDialLadder } = await import('./emergency-dial');
		await startDialLadder(emergencyWorkOrder(), '+15550000000');

		expect(logged).toHaveLength(1);
		expect(logged[0].summary).toBe('[System Dialing Tech] Escaping to Rung 1: Joe Sales');
		expect(logged[0].content).toBe(
			'System is automatically dialing technician Joe Sales at +15550000001 for emergency bridge.'
		);
		// The callback marker must not appear on an emergency row.
		expect(logged[0].metadata.callback_bridge).toBeUndefined();
		expect(logged[0].metadata).toMatchObject({ workOrder: true, rung: 1, tech_name: 'Joe Sales' });
	});

	it('a callback is labelled as one, so the two are tellable apart in the log', async () => {
		const { startDialLadder } = await import('./emergency-dial');
		await startDialLadder(callbackWorkOrder(), '+15550000000');

		expect(logged[0].summary).toBe('[System Dialing Rep] Callback rung 1: Joe Sales');
		expect(logged[0].metadata.callback_bridge).toBe(true);
	});

	it('both kinds produce an identical Telnyx dial request — the transport is untouched', async () => {
		const { startDialLadder } = await import('./emergency-dial');

		await startDialLadder(emergencyWorkOrder(), '+15550000000');
		const emergencyBody = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({ data: {} }) }))
		);
		await startDialLadder(callbackWorkOrder(), '+15550000000');
		const callbackBody = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);

		// Same connection, same rung target, same timeout — only client_state differs.
		expect(callbackBody.connection_id).toBe(emergencyBody.connection_id);
		expect(callbackBody.to).toBe(emergencyBody.to);
		expect(callbackBody.from).toBe(emergencyBody.from);
		expect(callbackBody.timeout_secs).toBe(emergencyBody.timeout_secs);
	});

	it('emergency DTMF handling is unchanged by the new field', async () => {
		const wo = emergencyWorkOrder();
		expect((await handleTechDtmfResponse({ commId: wo.commId, dtmfDigit: '1', currentRung: 1, workOrder: wo })).action)
			.toBe('bridge_customer');
		expect((await handleTechDtmfResponse({ commId: wo.commId, dtmfDigit: '2', currentRung: 1, workOrder: wo })).nextTech?.name)
			.toBe('Ann Backup');
	});
});

describe('the customer number must be dialable', () => {
  // The widget posts the number as typed. Telnyx rejects anything that is not E.164, so an
  // unnormalised customerNumber means the rep accepts the call and is then never connected —
  // which is exactly what the first live bridge produced.
  it('normalises a formatted number before it reaches the work order', async () => {
    const { formatPhoneForDialing } = await import('$lib/utils/phone');
    expect(formatPhoneForDialing('+1 (672) 238-7319')).toBe('+16722387319');
    expect(formatPhoneForDialing('(672) 238-7319')).toBe('+16722387319');
    expect(formatPhoneForDialing('672-238-7319')).toBe('+16722387319');
  });

  it('startCallbackBridge dials nobody when the number cannot be normalised', async () => {
    const { startCallbackBridge } = await import('./callback-dispatch');
    expect(
      await startCallbackBridge({
        companyId: 'co_1',
        customerPhone: '',
        message: 'x',
        preference: 'ASAP',
        rota: [JOE]
      })
    ).toBe(false);
  });
});

describe('rota feeds the ladder in the right order', () => {
	it('an on-duty rota becomes rungs 1..n in list order', () => {
		// 13:00Z = 09:00 in America/Toronto, the zone buildRepRota reads shifts in. Constructing
		// this with `new Date(y, m, d, 9)` would be the SERVER's 09:00, which is what the
		// 2026-08-17 production bug was made of.
		const mon9 = new Date('2026-08-17T13:00:00Z');
		const rota = buildRepRota({
			reps: [
				{ id: 'm1', name: 'Joe Sales', phone: '+15550000001', schedule: { Monday: { start: '08:00', end: '17:00' } } },
				{ id: 'm2', name: 'Ann Backup', phone: '+15550000002', schedule: { Monday: { start: '08:00', end: '17:00' } } }
			],
			at: mon9
		});
		expect(rota.map((r) => [r.name, r.rung])).toEqual([
			['Joe Sales', 1],
			['Ann Backup', 2]
		]);
	});

	it('an empty rota means startDialLadder dials nobody rather than throwing', async () => {
		const { startDialLadder } = await import('./emergency-dial');
		expect(await startDialLadder(callbackWorkOrder({ dialLadder: [] }), '+15550000000')).toBe(false);
	});
});
