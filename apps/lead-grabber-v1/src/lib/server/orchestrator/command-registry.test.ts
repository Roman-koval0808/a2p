import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerCommand, getCommand, hasCommand, listCommands, executeInstructions } from './command-registry';
import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';

vi.mock('$lib/db', () => ({
	prisma: {
		commTask: { create: vi.fn().mockResolvedValue({ id: 'task_1' }) },
		appointment: { create: vi.fn().mockResolvedValue({ id: 'apt_1' }) },
		pipelineCustomerProfile: {
			findFirst: vi.fn().mockResolvedValue({ id: 'prof_1', attributes: {} }),
			update: vi.fn().mockResolvedValue({})
		},
		contact: { update: vi.fn().mockResolvedValue({}) }
	}
}));

vi.mock('$lib/utils/communication-log', () => ({
	logCommunication: vi.fn().mockResolvedValue({ id: 'log_1' })
}));

const ctx = {
	companyId: 'comp_1',
	customerId: 'cust_1',
	customerPhone: '+15551234567',
	customerEmail: 'test@example.com',
	customerName: 'Test User',
	commLogId: 'comm_1',
	trigger: 'test'
};

describe('command-registry', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('registry management', () => {
		it('starts empty', () => {
			expect(listCommands().length).toBeGreaterThanOrEqual(6);
		});

		it('register and lookup a custom command', () => {
			const handler = vi.fn();
			registerCommand('custom_test', handler);
			expect(hasCommand('custom_test')).toBe(true);
			expect(getCommand('custom_test')).toBe(handler);
		});

		it('returns undefined for unknown commands', () => {
			expect(hasCommand('nonexistent')).toBe(false);
			expect(getCommand('nonexistent')).toBeUndefined();
		});

		it('overwrites existing command on re-register', () => {
			const h1 = vi.fn();
			const h2 = vi.fn();
			registerCommand('overwrite_me', h1);
			registerCommand('overwrite_me', h2);
			expect(getCommand('overwrite_me')).toBe(h2);
		});
	});

	describe('executeInstructions', () => {
		it('skips unknown commands gracefully', async () => {
			await expect(
				executeInstructions(ctx, [{ command: 'does_not_exist', args: {} }])
			).resolves.toBeUndefined();
		});

		it('handles partial failure without stopping subsequent commands', async () => {
			const errorHandler = vi.fn().mockRejectedValue(new Error('boom'));
			const successHandler = vi.fn().mockResolvedValue(undefined);
			registerCommand('failing_cmd', errorHandler);
			registerCommand('good_cmd', successHandler);

			await executeInstructions(ctx, [
				{ command: 'failing_cmd', args: {} },
				{ command: 'good_cmd', args: {} }
			]);

			expect(errorHandler).toHaveBeenCalledTimes(1);
			expect(successHandler).toHaveBeenCalledTimes(1);
		});
	});

	describe('send_sms', () => {
		it('logs communication with sms type', async () => {
			await executeInstructions(ctx, [{ command: 'send_sms', args: { to: '+15551234567', body: 'Hello!' } }]);
			expect(logCommunication).toHaveBeenCalledWith(expect.objectContaining({
				type: 'sms', direction: 'outbound', content: 'Hello!', destination: '+15551234567'
			}));
		});

		it('falls back to ctx.customerPhone when to is missing', async () => {
			await executeInstructions(ctx, [{ command: 'send_sms', args: { body: 'Hi' } }]);
			expect(logCommunication).toHaveBeenCalledWith(expect.objectContaining({
				destination: ctx.customerPhone
			}));
		});

		it('skips when body is missing', async () => {
			await executeInstructions(ctx, [{ command: 'send_sms', args: { to: '+15551234567' } }]);
			expect(logCommunication).not.toHaveBeenCalled();
		});
	});

	describe('send_email', () => {
		it('logs communication with email type', async () => {
			await executeInstructions(ctx, [{
				command: 'send_email',
				args: { to: 'a@b.com', subject: 'Hi', body: 'Hello email' }
			}]);
			expect(logCommunication).toHaveBeenCalledWith(expect.objectContaining({
				type: 'email', content: 'Hello email', summary: 'Hi'
			}));
		});

		it('falls back to ctx.customerEmail', async () => {
			await executeInstructions(ctx, [{ command: 'send_email', args: { body: 'Hi', subject: 'S' } }]);
			expect(logCommunication).toHaveBeenCalledWith(expect.objectContaining({
				destination: ctx.customerEmail
			}));
		});
	});

	describe('create_task', () => {
		it('creates a commTask', async () => {
			await executeInstructions(ctx, [{
				command: 'create_task',
				args: { description: 'Follow up on quote', category: 'internal_followup' }
			}]);
			expect(prisma.commTask.create).toHaveBeenCalledWith(expect.objectContaining({
				data: expect.objectContaining({ description: 'Follow up on quote' })
			}));
		});

		it('skips when description is missing', async () => {
			await executeInstructions(ctx, [{ command: 'create_task', args: {} }]);
			expect(prisma.commTask.create).not.toHaveBeenCalled();
		});

		it('defaults due to tomorrow when not specified', async () => {
			await executeInstructions(ctx, [{
				command: 'create_task', args: { description: 'Test task' }
			}]);
			const call = (prisma.commTask.create as any).mock.calls[0][0];
			const due = new Date(call.data.due);
			const tomorrow = new Date(Date.now() + 86400000);
			expect(Math.abs(due.getTime() - tomorrow.getTime())).toBeLessThan(2000);
		});

		it('accepts explicit due date', async () => {
			const future = new Date('2026-12-25').toISOString();
			await executeInstructions(ctx, [{
				command: 'create_task', args: { description: 'Xmas task', due: future }
			}]);
			const call = (prisma.commTask.create as any).mock.calls[0][0];
			expect(call.data.due.toISOString()).toBe(future);
		});
	});

	describe('set_appointment', () => {
		it('creates an appointment record', async () => {
			await executeInstructions(ctx, [{
				command: 'set_appointment',
				args: { when: '2026-09-15T10:00:00Z', notes: 'Water heater install' }
			}]);
			expect(prisma.appointment.create).toHaveBeenCalledWith(expect.objectContaining({
				data: expect.objectContaining({
					companyId: 'comp_1', startTime: expect.any(Date)
				})
			}));
		});

		it('skips when when is missing', async () => {
			await executeInstructions(ctx, [{ command: 'set_appointment', args: {} }]);
			expect(prisma.appointment.create).not.toHaveBeenCalled();
		});

		it('sets endTime when provided', async () => {
			await executeInstructions(ctx, [{
				command: 'set_appointment',
				args: { when: '2026-09-15T10:00:00Z', end: '2026-09-15T11:00:00Z' }
			}]);
			const call = (prisma.appointment.create as any).mock.calls[0][0];
			expect(call.data.endTime).toBeInstanceOf(Date);
			expect(call.data.endTime.toISOString()).toBe('2026-09-15T11:00:00.000Z');
		});
	});

	describe('update_profile', () => {
		it('updates profile fields when profile exists', async () => {
			await executeInstructions(ctx, [{
				command: 'update_profile',
				args: { firstName: 'NewName', status: 'client' }
			}]);
			expect(prisma.pipelineCustomerProfile.update).toHaveBeenCalledWith({
				where: { id: 'prof_1' },
				data: { firstName: 'NewName', status: 'client' }
			});
		});

		it('ignores unknown fields', async () => {
			await executeInstructions(ctx, [{
				command: 'update_profile',
				args: { firstName: 'Test', randomField: 'should be ignored' }
			}]);
			const call = (prisma.pipelineCustomerProfile.update as any).mock.calls[0][0];
			expect(call.data.randomField).toBeUndefined();
			expect(call.data.firstName).toBe('Test');
		});

		it('skips update when no valid fields provided', async () => {
			await executeInstructions(ctx, [{
				command: 'update_profile',
				args: { random: 'value' }
			}]);
			expect(prisma.pipelineCustomerProfile.update).not.toHaveBeenCalled();
		});

		it('skips when neither phone nor email in context', async () => {
			await executeInstructions(
				{ companyId: 'comp_1', customerId: 'c1' },
				[{ command: 'update_profile', args: { firstName: 'N' } }]
			);
			expect(prisma.pipelineCustomerProfile.findFirst).not.toHaveBeenCalled();
		});

		it('skips when profile not found', async () => {
			(prisma.pipelineCustomerProfile.findFirst as any).mockResolvedValueOnce(null);
			await executeInstructions(ctx, [{
				command: 'update_profile', args: { firstName: 'N' }
			}]);
			expect(prisma.pipelineCustomerProfile.update).not.toHaveBeenCalled();
		});
	});

	describe('update_engagement_score', () => {
		it('increments engagement score', async () => {
			await executeInstructions(ctx, [{
				command: 'update_engagement_score',
				args: { delta: 10 }
			}]);
			expect(prisma.contact.update).toHaveBeenCalledWith({
				where: { id: 'cust_1' },
				data: { engagementScore: { increment: 10 } }
			});
		});

		it('skips when delta is 0', async () => {
			await executeInstructions(ctx, [{
				command: 'update_engagement_score', args: { delta: 0 }
			}]);
			expect(prisma.contact.update).not.toHaveBeenCalled();
		});

		it('skips when no customerId', async () => {
			await executeInstructions(
				{ companyId: 'comp_1' },
				[{ command: 'update_engagement_score', args: { delta: 5 } }]
			);
			expect(prisma.contact.update).not.toHaveBeenCalled();
		});
	});
});
