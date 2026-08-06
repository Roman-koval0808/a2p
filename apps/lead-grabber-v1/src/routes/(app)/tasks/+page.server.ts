import { prisma } from '$lib/db';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

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
				clientName: task.contact?.name || 'Unknown',
				intent: task.title.toLowerCase().includes('support') ? 'supp' : 'opp',
				commId: task.communicationThreadId || `id-${Math.floor(Math.random() * 9000) + 1000}`,
				refId: `id ${Math.floor(Math.random() * 900) + 100}`,
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
			select: { id: true, name: true }
		});
		const contactName = new Map(contacts.map((c) => [c.id, c.name || 'Unknown']));

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
			const name = contactName.get(si.profileId) || 'Unknown';

			return {
				id: si.id,
				date: dateStr,
				origin: si.actor === 'CUSTOMER' ? 'CR' : 'OA',
				channel: isCall ? 'Ph out' : 'out',
				channelIcon: isCall ? 'phone' : 'email',
				clientId: si.profileId?.slice(-4) || '-',
				clientName: name,
				intent: si.intentType === 'CUSTOMER_COMMITMENT_A' ? 'A-pend' : 'B-pend',
				commId: si.id.slice(-8),
				refId: `id ${Math.floor(Math.random() * 900) + 100}`,
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
