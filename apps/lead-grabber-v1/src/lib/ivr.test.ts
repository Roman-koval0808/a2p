import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getActiveCallFlow, toAbsoluteAudioUrl } from './ivr';

describe('toAbsoluteAudioUrl', () => {
	it('returns null for null or undefined path', () => {
		expect(toAbsoluteAudioUrl(null, 'https://app.example.com')).toBe(null);
		expect(toAbsoluteAudioUrl(undefined, 'https://app.example.com')).toBe(null);
	});

	it('returns path as-is when already absolute (http)', () => {
		const url = 'https://cdn.example.com/greeting.mp3';
		expect(toAbsoluteAudioUrl(url, 'https://app.example.com')).toBe(url);
	});

	it('prepends base URL to relative path', () => {
		expect(toAbsoluteAudioUrl('/uploads/ivr/greeting.mp3', 'https://app.example.com')).toBe(
			'https://app.example.com/uploads/ivr/greeting.mp3'
		);
	});

	it('adds leading slash to path if missing', () => {
		expect(toAbsoluteAudioUrl('uploads/ivr/greeting.mp3', 'https://app.example.com')).toBe(
			'https://app.example.com/uploads/ivr/greeting.mp3'
		);
	});

	it('strips trailing slash from base URL', () => {
		expect(toAbsoluteAudioUrl('/greeting.mp3', 'https://app.example.com/')).toBe(
			'https://app.example.com/greeting.mp3'
		);
	});
});

