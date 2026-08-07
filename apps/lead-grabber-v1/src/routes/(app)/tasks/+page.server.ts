import { prisma } from '$lib/db';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { tierForIdentifiers, type LineType } from '$lib/server/profiledb/tiers';
import { toE164, formatPhoneNumber } from '$lib/utils/phone';

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
				// These were `Math.random()` — a different "ID" on every page load, so the same task
				// showed a new comm id and ref id each time it was viewed and nothing could be
				// matched against a record. Derived from the real IDs instead, so they're stable.
				commId: task.communicationThreadId || `id-${task.id.slice(-8)}`,
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

		// The conversation each intent belongs to. `payload.conversationId` is a CommContainer id;
		// the human-facing reference is that container's `commRef` (COM-…), which is what appears
		// everywhere else in the app. Showing a slice of the intent's own id instead made the
		// column impossible to match against the communications log.
		const commRefByContainerId = new Map<string, string>();
		try {
			const containerIds = Array.from(
				new Set(
					intents
						.map((si) => (si.payload as Record<string, any>)?.conversationId)
						.filter((id): id is string => typeof id === 'string' && !!id)
				)
			);
			if (containerIds.length) {
				const containers = await prisma.commContainer.findMany({
					where: { id: { in: containerIds }, companyId },
					select: { id: true, commRef: true }
				});
				for (const c of containers) commRefByContainerId.set(c.id, c.commRef);
			}
		} catch (e: any) {
			console.error('[tasks] could not resolve comm refs:', e?.message || e);
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
				commId: commRefByContainerId.get(p?.conversationId) || `SI-${si.id.slice(-6)}`,
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

		// --- Container tasks -------------------------------------------------------------------
		//
		// The action items the AI raises from a conversation ("prepare discovery questions for
		// when Bert calls back") are written as CommTask rows against the container. This page was
		// reading only `Task` and `ScheduledIntent`, so a conversation that produced two follow-ups
		// and one commitment showed a single row and looked like work had been dropped.
		let containerTasks: any[] = [];
		try {
			const rows = await prisma.commTask.findMany({
				where: { container: { companyId }, status: 'open' },
				include: {
					container: {
						select: {
							commRef: true,
							threadType: true,
							contact: { select: { id: true, name: true, phone: true, email: true } }
						}
					}
				},
				orderBy: { due: 'asc' },
				take: 100
			});

			containerTasks = rows.map((t) => {
				const contact = t.container?.contact ?? null;
				// A CommTask records what to do, not how. `threadType` is the topic (sales,
				// support…), not a channel, so the best available signal is how we can actually
				// reach this person.
				const isCall = !!contact?.phone;
				return {
					id: t.id,
					date: formatShortDate(t.due),
					// A customer promise is theirs to keep; anything else is ours to do.
					origin: t.category === 'customer_promise' ? 'CR' : 'OA',
					channel: isCall ? 'Ph out' : 'out',
					channelIcon: isCall ? 'phone' : 'email',
					clientId: contact?.id ?? '-',
					clientName: displayName(contact ?? {}),
					profileHref: contact ? `/profiles/${contact.id}` : null,
					intent: t.category === 'customer_promise' ? 'A-pend' : 'opp',
					commId: t.container?.commRef ?? '-',
					refId: `id ${t.id.slice(-6)}`,
					summary: t.description,
					title: t.description,
					status: t.status,
					fullDateString: t.due.toISOString(),
					_kind: 'task' as const
				};
			});
		} catch (e: any) {
			console.error('[tasks] could not load container tasks:', e?.message || e);
		}

		// Merge: tasks first, then pending actions — both are "work that needs attention"
		return { tasks: [...tasks, ...containerTasks, ...pendingActions] };
	} catch (err) {
		console.error('Error loading tasks:', err);
		return { tasks: [] };
	}
};
