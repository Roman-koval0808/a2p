import { prisma } from '$lib/db';
import type {
	ThreadType,
	ContainerLifecycle,
	ContainerState,
	ContainerResolution,
	EntryDirection,
	EntryChannel,
	PartyType,
	IdentityMethod,
	TaskCategory,
	CommTaskStatus,
	DraftType,
	ApprovalState
} from '@prisma/client';
import { EMERGENCY_KEYWORDS } from '$lib/server/ai/emergency';

export function classifyThreadType(input: { ivrOption?: number; keywordHit?: boolean; text?: string }): ThreadType {
	const textLower = (input.text || '').toLowerCase();
	const hasKeyword =
		input.keywordHit || EMERGENCY_KEYWORDS.some((kw) => textLower.includes(kw.toLowerCase()));

	if (hasKeyword || (input.ivrOption === 3 && hasKeyword)) {
		return 'emergency';
	}
	if (input.ivrOption === 2) {
		return 'sales';
	}
	if (input.ivrOption === 3) {
		return 'support';
	}
	return 'general';
}

export function joinWindowSecondsFor(t: ThreadType): number {
	switch (t) {
		case 'emergency':
			return 2 * 3600; // 2 hours
		case 'support':
			return 3 * 86400; // 3 days
		case 'sales':
			return 14 * 86400; // 14 days
		case 'general':
		default:
			return 24 * 3600; // 24 hours
	}
}

export function inactivityTimeoutSecondsFor(t: ThreadType): number {
	switch (t) {
		case 'emergency':
			return 4 * 3600; // 4 hours
		case 'support':
			return 24 * 3600; // 24 hours
		case 'sales':
			return 7 * 86400; // 7 days
		case 'general':
		default:
			return 48 * 3600; // 48 hours
	}
}

export function shouldSuppressActions(args: {
	incomingType: ThreadType;
	openContainers: Array<{
		id: string;
		threadType: ThreadType;
		openedAt: Date;
		joinWindowSeconds: number;
		state: ContainerState;
	}>;
	now?: Date;
}): { suppress: boolean; againstCommId?: string } {
	const now = args.now || new Date();

	for (const candidate of args.openContainers) {
		if (candidate.state === 'closed') continue;
		if (candidate.threadType !== args.incomingType) continue; // Only suppress against SAME threadType (§1.1.4 / test 3-8)

		const elapsedSeconds = (now.getTime() - new Date(candidate.openedAt).getTime()) / 1000;
		if (elapsedSeconds <= candidate.joinWindowSeconds) {
			return { suppress: true, againstCommId: candidate.id };
		}
	}

	return { suppress: false };
}

export async function allocateCommRef(tx?: any): Promise<string> {
	const db = tx || prisma;
	try {
		const result: Array<{ nextval: bigint | number }> = await db.$queryRawUnsafe(
			`SELECT nextval('comm_ref_seq') as nextval`
		);
		if (result && result.length > 0 && result[0].nextval) {
			return `#${result[0].nextval}`;
		}
	} catch (e) {
		// Fallback
	}
	const uniqueRand = Math.floor(1000 + Math.random() * 9000);
	return `#${4000 + uniqueRand}`;
}

export async function createContainerAtIntake(
	tx: any,
	input: {
		companyId: string;
		customerProfileId?: string | null;
		contactId?: string | null;
		threadType: ThreadType;
		subject?: string;
		now?: Date;
	}
): Promise<{
	container: any;
	actionsSuppressed: boolean;
	suppressedAgainstCommId?: string;
}> {
	const db = tx || prisma;
	const now = input.now || new Date();

	let openContainers: any[] = [];
	if (input.customerProfileId) {
		openContainers = await db.commContainer.findMany({
			where: {
				companyId: input.companyId,
				customerProfileId: input.customerProfileId,
				state: { not: 'closed' }
			}
		});
	}

	const suppression = shouldSuppressActions({
		incomingType: input.threadType,
		openContainers,
		now
	});

	const joinWindowSeconds = joinWindowSecondsFor(input.threadType);
	const inactivityTimeoutSeconds = inactivityTimeoutSecondsFor(input.threadType);
	let commRef = await allocateCommRef(db);
	let container;
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			container = await db.commContainer.create({
				data: {
					commRef,
					companyId: input.companyId,
					customerProfileId: input.customerProfileId || null,
					contactId: input.contactId || null,
					subject: input.subject || null,
					threadType: input.threadType,
					lifecycle: 'provisional',
					state: 'open',
					actionsSuppressed: suppression.suppress,
					joinWindowSeconds,
					inactivityTimeoutSeconds,
					openedAt: now,
					lastActivityAt: now
				}
			});
			break;
		} catch (err: any) {
			if (err?.code === 'P2002' && attempt < 4) {
				commRef = `#${4000 + Math.floor(1000 + Math.random() * 900000)}`;
				continue;
			}
			throw err;
		}
	}

	return {
		container,
		actionsSuppressed: suppression.suppress,
		suppressedAgainstCommId: suppression.againstCommId
	};
}

