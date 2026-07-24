import { prisma } from '$lib/db';
import { registerTimer } from '$lib/server/timer/timer-service';
import { resolveAndMergeLocalProfile } from '$lib/server/pipeline/profile-service';
import { analyzeRepeatContactDelta } from '$lib/server/scenarios/s3-escalation';
import type { EmergencyBridgeWorkOrder, TechRotaItem } from '$lib/server/scenarios/s2-emergency-bridge';

/**
 * Single, idempotent emergency-dispatch path (Scenarios 2 & 3, §1.2 / §1.1.4).
 *
 * Before this existed there were two problems on the live path:
 *   - A repeat emergency call RESTARTED the dial ladder from rung 1 (or was ignored), instead of
 *     ADVANCING it (Scenario 3, Correction 2: repeat contact shortens escalation).
 *   - The ladder had no per-container state, so nothing tracked which rung had been dialed and a
 *     redelivered webhook could double-dial.
 *
 * This function is the one dispatch entry point. It stores ladder state in the container's
 * `sla_breach` timer payload (`ladderState`) — no schema change — and is safe to call from BOTH the
 * voice intake bridge and process_orchestrator: the `dispatchedRungs` set makes a second call for an
 * already-dialed rung a no-op.
 *
 * Behaviour:
 *   - FIRST emergency for a customer  → dial rung 1, record ladderState + SLA deadline.
 *   - REPEAT during the open incident → advance one rung, update the whisper with the transcript
 *     delta (severity / callback-number change), dial the next rung. NO second SLA clock.
 *   - No open emergency container (e.g. an SMS emergency that never created one) → legacy fallback:
 *     dial rung 1 with no container state, preserving today's behaviour (no regression).
 */
