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
	/**
	 * Live Telnyx call leg, when the orchestrator is acting on a call that is still up. Required by
	 * every call-control command — without it they no-op rather than guess at a leg.
	 */
	callControlId?: string;
	/** CommContainer id (the conversation), distinct from commLogId (a single message). */
	commContainerId?: string;
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

/**
 * CommTask.commId is a foreign key to CommContainer — NOT to CommunicationLog. Passing a comm log
 * id here silently violated the FK on every task the AI extracted, so the id has to be resolved to
 * a real container: an explicit one, else this customer's open conversation, else a new one.
 */
async function resolveContainerId(ctx: CommandContext): Promise<string | null> {
	if (ctx.commContainerId) return ctx.commContainerId;

	const existing = await prisma.commContainer.findFirst({
		where: {
			companyId: ctx.companyId,
			state: { not: 'closed' },
			...(ctx.customerId ? { contactId: ctx.customerId } : {})
		},
		orderBy: { lastActivityAt: 'desc' },
		select: { id: true }
	});
	if (existing) return existing.id;

	// Nothing open to attach to. A task with nowhere to live is a task nobody sees, so open a
	// container for it rather than dropping the commitment.
	if (!ctx.customerId) {
		console.warn('[CommandRegistry] No container and no customer to open one for');
		return null;
	}
	const { createContainerAtIntake } = await import('$lib/server/container/container-service');
	const { container } = await createContainerAtIntake(prisma, {
		companyId: ctx.companyId,
		contactId: ctx.customerId,
		threadType: 'general'
	});
	return container?.id ?? null;
}