export async function resolveRef(
	companyId: string,
	ref: string,
	tx?: any
): Promise<{ container: any; redirectedFrom?: string; note?: string } | null> {
	const db = tx || prisma;
	const formattedRef = ref.startsWith('#') ? ref : `#${ref}`;

	const direct = await db.commContainer.findFirst({
		where: { companyId, commRef: formattedRef }
	});
	if (direct) {
		return { container: direct };
	}

	const alias = await db.commRefAlias.findFirst({
		where: { ref: formattedRef },
		include: { target: true }
	});
	if (alias && alias.target && alias.target.companyId === companyId) {
		return {
			container: alias.target,
			redirectedFrom: formattedRef,
			note: alias.note || undefined
		};
	}

	return null;
}

export async function reviewMerge(
	tx: any,
	input: {
		loserCommId: string;
		survivorCommId: string;
		actor?: string;
		reason?: string;
		confidence?: number;
	}
): Promise<{ survivorId: string; loserId: string }> {
	const db = tx || prisma;
	let loser = await db.commContainer.findUnique({ where: { id: input.loserCommId } });
	let survivor = await db.commContainer.findUnique({ where: { id: input.survivorCommId } });

	if (!loser || !survivor) {
		throw new Error('Both loserCommId and survivorCommId must exist for merge');
	}

	// Spec §1.1.1: Keep the older ref as the survivor
	const loserRefNum = parseInt(loser.commRef.replace('#', ''), 10) || 999999;
	const survivorRefNum = parseInt(survivor.commRef.replace('#', ''), 10) || 999999;

	if (loserRefNum < survivorRefNum) {
		// Swap so older ref is survivor
		const temp = loser;
		loser = survivor;
		survivor = temp;
	}

	const loserId = loser.id;
	const survivorId = survivor.id;

	// Repoint entries
	const entries = await db.commEntry.findMany({ where: { commId: loserId } });
	for (const e of entries) {
		await db.commEntry.update({ where: { id: e.id }, data: { commId: survivorId } });
		await db.threadReassignmentLog.create({
			data: {
				recordId: e.id,
				recordType: 'entry',
				fromCommId: loserId,
				toCommId: survivorId,
				actor: input.actor,
				reason: input.reason || 'review_merge'
			}
		});
	}

	// Repoint tasks
	const tasks = await db.commTask.findMany({ where: { commId: loserId } });
	for (const t of tasks) {
		await db.commTask.update({ where: { id: t.id }, data: { commId: survivorId } });
		await db.threadReassignmentLog.create({
			data: {
				recordId: t.id,
				recordType: 'task',
				fromCommId: loserId,
				toCommId: survivorId,
				actor: input.actor,
				reason: input.reason || 'review_merge'
			}
		});
	}

	// Repoint holds
	const holds = await db.commHold.findMany({ where: { commId: loserId } });
	for (const h of holds) {
		await db.commHold.update({ where: { id: h.id }, data: { commId: survivorId } });
		await db.threadReassignmentLog.create({
			data: {
				recordId: h.id,
				recordType: 'hold',
				fromCommId: loserId,
				toCommId: survivorId,
				actor: input.actor,
				reason: input.reason || 'review_merge'
			}
		});
	}

	// Repoint approvals
	const approvals = await db.commApproval.findMany({ where: { commId: loserId } });
	for (const a of approvals) {
		await db.commApproval.update({ where: { id: a.id }, data: { commId: survivorId } });
		await db.threadReassignmentLog.create({
			data: {
				recordId: a.id,
				recordType: 'approval',
				fromCommId: loserId,
				toCommId: survivorId,
				actor: input.actor,
				reason: input.reason || 'review_merge'
			}
		});
	}

	// Repoint timers
	const timers = await db.pipelineTimer.findMany({ where: { commId: loserId } });
	for (const tm of timers) {
		await db.pipelineTimer.update({ where: { id: tm.id }, data: { commId: survivorId } });
		await db.threadReassignmentLog.create({
			data: {
				recordId: tm.id,
				recordType: 'timer',
				fromCommId: loserId,
				toCommId: survivorId,
				actor: input.actor,
				reason: input.reason || 'review_merge'
			}
		});
	}

	// Mark loser as merged
	await db.commContainer.update({
		where: { id: loserId },
		data: {
			lifecycle: 'merged',
			state: 'closed',
			mergedInto: survivorId
		}
	});

	// Promote survivor to confirmed if provisional
	await db.commContainer.update({
		where: { id: survivorId },
		data: {
			lifecycle: 'confirmed'
		}
	});

	// Create alias for losing ref
	await db.commRefAlias.create({
		data: {
			ref: loser.commRef,
			targetCommId: survivorId,
			note: `Merged into ${survivor.commRef} on ${new Date().toISOString().split('T')[0]}`
		}
	});

	return { survivorId, loserId };
}

