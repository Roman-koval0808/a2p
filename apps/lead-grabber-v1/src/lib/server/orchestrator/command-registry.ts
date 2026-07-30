import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';

export interface CommandInstruction {
	command: string;
	args: Record<string, unknown>;
}

export interface CommandContext {
	companyId: string;
	customerId?: string;
	customerPhone?: string;
	customerEmail?: string;
	customerName?: string;
	commLogId?: string;
	trigger?: string;
}

export type CommandHandler = (ctx: CommandContext, args: Record<string, unknown>) => Promise<void>;

type CommandRegistry = Map<string, CommandHandler>;

const registry: CommandRegistry = new Map();

export function registerCommand(name: string, handler: CommandHandler): void {
	registry.set(name, handler);
}

export function getCommand(name: string): CommandHandler | undefined {
	return registry.get(name);
}

export function hasCommand(name: string): boolean {
	return registry.has(name);
}

export function listCommands(): string[] {
	return Array.from(registry.keys());
}

export async function executeInstructions(
	ctx: CommandContext,
	instructions: CommandInstruction[]
): Promise<void> {
	for (const instr of instructions) {
		const handler = registry.get(instr.command);
		if (!handler) {
			console.warn(`[CommandRegistry] Unknown command: ${instr.command}`);
			continue;
		}
		try {
			await handler(ctx, instr.args);
		} catch (err) {
			console.error(`[CommandRegistry] Command "${instr.command}" failed:`, err);
		}
	}
}

// --- Built-in commands ---

registerCommand('send_sms', async (ctx, args) => {
	const to = (args.to as string) || ctx.customerPhone;
	const body = args.body as string;
	if (!to || !body) {
		console.warn('[CommandRegistry] send_sms: missing to or body');
		return;
	}
	await logCommunication({
		type: 'sms',
		direction: 'outbound',
		status: 'pending',
		source: args.from as string || ctx.companyId,
		destination: to,
		company_id: ctx.companyId,
		customer_id: ctx.customerId,
		summary: body.slice(0, 100),
		content: body,
		metadata: { command: 'send_sms', trigger_comm_id: ctx.commLogId }
	});
});

registerCommand('send_email', async (ctx, args) => {
	const to = (args.to as string) || ctx.customerEmail;
	const subject = args.subject as string;
	const body = args.body as string;
	if (!to || !body) {
		console.warn('[CommandRegistry] send_email: missing to or body');
		return;
	}
	await logCommunication({
		type: 'email',
		direction: 'outbound',
		status: 'pending',
		source: args.from as string || ctx.companyId,
		destination: to,
		company_id: ctx.companyId,
		customer_id: ctx.customerId,
		summary: subject || body.slice(0, 100),
		content: body,
		metadata: { command: 'send_email', trigger_comm_id: ctx.commLogId }
	});
});

registerCommand('create_task', async (ctx, args) => {
	const description = args.description as string;
	if (!description) {
		console.warn('[CommandRegistry] create_task: missing description');
		return;
	}
	await prisma.commTask.create({
		data: {
			commId: ctx.commLogId || '',
			description,
			ownerUserId: args.owner_user_id as string || 'system',
			due: args.due ? new Date(args.due as string) : new Date(Date.now() + 86400000),
			category: (args.category as 'customer_promise' | 'internal_followup') || 'internal_followup'
		}
	});
});

registerCommand('set_appointment', async (ctx, args) => {
	const when = args.when as string;
	const notes = args.notes as string;
	if (!when) {
		console.warn('[CommandRegistry] set_appointment: missing when');
		return;
	}
	await prisma.appointment.create({
		data: {
			companyId: ctx.companyId,
			contactId: ctx.customerId,
			startTime: new Date(when),
			endTime: args.end ? new Date(args.end as string) : null,
			status: 'booked',
			source: 'orchestrator_command'
		}
	});
});

registerCommand('update_profile', async (ctx, args) => {
	if (!ctx.customerPhone && !ctx.customerEmail) {
		console.warn('[CommandRegistry] update_profile: no identifier to find profile');
		return;
	}
	const where = ctx.customerPhone
		? { phoneNumber: ctx.customerPhone, companyId: ctx.companyId }
		: { email: ctx.customerEmail, companyId: ctx.companyId };
	const profile = await prisma.pipelineCustomerProfile.findFirst({ where });
	if (!profile) {
		console.warn('[CommandRegistry] update_profile: profile not found');
		return;
	}
	const updateData: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(args)) {
		if (['firstName', 'lastName', 'displayName', 'email', 'phoneNumber', 'status'].includes(key)) {
			updateData[key] = val;
		}
	}
	if (Object.keys(updateData).length > 0) {
		await prisma.pipelineCustomerProfile.update({
			where: { id: profile.id },
			data: updateData
		});
	}
});

registerCommand('update_engagement_score', async (ctx, args) => {
	const delta = (args.delta as number) || 0;
	if (!ctx.customerId || delta === 0) return;
	await prisma.contact.update({
		where: { id: ctx.customerId },
		data: { engagementScore: { increment: delta } }
	});
});