registerCommand('create_task', async (ctx, args) => {
	const description = args.description as string;
	if (!description) {
		console.warn('[CommandRegistry] create_task: missing description');
		return;
	}
	const commId = (args.comm_id as string) || (await resolveContainerId(ctx));
	if (!commId) {
		console.warn(`[CommandRegistry] create_task: no container for "${description}" — skipped`);
		return;
	}
	await prisma.commTask.create({
		data: {
			commId,
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

// --- Call control ---
//
// These let the orchestrator act on a call that is still in progress, instead of only messaging
// after the fact. They are thin wrappers over Telnyx Call Control so that adding a new call
// behaviour is one registerCommand() rather than another branch inside the webhook handler.
//
// All of them need ctx.callControlId (or an explicit call_control_id arg) — the caller is
// responsible for threading the live leg through. Without it they log and no-op: silently
// picking some other call would be worse than doing nothing.

/** Resolve the leg to act on: explicit arg wins, else the context's live call. */
function resolveLeg(ctx: CommandContext, args: Record<string, unknown>, command: string): string | null {
	const leg = (args.call_control_id as string) || ctx.callControlId;
	if (!leg) {
		console.warn(`[CommandRegistry] ${command}: no call_control_id — not on a live call`);
		return null;
	}
	return leg;
}

/** Note the action on the originating comm log so the call's history shows what the AI did. */
async function noteCallAction(ctx: CommandContext, action: string, detail: Record<string, unknown>) {
	if (!ctx.commLogId) return;
	try {
		const log = await prisma.communicationLog.findUnique({
			where: { id: ctx.commLogId },
			select: { metadata: true }
		});
		const meta = ((log?.metadata as Record<string, unknown>) || {}) as Record<string, unknown>;
		const actions = Array.isArray(meta.call_actions) ? (meta.call_actions as unknown[]) : [];
		actions.push({ action, at: new Date().toISOString(), ...detail });
		await prisma.communicationLog.update({
			where: { id: ctx.commLogId },
			data: { metadata: { ...meta, call_actions: actions } as any }
		});
	} catch (err) {
		console.error(`[CommandRegistry] Failed to note call action ${action}:`, err);
	}
}

/** Send the live call to another number (rep, department, external line). */
registerCommand('forward_call', async (ctx, args) => {
	const leg = resolveLeg(ctx, args, 'forward_call');
	if (!leg) return;
	const to = args.to as string;
	if (!to) {
		console.warn('[CommandRegistry] forward_call: missing to');
		return;
	}
	const { callControl } = await import('$lib/server/telnyx-bridge');
	await callControl(leg, 'transfer', {
		to,
		...(args.from ? { from: args.from as string } : {})
	});
	console.log(`[CommandRegistry] forward_call: ${leg} → ${to}`);
	await noteCallAction(ctx, 'forward_call', { to });
});

/**
 * Join this leg to another leg that is already up (customer ↔ technician). Use forward_call to
 * dial a number that isn't on a call yet; bridge_call is for connecting two existing legs.
 */
registerCommand('bridge_call', async (ctx, args) => {
	const leg = resolveLeg(ctx, args, 'bridge_call');
	if (!leg) return;
	const other = args.to_call_control_id as string;
	if (!other) {
		console.warn('[CommandRegistry] bridge_call: missing to_call_control_id');
		return;
	}
	const { callControl } = await import('$lib/server/telnyx-bridge');
	await callControl(leg, 'bridge', { call_control_id: other });
	console.log(`[CommandRegistry] bridge_call: ${leg} ↔ ${other}`);
	await noteCallAction(ctx, 'bridge_call', { bridged_to: other });
});

/**
 * Speak to one leg only — coaching the rep before they're bridged, so the customer doesn't hear
 * it. Telnyx speaks on the leg you address, so the caller must pass the rep's leg, not the
 * customer's.
 */
registerCommand('whisper', async (ctx, args) => {
	const leg = resolveLeg(ctx, args, 'whisper');
	if (!leg) return;
	const message = (args.message as string) || (args.payload as string);
	if (!message) {
		console.warn('[CommandRegistry] whisper: missing message');
		return;
	}
	const { callControl } = await import('$lib/server/telnyx-bridge');
	await callControl(leg, 'speak', {
		payload: message,
		voice: (args.voice as string) || 'female',
		language: (args.language as string) || 'en-US'
	});
	console.log(`[CommandRegistry] whisper on ${leg}: ${message.slice(0, 60)}`);
	await noteCallAction(ctx, 'whisper', { message });
});

/** Speak a message to the call (both parties, unlike whisper). */
registerCommand('play_message', async (ctx, args) => {
	const leg = resolveLeg(ctx, args, 'play_message');
	if (!leg) return;
	const { callControl } = await import('$lib/server/telnyx-bridge');

	if (args.audio_url) {
		await callControl(leg, 'playback_start', { audio_url: args.audio_url as string });
		await noteCallAction(ctx, 'play_message', { audio_url: args.audio_url });
		return;
	}

	const message = args.message as string;
	if (!message) {
		console.warn('[CommandRegistry] play_message: missing message or audio_url');
		return;
	}
	await callControl(leg, 'speak', {
		payload: message,
		voice: (args.voice as string) || 'female',
		language: (args.language as string) || 'en-US'
	});
	await noteCallAction(ctx, 'play_message', { message });
});

registerCommand('start_recording', async (ctx, args) => {
	const leg = resolveLeg(ctx, args, 'start_recording');
	if (!leg) return;
	const { callControl } = await import('$lib/server/telnyx-bridge');
	await callControl(leg, 'record_start', {
		format: (args.format as string) || 'mp3',
		// Dual channel keeps the two parties on separate tracks, which is what the diarized
		// transcript in transcription.ts expects.
		channels: (args.channels as string) || 'dual'
	});
	console.log(`[CommandRegistry] start_recording on ${leg}`);
	await noteCallAction(ctx, 'start_recording', {});
});

registerCommand('stop_recording', async (ctx, args) => {
	const leg = resolveLeg(ctx, args, 'stop_recording');
	if (!leg) return;
	const { callControl } = await import('$lib/server/telnyx-bridge');
	await callControl(leg, 'record_stop', {});
	console.log(`[CommandRegistry] stop_recording on ${leg}`);
	await noteCallAction(ctx, 'stop_recording', {});
});

registerCommand('hangup_call', async (ctx, args) => {
	const leg = resolveLeg(ctx, args, 'hangup_call');
	if (!leg) return;
	const { callControl } = await import('$lib/server/telnyx-bridge');
	await callControl(leg, 'hangup', {});
	console.log(`[CommandRegistry] hangup_call on ${leg}`);
	await noteCallAction(ctx, 'hangup_call', { reason: args.reason || null });
});
