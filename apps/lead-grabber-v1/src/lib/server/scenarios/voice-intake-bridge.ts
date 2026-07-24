import { prisma } from '$lib/db';
import {
	createContainerAtIntake,
	createEntry,
	classifyThreadType
} from '$lib/server/container/container-service';
import { registerTimer } from '$lib/server/timer/timer-service';
import { resolveAndMergeLocalProfile } from '$lib/server/pipeline/profile-service';
import { evaluateEmergency } from '$lib/server/ai/emergency';

/**
 * Voice intake bridge — the single production seam that connects the live Telnyx voice webhook
 * to the container/timer platform (spec Part 1). Before this existed, inbound voice never created
 * a CommContainer, so I-8/I-9 failed on the voice path and the emergency dispatch in
 * process_orchestrator had no container to attach its SLA to.
 *
 * What it guarantees, for EVERY inbound voice communication (§1.1.2, non-negotiable):
 *   - a person profile (thin profile on ANI miss — §1.3),
 *   - a CommContainer + comm_ref created at intake, before/independent of downstream dispatch,
 *   - an immutable inbound CommEntry carrying the transcript,
 *   - the §1.1.4 suppression gate applied (same person + open same-type container in join window
 *     → actionsSuppressed, and NO second SLA clock — test 3-1b),
 *   - for a NON-suppressed emergency, a single per-container sla_breach timer (the outer-loop hard
 *     deadline; also satisfies I-7 — a non-terminal emergency container has a governing timer).
 *
 * It deliberately does NOT originate the dial ladder itself. Dispatch stays where it already lives
 * (process_orchestrator → startDialLadder), so this call is additive and low-risk. It returns the
 * container so callers can link dispatch to a real comm_id.
 */
export async function ingestVoiceIntake(
	tx: any,
	input: {
		companyId: string;
		callControlId?: string;
		customerPhone: string;
		customerName?: string | null;
		customerEmail?: string | null;
		transcript?: string | null;
		/** IVR selection: 2 = sales, 3 = support/emergency (§1.1.4). */
		ivrOption?: number;
		/** Recording URL for provenance on the entry. */
		recordingUrl?: string | null;
		now?: Date;
	}
): Promise<{
	container: any;
	entry: any;
	profileId: string | null;
	threadType: string;
	actionsSuppressed: boolean;
	suppressedAgainstCommId?: string;
	isEmergency: boolean;
	slaDeadline: Date | null;
}> {
	const db = tx || prisma;
	const now = input.now || new Date();
	const transcript = input.transcript || '';

	// 1. Identity resolution (§1.3) — thin profile on ANI miss, never blocks intake.
	let profileId: string | null = null;
	try {
		const profile = await resolveAndMergeLocalProfile(db, {
			companyId: input.companyId,
			phone: input.customerPhone,
			name: input.customerName || undefined,
			email: input.customerEmail || undefined
		});
		profileId = profile?.id ?? null;
	} catch (e) {
		// Identity must never block the pipeline (§1.3). Proceed with a null profile.
		console.error('[VoiceIntake] identity resolution failed, proceeding thin:', e);
	}

	// 2. Deterministic thread_type at intake (§1.1.4) — keyword floor + IVR selection.
	const emergencyEval = evaluateEmergency(transcript);
	const threadType = classifyThreadType({
		ivrOption: input.ivrOption,
		keywordHit: emergencyEval.isEmergency,
		text: transcript
	});

	// 3. Container + ref at intake, with the suppression gate applied (§1.1.2 / §1.1.4).
	const { container, actionsSuppressed, suppressedAgainstCommId } = await createContainerAtIntake(db, {
		companyId: input.companyId,
		customerProfileId: profileId,
		threadType: threadType as any,
		now
	});

	// 4. Immutable inbound entry (append-only fact — §1.1.5). When suppressed, we STILL store the
	//    communication — dedup suppresses actions, never storage (Scenario 3, Correction 1).
	const entry = await createEntry(db, {
		commId: container.id,
		customerProfileId: profileId,
		direction: 'inbound',
		channel: 'voice',
		fromParty: input.customerPhone,
		toParty: 'system',
		fromPartyType: 'customer',
		toPartyType: 'system',
		occurredAt: now,
		recordingUrl: input.recordingUrl || null,
		transcript: transcript || null,
		analysisJson: {
			emergencySource: emergencyEval.emergencySource,
			keywordHits: emergencyEval.keywordHits
		},
		dedupSuppressed: actionsSuppressed,
		identityMethod: profileId ? 'ani_exact' : 'none'
	});

	// 5. Emergency outer-loop SLA timer — only when this container is allowed to fire actions.
	//    A suppressed second emergency call must NOT start a second SLA clock (test 3-1b).
	let slaDeadline: Date | null = null;
	const isEmergency = threadType === 'emergency';
	if (isEmergency && !actionsSuppressed) {
		slaDeadline = new Date(now.getTime() + 10 * 60 * 1000); // 10-minute hard deadline (§Scenario 3)
		await db.commContainer.update({
			where: { id: container.id },
			data: { slaDeadline, threadType: 'emergency' }
		});
		await registerTimer(db, {
			commId: container.id,
			companyId: input.companyId,
			type: 'sla_breach',
			fireAt: slaDeadline,
			payload: { customerPhone: input.customerPhone, source: 'voice_intake' },
			supersedeSameType: true
		});
	}

	return {
		container,
		entry,
		profileId,
		threadType,
		actionsSuppressed,
		suppressedAgainstCommId,
		isEmergency,
		slaDeadline
	};
}