export async function splitEntries(
	tx: any,
	input: {
		entryIds: string[];
		fromCommId: string;
		toCommId: string;
		actor?: string;
		reason?: string;
	}
) {
	const db = tx || prisma;
	for (const entryId of input.entryIds) {
		await db.commEntry.update({
			where: { id: entryId },
			data: { commId: input.toCommId }
		});
		await db.threadReassignmentLog.create({
			data: {
				recordId: entryId,
				recordType: 'entry',
				fromCommId: input.fromCommId,
				toCommId: input.toCommId,
				actor: input.actor,
				reason: input.reason || 'split_entries'
			}
		});
	}
}

export async function reassign(
	tx: any,
	input: {
		recordId: string;
		recordType: string;
		fromCommId?: string;
		toCommId: string;
		actor?: string;
		reason?: string;
	}
) {
	const db = tx || prisma;
	switch (input.recordType) {
		case 'entry':
			await db.commEntry.update({ where: { id: input.recordId }, data: { commId: input.toCommId } });
			break;
		case 'task':
			await db.commTask.update({ where: { id: input.recordId }, data: { commId: input.toCommId } });
			break;
		case 'hold':
			await db.commHold.update({ where: { id: input.recordId }, data: { commId: input.toCommId } });
			break;
		case 'approval':
			await db.commApproval.update({ where: { id: input.recordId }, data: { commId: input.toCommId } });
			break;
		case 'timer':
			await db.pipelineTimer.update({ where: { id: input.recordId }, data: { commId: input.toCommId } });
			break;
	}

	await db.threadReassignmentLog.create({
		data: {
			recordId: input.recordId,
			recordType: input.recordType,
			fromCommId: input.fromCommId || null,
			toCommId: input.toCommId,
			actor: input.actor,
			reason: input.reason || 'reassign'
		}
	});
}

export async function getContainerView(commId: string, tx?: any) {
	const db = tx || prisma;
	const container = await db.commContainer.findUnique({
		where: { id: commId },
		include: {
			customerProfile: true,
			contact: true
		}
	});
	if (!container) return null;

	const entries = await db.commEntry.findMany({ where: { commId }, orderBy: { occurredAt: 'asc' } });
	const tasks = await db.commTask.findMany({ where: { commId }, orderBy: { createdAt: 'asc' } });
	const holds = await db.commHold.findMany({ where: { commId }, orderBy: { createdAt: 'asc' } });
	const approvals = await db.commApproval.findMany({ where: { commId }, orderBy: { createdAt: 'asc' } });
	const timers = await db.pipelineTimer.findMany({ where: { commId }, orderBy: { fireAt: 'asc' } });

	return {
		container,
		entries,
		tasks,
		holds,
		approvals,
		timers,
		state: container.state,
		resolution: container.resolution
	};
}

// ==========================================
// ORPHAN-GUARD CREATION WRAPPERS (I-11)
// ==========================================

export async function createEntry(
	tx: any,
	data: {
		commId: string;
		customerProfileId?: string | null;
		direction: EntryDirection;
		channel: EntryChannel;
		fromParty: string;
		toParty: string;
		fromPartyType: PartyType;
		toPartyType: PartyType;
		occurredAt?: Date;
		recordingUrl?: string | null;
		transcript?: string | null;
		analysisJson?: any;
		dedupSuppressed?: boolean;
		identityConfidence?: number | null;
		identityMethod?: IdentityMethod;
	}
) {
	if (!data.commId) throw new Error('Orphan guard violation: commId is required (I-11)');
	const db = tx || prisma;
	return await db.commEntry.create({ data });
}

export async function createTask(
	tx: any,
	data: {
		commId: string;
		sourceEntryId?: string | null;
		description: string;
		ownerUserId: string;
		due: Date;
		category: TaskCategory;
		confidence?: number;
		status?: CommTaskStatus;
	}
) {
	if (!data.commId) throw new Error('Orphan guard violation: commId is required (I-11)');
	const db = tx || prisma;
	return await db.commTask.create({ data });
}

export async function createHold(
	tx: any,
	data: {
		commId: string;
		resourceIds?: any;
		startTime: Date;
		endTime?: Date | null;
		status?: string;
		holdExpiresAt: Date;
		calendarEventId?: string | null;
	}
) {
	if (!data.commId) throw new Error('Orphan guard violation: commId is required (I-11)');
	const db = tx || prisma;
	return await db.commHold.create({ data });
}

export async function createApproval(
	tx: any,
	data: {
		commId: string;
		draftType: DraftType;
		draftContent: string;
		contextPayload?: any;
		approvalDeadline: Date;
		state?: ApprovalState;
		approvedBy?: string | null;
		rejectedReason?: string | null;
	}
) {
	if (!data.commId) throw new Error('Orphan guard violation: commId is required (I-11)');
	const db = tx || prisma;
	return await db.commApproval.create({ data });
}

export function isCustomerFacing(entry: { fromPartyType: PartyType; toPartyType: PartyType }): boolean {
	return entry.fromPartyType === 'customer' || entry.toPartyType === 'customer';
}
