// ClearSky Scheduled Intents — semantic thread link + identity bridge (§8).
//
// One message may continue a conversation the customer started on ANOTHER channel
// ("I told you I'll call previously" IS the email that promised the call). This is
// the glue that connects them, shared by the email/SMS orchestrator path and the
// voice recording path:
//
//   1. Find the company's recent conversations with real content.
//   2. Ask OpenAI whether this message continues one of them.
//   3. If yes: ensure a real CommunicationThread row exists (the FK must never
//      point at a comm id — that aborts the whole caller), link this comm to it
//      (shared COM ID), resolve the matched customer's pending Scenario-A
//      commitments (§8 — he contacted us sooner than he promised), and fold an
//      auto-created caller contact into the matched one.
//
// Never throws: a failure here must never break the flow that called it.

import { prisma } from '$lib/db';
import { resolvePendingCustomerCommitments } from './open-commitments';
import { matchThreadOpenAI } from './openai';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const GENERIC_NAMES = ['Unknown', 'Unknown Caller', 'Unknown Customer', 'Anonymous', 'Valued Customer'];

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

		// 1. Candidates: the same caller's recent comms first, then the company's
		//    recent conversations (an unidentified caller has no same-phone history).
		const recent = await prisma.communicationLog.findMany({
			where: {
				companyId,
				id: { not: commId },
				status: { in: ['completed', 'success', 'pending_approval'] },
				content: { not: null },
				created: { gte: new Date(Date.now() - THIRTY_DAYS_MS) },
				...(callerPhone
					? { OR: [{ source: callerPhone }, { destination: callerPhone }] }
					: {})
			},
			orderBy: { created: 'desc' },
			take: 10
		});

		let candidates = recent;
		if (candidates.length === 0) {
			const companyRecent = await prisma.communicationLog.findMany({
				where: {
					companyId,
					id: { not: commId },
					status: { in: ['completed', 'success', 'pending_approval'] },
					content: { not: null },
					customerId: { not: null },
					created: { gte: new Date(Date.now() - THIRTY_DAYS_MS) }
				},
				orderBy: { created: 'desc' },
				take: 15
			});
			candidates = companyRecent;
		}

		if (candidates.length === 0) return;

		// 2. Semantic judgement.
		const aiMatchedCommId = await matchThreadOpenAI(
			content,
			candidates.filter((c) => c.content).map((c) => ({ id: c.id, content: c.content as string }))
		);
		if (!aiMatchedCommId) return;
		const matched = candidates.find((c) => c.id === aiMatchedCommId) ?? null;
		if (!matched) return;

		// 3a. Ensure the thread row exists — never use a comm id as the thread id.
		let matchedThreadId: string;
		if (matched.communicationThreadId) {
			matchedThreadId = matched.communicationThreadId;
		} else {
			await prisma.communicationThread
				.create({
					data: {
						id: matched.id,
						companyId,
						contactId: matched.customerId,
						summary: (matched as any)?.summary || null
					}
				})
				.catch(() => {});
			matchedThreadId = matched.id;
		}

		// 3b. Link this comm to the shared thread (shared COM ID).
		await prisma.communicationLog
			.update({
				where: { id: commId },
				data: { communicationThreadId: matchedThreadId }
			})
			.catch(() => {});
		console.log(
			`[thread-link] ${commId} linked to thread ${matchedThreadId} (semantic match with ${matched.id})`
		);

		// 3c. Identity bridge: the matcher says both messages belong to the same
		//     conversation — the two contacts are the same customer. Resolve pending
		//     Scenario-A commitments on BOTH sides (§8: he contacted us sooner than
		//     promised), whichever one owns them. Direction doesn't matter: the
		//     "new" message could be either the email or the call.
		if (matched.customerId && matched.customerId !== customerId) {
			for (const profileId of new Set([customerId, matched.customerId].filter(Boolean) as string[])) {
				const resolved = await resolvePendingCustomerCommitments(companyId, profileId);
				if (resolved > 0) {
					console.log(
						`[thread-link] resolved ${resolved} pending commitment(s) for ${profileId}`
					);
				}
			}

			// 3d. Fold whichever contact is auto-created into the one with a real name.
			//     If both have real names (or neither), keep the profiles separate.
			const [newContact, matchedContact] = await Promise.all([
				customerId
					? prisma.contact
							.findUnique({ where: { id: customerId }, select: { id: true, name: true, email: true, phone: true } })
							.catch(() => null)
					: Promise.resolve(null),
				prisma.contact
					.findUnique({ where: { id: matched.customerId }, select: { id: true, name: true, email: true, phone: true } })
					.catch(() => null)
			]);
			const isAuto = (c: { name: string | null } | null) =>
				!c?.name || GENERIC_NAMES.includes(c.name.trim());

			const foldInto = (survivorId: string, survivor: any, foldId: string, fold: any) => {
				// Move the folded contact's comms onto the survivor, carry its phone/email
				// over, then delete the duplicate.
				prisma.communicationLog
					.updateMany({ where: { customerId: foldId }, data: { customerId: survivorId } })
					.catch(() => {});
				const data: any = {};
				if (fold?.phone && !survivor?.phone) data.phone = fold.phone;
				if (fold?.email && !survivor?.email) data.email = fold.email;
				if (Object.keys(data).length) {
					prisma.contact.update({ where: { id: survivorId }, data }).catch(() => {});
				}
				prisma.contact.delete({ where: { id: foldId } }).catch(() => {});
				console.log(
					`[thread-link] contacts merged: ${foldId} → ${survivorId} (${fold?.phone || fold?.email || 'no contact info'})`
				);
			};

			if (customerId && newContact && matchedContact && isAuto(newContact) && !isAuto(matchedContact)) {
				foldInto(matched.customerId, matchedContact, customerId, newContact);
			} else if (customerId && newContact && matchedContact && !isAuto(newContact) && isAuto(matchedContact)) {
				foldInto(customerId, newContact, matched.customerId, matchedContact);
			} else {
				console.log(
					`[thread-link] skipped contact merge (${customerId?.slice(0, 8)} ${newContact?.name ? `"${newContact.name}"` : 'auto'} ↔ ${matched.customerId.slice(0, 8)} ${matchedContact?.name ? `"${matchedContact.name}"` : 'auto'}) — profiles kept separate`
				);
			}
		}
	} catch (e) {
		console.error('[thread-link] failed:', e);
	}
}
