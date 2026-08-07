import { prisma } from '$lib/db';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { tierForIdentifiers, type LineType } from '$lib/server/profiledb/tiers';
import { toE164, formatPhoneNumber } from '$lib/utils/phone';
import { commCode } from '$lib/utils/comm-id';

/** "Aug 20th" — the format the table uses throughout. */
function formatShortDate(d: Date): string {
	const day = d.getDate();
	const ordinal =
		day % 10 === 1 && day !== 11
			? 'st'
			: day % 10 === 2 && day !== 12
				? 'nd'
				: day % 10 === 3 && day !== 13
					? 'rd'
					: 'th';
	return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d) + ordinal;
}

/**
 * What to call someone we have no name for.
 *
 * "Unknown" tells the user nothing and reads like a failure. We almost always hold *something* —
 * the number they rang from, or an email — so lead with "Customer" and qualify it with whatever
 * identifies them. Bare "Customer" only when we genuinely have nothing.
 */
function displayName(person: {
	name?: string | null;
	phone?: string | null;
	email?: string | null;
}): string {
	const name = person.name?.trim();
	if (name) return name;

	const phone = person.phone?.trim();
	if (phone) return `Customer ${formatPhoneNumber(phone) || phone}`;

	const email = person.email?.trim();
	if (email) return `Customer ${email}`;

	return 'Customer';
}