describe('getActiveCallFlow', () => {
	const mockPrisma = {
		callFlow: { findMany: vi.fn() }
	} as Parameters<typeof getActiveCallFlow>[0];

	beforeEach(() => {
		vi.mocked(mockPrisma.callFlow.findMany).mockReset();
	});

	it('returns null when no flows exist', async () => {
		vi.mocked(mockPrisma.callFlow.findMany).mockResolvedValue([]);
		const result = await getActiveCallFlow(
			mockPrisma,
			'company-1',
			new Date('2026-01-30T14:00:00Z')
		);
		expect(result).toBe(null);
		expect(mockPrisma.callFlow.findMany).toHaveBeenCalledWith({
			where: { companyId: 'company-1' },
			include: { rules: true },
			orderBy: { updated: 'desc' }
		});
	});

	it('returns null when flow has no rule matching current day/time', async () => {
		// Friday 14:00 UTC; rule is Mon 09:00-17:00
		vi.mocked(mockPrisma.callFlow.findMany).mockResolvedValue([
			{
				id: 'flow-1',
				title: 'Main',
				greetingAudioUrl: '/g.mp3',
				companyId: 'company-1',
				queueHoldAudioUrl: null,
				allUnavailableAudioUrl: null,
				backupCellAudioUrl: null,
				failoverConfig: null,
				created: new Date(),
				updated: new Date(),
				rules: [
					{
						id: 'rule-1',
						callFlowId: 'flow-1',
						ruleTitle: 'Mon only',
						schedule: {
							Mon: { start: '09:00', end: '17:00' },
							Tue: null,
							Wed: null,
							Thu: null,
							Fri: null,
							Sat: null,
							Sun: null
						},
						promptsAudioUrl: '/p.mp3',
						keyPrompts: [],
						failoverCount: 2,
						failoverDelayMinutes: 2,
						failoverAudioUrl: null,
						hangupAudioUrl: null,
						leaveMessageOnHash: true,
						created: new Date(),
						updated: new Date()
					}
				]
			}
		]);
		const result = await getActiveCallFlow(
			mockPrisma,
			'company-1',
			new Date('2026-01-30T14:00:00Z')
		);
		expect(result).toBe(null);
	});

	it('returns flow and rule when schedule matches current day and time', async () => {
		// Friday 14:00 UTC = 14*60 = 840 minutes; rule Fri 09:00-17:00 = 540-1020
		vi.mocked(mockPrisma.callFlow.findMany).mockResolvedValue([
			{
				id: 'flow-1',
				title: 'Main',
				greetingAudioUrl: '/g.mp3',
				companyId: 'company-1',
				queueHoldAudioUrl: null,
				allUnavailableAudioUrl: null,
				backupCellAudioUrl: null,
				failoverConfig: null,
				created: new Date(),
				updated: new Date(),
				rules: [
					{
						id: 'rule-1',
						callFlowId: 'flow-1',
						ruleTitle: 'Fri 9-5',
						schedule: {
							Mon: null,
							Tue: null,
							Wed: null,
							Thu: null,
							Fri: { start: '09:00', end: '17:00' },
							Sat: null,
							Sun: null
						},
						promptsAudioUrl: '/p.mp3',
						keyPrompts: [{ key: '1', name: 'Sales', extension: '1001' }],
						failoverCount: 2,
						failoverDelayMinutes: 2,
						failoverAudioUrl: null,
						hangupAudioUrl: null,
						leaveMessageOnHash: true,
						created: new Date(),
						updated: new Date()
					}
				]
			}
		]);
		const result = await getActiveCallFlow(
			mockPrisma,
			'company-1',
			new Date('2026-01-30T14:00:00Z')
		);
		expect(result).not.toBe(null);
		expect(result!.flow.id).toBe('flow-1');
		expect(result!.flow.title).toBe('Main');
		expect(result!.flow.greetingAudioUrl).toBe('/g.mp3');
		expect(result!.rule.id).toBe('rule-1');
		expect(result!.rule.ruleTitle).toBe('Fri 9-5');
		expect(result!.rule.keyPrompts).toEqual([{ key: '1', name: 'Sales', extension: '1001' }]);
	});

	it('returns first matching rule when multiple flows/rules exist', async () => {
		// Order is by flow.updated desc, then we iterate; first match wins
		vi.mocked(mockPrisma.callFlow.findMany).mockResolvedValue([
			{
				id: 'flow-2',
				title: 'Secondary',
				greetingAudioUrl: null,
				companyId: 'company-1',
				queueHoldAudioUrl: null,
				allUnavailableAudioUrl: null,
				backupCellAudioUrl: null,
				failoverConfig: null,
				created: new Date(),
				updated: new Date(),
				rules: [
					{
						id: 'rule-2',
						callFlowId: 'flow-2',
						ruleTitle: 'Fri',
						schedule: {
							Mon: null,
							Tue: null,
							Wed: null,
							Thu: null,
							Fri: { start: '00:00', end: '23:59' },
							Sat: null,
							Sun: null
						},
						promptsAudioUrl: null,
						keyPrompts: [],
						failoverCount: 2,
						failoverDelayMinutes: 2,
						failoverAudioUrl: null,
						hangupAudioUrl: null,
						leaveMessageOnHash: true,
						created: new Date(),
						updated: new Date()
					}
				]
			},
			{
				id: 'flow-1',
				title: 'Primary',
				greetingAudioUrl: '/g.mp3',
				companyId: 'company-1',
				queueHoldAudioUrl: null,
				allUnavailableAudioUrl: null,
				backupCellAudioUrl: null,
				failoverConfig: null,
				created: new Date(),
				updated: new Date(),
				rules: [
					{
						id: 'rule-1',
						callFlowId: 'flow-1',
						ruleTitle: 'Fri',
						schedule: {
							Mon: null,
							Tue: null,
							Wed: null,
							Thu: null,
							Fri: { start: '09:00', end: '17:00' },
							Sat: null,
							Sun: null
						},
						promptsAudioUrl: '/p.mp3',
						keyPrompts: [],
						failoverCount: 2,
						failoverDelayMinutes: 2,
						failoverAudioUrl: null,
						hangupAudioUrl: null,
						leaveMessageOnHash: true,
						created: new Date(),
						updated: new Date()
					}
				]
			}
		]);
		const result = await getActiveCallFlow(
			mockPrisma,
			'company-1',
			new Date('2026-01-30T12:00:00Z')
		);
		expect(result).not.toBe(null);
		// First flow in array (flow-2, most recently updated) is checked first; its rule matches
		expect(result!.flow.id).toBe('flow-2');
		expect(result!.rule.id).toBe('rule-2');
	});
});