export async function startOrAdvanceEmergencyLadder(
	input: {
		companyId: string;
		customerNumber: string;
		transcript?: string;
		customerName?: string | null;
		dispatchFrom: string;
		/** Rota override; if omitted it is derived from company.settings.notifications.phone_numbers. */
		rota?: TechRotaItem[];
		now?: Date;
	},
	tx?: any
): Promise<{
	mode: 'started' | 'advanced' | 'skipped_already_dialed' | 'started_no_container' | 'no_rota';
	rungDialed?: number;
	dispatchedCount: number;
	commId?: string;
	whisperText?: string;
}> {
	const db = tx || prisma;
	const now = input.now || new Date();

	// --- Rota ---
	let rota = input.rota;
	if (!rota) {
		const company = await db.company.findUnique({ where: { id: input.companyId } });
		const nums = ((company?.settings as any)?.notifications?.phone_numbers || []) as any[];
		rota = nums
			.map((entry, i) => {
				const phone = typeof entry === 'string' ? entry : entry?.number;
				const name = typeof entry === 'object' && entry?.name ? entry.name : `Tech ${i + 1}`;
				return phone ? { userId: `u_tech${i}`, name, phone, rung: i + 1 } : null;
			})
			.filter(Boolean) as TechRotaItem[];
	}
	if (!rota || rota.length === 0) {
		return { mode: 'no_rota', dispatchedCount: 0 };
	}

	const { startDialLadder } = await import('$lib/server/emergency-dial');
	const summary = (input.transcript || 'Emergency').substring(0, 50);
	const baseWhisper = `Emergency call, ${input.customerName || 'Customer'}, ${summary}. Press 1 to connect, press 2 to decline.`;

	// --- Resolve the customer profile so we can find their open emergency container ---
	let customerProfileId: string | null = null;
	try {
		const profile = await resolveAndMergeLocalProfile(db, {
			companyId: input.companyId,
			phone: input.customerNumber,
			name: input.customerName || undefined
		});
		customerProfileId = profile?.id ?? null;
	} catch {
		customerProfileId = null;
	}

	// --- Find the in-flight emergency container (oldest open one is the incident) ---
	let container: any = null;
	if (customerProfileId) {
		const containers = await db.commContainer.findMany({
			where: {
				companyId: input.companyId,
				customerProfileId,
				threadType: 'emergency',
				state: { not: 'closed' }
			},
			orderBy: { openedAt: 'asc' }
		});
		container = containers[0] || null;
	}

	// --- Legacy fallback: no container (e.g. SMS emergency). Dial rung 1 as before, no state. ---
	if (!container) {
		const workOrder = buildWorkOrder(rota, 1, input.customerNumber, baseWhisper, now);
		await startDialLadder(workOrder, input.dispatchFrom);
		return { mode: 'started_no_container', rungDialed: 1, dispatchedCount: rota.length };
	}

	// --- Locate (or create) the sla_breach timer that carries ladder state ---
	let slaTimer = await db.pipelineTimer.findFirst({
		where: { commId: container.id, type: 'sla_breach', status: 'registered' },
		orderBy: { createdAt: 'desc' }
	});
	const ladderState = (slaTimer?.payload as any)?.ladderState as
		| { currentRung: number; dispatchedRungs: number[]; whisperText: string }
		| undefined;

	if (!ladderState) {
		// FIRST dispatch for this incident — rung 1.
		const slaDeadline = new Date(now.getTime() + 10 * 60 * 1000);
		const workOrder = buildWorkOrder(rota, 1, input.customerNumber, baseWhisper, now, slaDeadline);
		await startDialLadder(workOrder, input.dispatchFrom);

		if (!slaTimer) {
			slaTimer = await registerTimer(db, {
				commId: container.id,
				companyId: input.companyId,
				type: 'sla_breach',
				fireAt: slaDeadline,
				payload: {},
				supersedeSameType: true
			});
		}
		await db.pipelineTimer.update({
			where: { id: slaTimer.id },
			data: {
				payload: {
					...((slaTimer.payload as any) || {}),
					ladderState: { currentRung: 1, dispatchedRungs: [1], whisperText: baseWhisper }
				}
			}
		});
		await db.commContainer.update({ where: { id: container.id }, data: { slaDeadline } });
		return { mode: 'started', rungDialed: 1, dispatchedCount: rota.length, commId: container.id, whisperText: baseWhisper };
	}

	// REPEAT during an open incident — advance one rung (Correction 2).
	const targetRung = Math.min(ladderState.currentRung + 1, rota.length);
	if (ladderState.dispatchedRungs.includes(targetRung)) {
		// Already dialed this rung (webhook redelivery / double caller) — idempotent no-op.
		return { mode: 'skipped_already_dialed', dispatchedCount: 0, commId: container.id };
	}

	// Build the transcript delta: the incident's ORIGINAL message (first entry on the incident
	// container) vs. THIS repeat call's message. The repeat's own entry lives on the newly-created
	// suppressed container (it is only folded in at review), so the current transcript passed by the
	// caller is the reliable "second" side — not another read of the incident container.
	const entries = await db.commEntry.findMany({
		where: { commId: container.id, channel: 'voice' },
		orderBy: { occurredAt: 'asc' }
	});
	const firstEntry = entries[0];
	const secondTranscript = input.transcript || entries[entries.length - 1]?.transcript || '';
	const delta = analyzeRepeatContactDelta(
		firstEntry?.transcript || '',
		secondTranscript,
		firstEntry?.fromParty,
		input.customerNumber
	);

	let whisperText = ladderState.whisperText || baseWhisper;
	if (delta.deltaText) {
		whisperText = `SECOND CALL from customer! ${delta.deltaText} ${whisperText}`;
	}
	const dialNumber = delta.newCallbackNumber || input.customerNumber;

	const workOrder = buildWorkOrder(rota, targetRung, dialNumber, whisperText, now);
	await startDialLadder(workOrder, input.dispatchFrom);

	await db.pipelineTimer.update({
		where: { id: slaTimer!.id },
		data: {
			payload: {
				...((slaTimer!.payload as any) || {}),
				ladderState: {
					currentRung: targetRung,
					dispatchedRungs: [...ladderState.dispatchedRungs, targetRung],
					whisperText
				}
			}
		}
	});

	return { mode: 'advanced', rungDialed: targetRung, dispatchedCount: 1, commId: container.id, whisperText };
}

function buildWorkOrder(
	rota: TechRotaItem[],
	rung: number,
	customerNumber: string,
	whisperText: string,
	now: Date,
	slaDeadline?: Date
): EmergencyBridgeWorkOrder {
	return {
		commId: '',
		personId: null,
		customerNumber,
		dialLadder: rota,
		currentRung: rung,
		maxAttemptsPerRung: 1,
		whisperText,
		emergencySummary: whisperText.substring(0, 50),
		slaDeadline: slaDeadline || new Date(now.getTime() + 10 * 60 * 1000),
		escalationPolicy: 'ladder_with_dtmf'
	};
}
