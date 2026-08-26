import { prisma } from '$lib/db';
import { resolveEngagementThread, ENGAGEMENT_RULES_VERSION } from './engagement';

/**
 * The ONE way to find the engagement a new interaction belongs to.
 *
 * Before this existed the same decision was written out four times — the telemetry intake,
 * `logCommunication`, and twice inside the Telnyx call webhook — and only the first two were ever
 * updated. The voice copies ordered by `created` instead of `updated`, had no inactivity window so
 * an engagement never expired, took no lock so two call events could each open one, and stamped
 * neither `assignReason` nor `rulesVersion` — which also left voice threads movable by the
 * container matcher, since that guard keys off `rulesVersion`.
 *
 * Callers that write their own `CommunicationLog` (the call webhook, the /test page) should call
 * this and use the id it returns. Callers going through `logCommunication` get it for free.
 *
 * Must run inside a transaction (`tx`) for the advisory lock to mean anything.
 */
export async function resolveEngagementForContact(
	tx: any,
	args: {
		companyId: string;
		contactId: string;
		/** Optional: an explicit engagement/project/quote reference, when one is genuinely known. */
		explicitThreadId?: string | null;
		summary?: string | null;
	}
): Promise<{ threadId: string; isNew: boolean; reason: string }> {
	const db = tx || prisma;

	// Same lock key as the telemetry intake, so a page view and a call arriving together
	// serialise against each other instead of each opening an engagement.
	const lockKey = `eng_${args.companyId}_contact_${args.contactId}`;
	await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

	const where = { companyId: args.companyId, contactId: args.contactId };
	const [openThread, recentThread] = await Promise.all([
		db.communicationThread.findFirst({
			where: { ...where, status: { not: 'closed' } },
			orderBy: { updated: 'desc' }
		}),
		db.communicationThread.findFirst({ where, orderBy: { updated: 'desc' } })
	]);

	const toOpen = (t: any) =>
		t
			? {
					id: t.id,
					status: t.status,
					subtopics: Array.isArray(t.subtopics) ? t.subtopics : [],
					updated: new Date(t.updated)
				}
			: null;

	const decision = resolveEngagementThread({
		explicitThreadId: args.explicitThreadId ?? null,
		openThread: toOpen(openThread),
		recentThread: toOpen(recentThread)
	});

	// Retire a thread whose window has lapsed. Point-and-retire, never delete: its rows stay put
	// and it keeps its ENG code, it simply stops attracting new interactions.
	if (decision.closeThreadId) {
		await db.communicationThread.update({
			where: { id: decision.closeThreadId },
			data: { status: 'closed' }
		});
	}

	if (decision.decision !== 'new' && decision.threadId) {
		await db.communicationThread.update({
			where: { id: decision.threadId },
			data: {
				assignReason: decision.reason,
				rulesVersion: ENGAGEMENT_RULES_VERSION,
				...(args.summary ? { summary: args.summary } : {})
			}
		});
		return { threadId: decision.threadId, isNew: false, reason: decision.reason };
	}

	const created = await db.communicationThread.create({
		data: {
			companyId: args.companyId,
			contactId: args.contactId,
			status: 'open',
			summary: args.summary ?? null,
			assignReason: decision.reason,
			rulesVersion: ENGAGEMENT_RULES_VERSION
		}
	});
	return { threadId: created.id, isNew: true, reason: decision.reason };
}

/**
 * Add a subtopic to an engagement's rollup, once.
 *
 * A subtopic is a TAG on the episode, never a boundary — the engagement accumulates every subject
 * it has touched, and that array is what the log header renders ("ENG-… (Roof, Drain)") and what
 * `engagementWindowDays` reads to decide how long the episode stays warm.
 *
 * This existed only inside `logCommunication`, so the two voice writers — the Telnyx call webhook
 * and the /test simulator — set `CommunicationLog.subtopic` on the row but never rolled it onto the
 * engagement. A call about a furnace followed by one about a drain therefore left the engagement
 * showing no subjects at all.
 *
 * Idempotent, and never throws: a rollup failing must not lose the call that produced it.
 */
export async function rollUpSubtopic(
	db: any,
	threadId: string | null | undefined,
	subtopic: string | null | undefined
): Promise<void> {
	if (!threadId || !subtopic) return;
	try {
		const thread = await db.communicationThread.findUnique({
			where: { id: threadId },
			select: { subtopics: true }
		});
		const current: string[] = Array.isArray(thread?.subtopics) ? (thread.subtopics as string[]) : [];
		if (current.includes(subtopic)) return;
		await db.communicationThread.update({
			where: { id: threadId },
			data: { subtopics: [...current, subtopic] }
		});
	} catch (err: any) {
		console.error('[engagement] subtopic rollup failed:', err?.message || err);
	}
}