export const load: PageServerLoad = async ({ locals, depends }) => {
	depends('app:tasks');

	if (!locals.user?.company) {
		throw redirect(302, '/login');
	}

	const companyId = locals.user.company.id;

	try {
		const dbTasks = await prisma.task.findMany({
			where: { companyId },
			include: {
				contact: true,
				assignedTo: true,
				communicationThread: true
			},
			orderBy: { created: 'desc' },
			take: 100
		});

		// The COM reference for each task's conversation.
		//
		// This column has to match what the communications log shows (COM-SHVTB), or the two
		// screens can't be reconciled. A task carries a `communicationThreadId`, not a container,
		// so the route is thread → the comm logs on it → the container reference the orchestrator
		// stamped into their metadata. Contact is the fallback: the newest container that contact
		// has. Anything still unresolved shows "—" rather than an invented id.
		const codeByThreadId = new Map<string, string>();
		const commRefByContactId = new Map<string, string>();
		try {
			const threadIds = Array.from(
				new Set(dbTasks.map((t) => t.communicationThreadId).filter((id): id is string => !!id))
			);
			if (threadIds.length) {
				const logs = await prisma.communicationLog.findMany({
					where: { companyId, communicationThreadId: { in: threadIds } },
					select: { id: true, communicationThreadId: true, metadata: true, created: true },
					orderBy: { created: 'desc' }
				});
				// Store the COM code computed from the LOG ROW ITSELF, with exactly the arguments
				// the communications log passes. Recomputing it from the task's own fields produced
				// a different hash whenever the container ref was absent — which is why the two
				// screens showed different codes for one conversation.
				for (const l of logs) {
					if (!l.communicationThreadId || codeByThreadId.has(l.communicationThreadId)) continue;
					const ref = (l.metadata as Record<string, any> | null)?.commRef ?? null;
					const code = commCode(l.communicationThreadId, ref, l.created, Date.now(), l.id);
					if (code) codeByThreadId.set(l.communicationThreadId, code);
				}
			}

			const contactIds = Array.from(
				new Set(dbTasks.map((t) => t.contactId).filter((id): id is string => !!id))
			);
			if (contactIds.length) {
				const containers = await prisma.commContainer.findMany({
					where: { companyId, contactId: { in: contactIds } },
					select: { contactId: true, commRef: true },
					orderBy: { lastActivityAt: 'desc' }
				});
				for (const c of containers) {
					if (c.contactId && !commRefByContactId.has(c.contactId)) {
						commRefByContactId.set(c.contactId, c.commRef);
					}
				}
			}
		} catch (e: any) {
			console.error('[tasks] could not resolve task comm refs:', e?.message || e);
		}

		const tasks = dbTasks.map((task) => {
			return {
				id: task.id,
				date: formatShortDate(task.dueDate ?? task.created),
				origin: task.contactId ? 'CR' : 'OA',
				channel: task.title.toLowerCase().includes('call') ? 'Ph out' : 'out',
				channelIcon: task.title.toLowerCase().includes('call') ? 'phone' : 'email',
				clientId: task.contactId || '-',
				clientName: displayName(task.contact ?? {}),
				// Where to send someone who clicks the name. Null when there's no contact to open.
				profileHref: task.contactId ? `/profiles/${task.contactId}` : null,
				intent: task.title.toLowerCase().includes('support') ? 'supp' : 'opp',
				// The same COM reference the communications log shows for this conversation.
				// Was `Math.random()` — a different id on every page load, matching nothing.
				// The SAME code the communications log renders. `commRef` is the raw container
				// number (#6352); `commCode` hashes it to the COM-facing form (SHVTB) that every
				// other screen shows. Displaying the raw ref here is why the two never matched.
				commId: (() => {
					const code =
						(task.communicationThreadId
							? codeByThreadId.get(task.communicationThreadId)
							: undefined) ??
						(task.contactId
							? (() => {
									const ref = commRefByContactId.get(task.contactId);
									return ref ? commCode(null, ref, task.created) : undefined;
								})()
							: undefined);
					return code ? `COM-${code}` : '—';
				})(),
				refId: `id ${task.id.slice(-6)}`,
				summary: task.description || task.title,
				title: task.title,
				status: task.status,
				fullDateString: task.dueDate ? task.dueDate.toISOString() : task.created.toISOString(),
				_kind: 'task' as const
			};
		});

		// --- ClearSky Scheduled Intents as Pending Actions ---
		const intents = await prisma.scheduledIntent.findMany({
			where: { clientId: companyId },
			orderBy: { dueAt: 'asc' },
			take: 100
		});

		// profileId is a plain String — batch-resolve contact names in one query.
		const profileIds = [...new Set(intents.map((si) => si.profileId))];
		const contacts = await prisma.contact.findMany({
			where: { id: { in: profileIds }, companyId },
			select: { id: true, name: true, phone: true, email: true }
		});
		const contactById = new Map(contacts.map((c) => [c.id, c]));

		// The COM id for each intent, taken from the COMMUNICATION LOG THAT CREATED IT.
		//
		// Not derived, not guessed from the container: the promise records the exact log row it was
		// extracted from (`payload.commLogId`, and `idempotencyKey` = `orch_suspense_<logId>` for
		// rows written before that field existed). We load that row and run the SAME `commCode`
		// call the communications log runs, with its own threadId, commRef, created and id — so
		// the two screens cannot disagree.
		const codeByIntentId = new Map<string, string>();
		try {
			const logIdByIntent = new Map<string, string>();
			for (const si of intents) {
				const fromPayload = (si.payload as Record<string, any>)?.commLogId;
				const fromKey = si.idempotencyKey?.startsWith('orch_suspense_')
					? si.idempotencyKey.slice('orch_suspense_'.length)
					: null;
				const logId = (typeof fromPayload === 'string' && fromPayload) || fromKey;
				if (logId) logIdByIntent.set(si.id, logId);
			}

			const logIds = Array.from(new Set(logIdByIntent.values()));
			if (logIds.length) {
				const logs = await prisma.communicationLog.findMany({
					where: { id: { in: logIds }, companyId },
					select: { id: true, communicationThreadId: true, metadata: true, created: true }
				});
				const logById = new Map(logs.map((l) => [l.id, l]));
				const now = Date.now();
				for (const [intentId, logId] of logIdByIntent) {
					const l = logById.get(logId);
					if (!l) continue;
					const ref = (l.metadata as Record<string, any> | null)?.commRef ?? null;
					const code = commCode(l.communicationThreadId, ref, l.created, now, l.id);
					if (code) codeByIntentId.set(intentId, code);
				}
			}
		} catch (e: any) {
			console.error('[tasks] could not resolve intent comm codes:', e?.message || e);
		}

		// Line types for the tier badge, read from the shared cache in one query. A number that was
		// never classified is simply absent and comes through as undefined — which is Tier 2.
		const lineTypeByPhone = new Map<string, LineType>();
		try {
			const phones = Array.from(
				new Set(contacts.map((c) => toE164(c.phone)).filter((p): p is string => !!p))
			);
			if (phones.length) {
				const cached = await prisma.numberLookup.findMany({
					where: { phoneNumber: { in: phones } },
					select: { phoneNumber: true, lineType: true }
				});
				for (const row of cached) lineTypeByPhone.set(row.phoneNumber, row.lineType as LineType);
			}
		} catch (e: any) {
			console.error('[tasks] could not read line types:', e?.message || e);
		}

		const pendingActions = intents.map((si) => {
			const p = (si.payload as Record<string, any>) || {};
			const whatHeWants = p?.whatHeWants || '';
			const rawTimeframe = p?.rawTimeframe || '';
			const originalChannel = p?.originalChannel || 'email';
			const isCall = originalChannel === 'voice' || p?.preferredChannel === 'call';

			// Show the date the CUSTOMER gave. `dueAt` now equals it (the 7-day grace was removed),
			// but prefer the stated target explicitly so rows written under the old grace still
			// display what the customer actually said rather than a week later.
			const targetObj = p?.calculatedTargetDate ? new Date(p.calculatedTargetDate) : null;
			const dueObj =
				targetObj && !Number.isNaN(targetObj.getTime()) ? targetObj : new Date(si.dueAt);
			const dateStr = formatShortDate(dueObj);
			const contact = contactById.get(si.profileId);
			const name = displayName(contact ?? {});
			const profileHref = contact ? `/profiles/${contact.id}` : null;

			// Tier is an ATTRIBUTION judgement — do we hold an identifier that resolves one person?
			// It was being derived from `actor`, i.e. "the customer promised something, so Tier 1",
			// which is engagement, not attribution, and the two must never be combined (§4.1).
			// A phone only reaches Tier 1 on a mobile line (§4.3a).
			const tier = tierForIdentifiers({
				hasEmail: !!contact?.email,
				hasPhone: !!contact?.phone,
				lineType: lineTypeByPhone.get(toE164(contact?.phone)),
				hasName: !!contact?.name
			});

			return {
				id: si.id,
				date: dateStr,
				origin: si.actor === 'CUSTOMER' ? 'CR' : 'OA',
				// Direction follows who owes the next move. On a CUSTOMER commitment they said
				// they'd come back to us, so nothing outbound is due — labelling it "Ph out"
				// contradicted the "incoming Call" origin shown right beside it.
				channel: isCall ? (si.actor === 'CUSTOMER' ? 'Ph in' : 'Ph out') : si.actor === 'CUSTOMER' ? 'in' : 'out',
				channelIcon: isCall ? 'phone' : 'email',
				clientId: si.profileId?.slice(-4) || '-',
				clientName: name,
				profileHref,
				tier,
				intent: si.intentType === 'CUSTOMER_COMMITMENT_A' ? 'A-pend' : 'B-pend',
				// The conversation's COM-… reference, so this row can be matched against the
				// communications log. Falls back to the intent id only when the intent was filed
				// without a conversation.
				commId: (() => {
					const code = codeByIntentId.get(si.id);
					return code ? `COM-${code}` : '—';
				})(),
				// Was `Math.random()`, so the ref id changed on every page load.
				refId: `id ${si.id.slice(-6)}`,
				summary: whatHeWants + (rawTimeframe ? ` (said: "${rawTimeframe}")` : ''),
				title: `${si.actor === 'CUSTOMER' ? 'Customer' : 'We'} ${whatHeWants}`,
				status: si.status,
				fullDateString: si.dueAt.toISOString(),
				// Scheduled-intent specific fields for the expanded view and editing
				_kind: 'scheduled_intent' as const,
				_raw: {
					dueAt: si.dueAt.toISOString(),
					expiresAt: si.expiresAt?.toISOString() ?? null,
					whatHeWants,
					rawTimeframe,
					actor: si.actor,
					intentType: si.intentType,
					profileId: si.profileId,
					clientName: name,
					profileHref,
					tier,
					originalChannel,
					preferredChannel: p?.preferredChannel || '',
					createdAt: si.createdAt.toISOString()
				}
			};
		});

		// Merge: tasks first, then pending actions — both are "work that needs attention"
		return { tasks: [...tasks, ...pendingActions] };
	} catch (err) {
		console.error('Error loading tasks:', err);
		return { tasks: [] };
	}
};
