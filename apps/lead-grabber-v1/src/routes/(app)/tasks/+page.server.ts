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

		// Map to the wireframe requirements where possible
		const tasks = dbTasks.map((task) => {
			return {
				id: task.id,
				// Format date like "Aug 7th" for the UI
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
				// Mock origin if missing (CR = Customer Request, OA = Owner Action)
				origin: task.contactId ? 'CR' : 'OA',
				// Mock channel based on description/title or default to email out
				channel: task.title.toLowerCase().includes('call') ? 'Ph out' : 'out',
				channelIcon: task.title.toLowerCase().includes('call') ? 'phone' : 'email',
				clientId: task.contactId || '-',
				clientName: task.contact?.name || 'Unknown',
				// Mock intent
				intent: task.title.toLowerCase().includes('support') ? 'supp' : 'opp',
				commId: task.communicationThreadId || `id-${Math.floor(Math.random() * 9000) + 1000}`,
				refId: `id ${Math.floor(Math.random() * 900) + 100}`,
				summary: task.description || task.title,
				title: task.title,
				status: task.status,
				fullDateString: task.dueDate ? task.dueDate.toISOString() : task.created.toISOString()
			};
		});

		return { tasks };
	} catch (err) {
		console.error('Error loading tasks:', err);
		return { tasks: [] };
	}
};
