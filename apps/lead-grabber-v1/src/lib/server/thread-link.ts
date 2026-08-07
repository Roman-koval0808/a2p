// ClearSky Scheduled Intents — semantic thread link + identity bridge (§8).
//
// One message may continue a conversation the customer started on ANOTHER channel
// ("I told you I'll call previously" IS the email that promised the call). This is
// the glue that connects them, shared by the email/SMS orchestrator path and the
// voice recording path.
//
// Two passes:
//   1. THREAD pass — the same caller's recent comms (their phone on either leg).
//      When it matches, this message continues THAT conversation: the comm is
//      linked to the matched thread (shared COM ID).
//   2. IDENTITY pass — only when the thread match is same-contact (or absent).
//      The customer may be reaching us under a contact we can't tie by phone —
//      "I said I'd get back in 3 days" IS the email that promised it, filed under
//      a different profile. Ask once more over the company's recent conversations;
//      if the match belongs to ANOTHER contact, treat it as the same customer:
//      resolve their pending Scenario-A commitments (§8) and fold the auto-created
//      contact into the named one.
//
// Never throws: a failure here must never break the flow that called it.

import { prisma } from '$lib/db';
import { matchThreadOpenAI } from './openai';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const GENERIC_NAMES = [
	'Unknown',
	'Unknown Caller',
	'Unknown Customer',
	'Anonymous',
	'Valued Customer'
];

export async function linkThreadAndResolveIdentity(opts: {
	companyId: string;
	commId: string;
	content: string;
	callerPhone?: string | null;
	customerId?: string | null;
}): Promise<void> {
	const { companyId, commId, content, callerPhone, customerId } = opts;
	try {
		if (!content.trim()) return;

		const statusIn = ['completed', 'success', 'pending_approval'] as any;
		const since = new Date(Date.now() - THIRTY_DAYS_MS);

		// --- Pass 1: the same caller's recent comms (their phone on either leg). ---
		let primary: {
			id: string;
			customerId: string | null;
			communicationThreadId: string | null;
			summary: string | null;
		} | null = null;
		if (callerPhone) {
			const samePhone = await prisma.communicationLog.findMany({
				where: {
					companyId,
					id: { not: commId },
					status: { in: statusIn },
					content: { not: null },
					created: { gte: since },
					OR: [{ source: callerPhone }, { destination: callerPhone }]
				},
				orderBy: { created: 'desc' },
				take: 10
			});
			if (samePhone.length) {
				const id1 = await matchThreadOpenAI(
					content,
					samePhone
						.filter((c) => c.content)
						.map((c) => ({ id: c.id, content: c.content as string }))
				);
				primary = samePhone.find((c) => c.id === id1) ?? null;
			}
		}

		// --- Pass 2 (identity): only when pass 1 is same-contact or absent. ---
		let identityMatch: { id: string; customerId: string | null } | null = null;
		if (!primary || !primary.customerId || primary.customerId === customerId) {
			const pool = await prisma.communicationLog.findMany({
				where: {
					companyId,
					id: { not: commId },
					status: { in: statusIn },
					content: { not: null },
					customerId: { not: null },
					created: { gte: since }
				},
				orderBy: { created: 'desc' },
				take: 15
			});
			if (pool.length) {
				const id2 = await matchThreadOpenAI(
					content,
					pool.filter((c) => c.content).map((c) => ({ id: c.id, content: c.content as string }))
				);
				const m2 = pool.find((c) => c.id === id2) ?? null;
				if (m2?.customerId && m2.customerId !== customerId) identityMatch = m2;
			}
		}

		// --- Thread link from the primary match (the conversation continuation). ---
		if (primary) {
			let threadId = primary.communicationThreadId;
			if (!threadId) {
				// The matched comm may never have been put in a CommunicationThread. Using
				// its id AS the thread id violates the FK and aborts the caller — create
				// the thread row first.
				await prisma.communicationThread
					.create({
						data: {
							id: primary.id,
							companyId,
							contactId: primary.customerId,
							summary: primary.summary || null
						}
					})
					.catch(() => {});
				threadId = primary.id;
			}
			await prisma.communicationLog
				.update({ where: { id: commId }, data: { communicationThreadId: threadId } })
				.catch(() => {});
			console.log(
				`[thread-link] ${commId} linked to thread ${threadId} (semantic match with ${primary.id})`
			);
		}

		// --- Identity bridge: cross-contact match (pass 2, or pass 1 if it crossed). ---
		const bridge =
			identityMatch ??
			(primary && primary.customerId && primary.customerId !== customerId
				? { id: primary.id, customerId: primary.customerId }
				: null);

		if (bridge?.customerId && bridge.customerId !== customerId) {
			// Fold whichever contact is auto-created into the one with a real name.
			// Both real (or both auto) → keep the profiles separate.
			const [newContact, matchedContact] = await Promise.all([
				customerId
					? prisma.contact
							.findUnique({
								where: { id: customerId },
								select: { id: true, name: true, email: true, phone: true }
							})
							.catch(() => null)
					: Promise.resolve(null),
				prisma.contact
					.findUnique({
						where: { id: bridge.customerId },
						select: { id: true, name: true, email: true, phone: true }
					})
					.catch(() => null)
			]);
			const isAuto = (c: { name: string | null } | null) =>
				!c?.name || GENERIC_NAMES.includes(c.name.trim());

			const foldInto = async (survivorId: string, survivor: any, foldId: string, fold: any) => {
				try {
					// Move the folded contact's comms onto the survivor.
					await prisma.communicationLog
						.updateMany({ where: { customerId: foldId }, data: { customerId: survivorId } })
						.catch(() => {});
					// Carry its phone/email over when the survivor lacks one.
					const data: any = {};
					if (fold?.phone && !survivor?.phone) data.phone = fold.phone;
					if (fold?.email && !survivor?.email) data.email = fold.email;
					if (Object.keys(data).length) {
						await prisma.contact.update({ where: { id: survivorId }, data }).catch(() => {});
					}
					// Then remove the duplicate.
					await prisma.contact.delete({ where: { id: foldId } }).catch(() => {});
					console.log(
						`[thread-link] contacts merged: ${foldId} → ${survivorId} (${fold?.phone || fold?.email || 'no contact info'})`
					);
				} catch (e) {
					console.error(`[thread-link] contact merge failed (${foldId} → ${survivorId}):`, e);
				}
			};

			if (
				customerId &&
				newContact &&
				matchedContact &&
				isAuto(newContact) &&
				!isAuto(matchedContact)
			) {
				await foldInto(bridge.customerId, matchedContact, customerId, newContact);
			} else if (
				customerId &&
				newContact &&
				matchedContact &&
				!isAuto(newContact) &&
				isAuto(matchedContact)
			) {
				await foldInto(customerId, newContact, bridge.customerId, matchedContact);
			} else {
				console.log(
					`[thread-link] skipped contact merge (${customerId?.slice(0, 8)} ${newContact?.name ? `"${newContact.name}"` : 'auto'} ↔ ${bridge.customerId.slice(0, 8)} ${matchedContact?.name ? `"${matchedContact.name}"` : 'auto'}) — profiles kept separate`
				);
			}
		}
	} catch (e) {
		console.error('[thread-link] failed:', e);
	}
}
