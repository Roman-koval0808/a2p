import { prisma } from '$lib/db';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { tierForIdentifiers, type LineType } from '$lib/server/profiledb/tiers';
import { toE164, formatPhoneNumber } from '$lib/utils/phone';

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
				date: task.dueDate
					? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
							task.dueDate
						) +
						(task.dueDate.getDate() % 10 === 1 && task.dueDate.getDate() !== 11
							? 'st'
							: task.dueDate.getDate() % 10 === 2 && task.dueDate.getDate() !== 12
								? 'nd'
								: task.dueDate.getDate() % 10 === 3 && task.dueDate.getDate() !== 13
									? 'rd'
									: 'th')
					: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
							task.created
						) +
						(task.created.getDate() % 10 === 1 && task.created.getDate() !== 11
							? 'st'
							: task.created.getDate() % 10 === 2 && task.created.getDate() !== 12
								? 'nd'
								: task.created.getDate() % 10 === 3 && task.created.getDate() !== 13
									? 'rd'
									: 'th'),
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
			const dueObj = new Date(si.dueAt);
			const ordinal =
				dueObj.getDate() % 10 === 1 && dueObj.getDate() !== 11
					? 'st'
					: dueObj.getDate() % 10 === 2 && dueObj.getDate() !== 12
						? 'nd'
						: dueObj.getDate() % 10 === 3 && dueObj.getDate() !== 13
							? 'rd'
							: 'th';
			const dateStr =
				new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(dueObj) +
				ordinal;
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
				commId: si.id.slice(-8),
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
