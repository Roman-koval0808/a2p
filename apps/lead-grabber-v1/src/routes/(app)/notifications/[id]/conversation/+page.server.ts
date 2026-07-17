import { prisma } from '$lib/db';
import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

function fmtDate(d: Date) {
	return d.toLocaleDateString('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});
}

function fmtTime(d: Date) {
	return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user?.company) {
		throw redirect(302, '/login');
	}

	const companyId = locals.user.company.id;

	const notification = await prisma.notification.findFirst({
		where: { id: params.id, companyId }
	});

	if (!notification) {
		throw error(404, 'Notification not found');
	}

	// Build the conversation thread. If the notification is linked to a
	// CommunicationThread, use its logs as the real message history; otherwise
	// the thread is just the single notification message.
	type ThreadMessage = {
		id: string;
		sender: string;
		senderIsYou: boolean;
		message: string;
		date: string;
		time: string;
	};

	let messages: ThreadMessage[] = [];

	if (notification.communicationThreadId) {
		const logs = await prisma.communicationLog.findMany({
			where: { communicationThreadId: notification.communicationThreadId, companyId },
			include: { user: true },
			orderBy: { created: 'asc' }
		});

		messages = logs.map((log) => {
			const isYou = log.direction === 'outbound';
			return {
				id: log.id,
				sender: isYou
					? (log.user?.name ?? 'You')
					: (log.source ?? notification.sourceName ?? 'Unknown'),
				senderIsYou: isYou,
				message: log.content ?? log.summary ?? '',
				date: fmtDate(new Date(log.created)),
				time: fmtTime(new Date(log.created))
			};
		});
	}

	// Fallback / no-thread case: seed with the notification itself.
	if (messages.length === 0) {
		messages = [
			{
				id: notification.id,
				sender: notification.sourceName ?? 'Unknown',
				senderIsYou: notification.direction === 'outbound',
				message: notification.content ?? notification.messagePreview,
				date: fmtDate(new Date(notification.createdAt)),
				time: fmtTime(new Date(notification.createdAt))
			}
		];
	}

	return {
		notification: {
			id: notification.id,
			type: notification.type,
			sourceName: notification.sourceName ?? 'Unknown',
			sourceIdentifier: notification.sourceIdentifier,
			createdAt: notification.createdAt.toISOString(),
			headerDate: `${fmtDate(new Date(notification.createdAt))} – ${fmtTime(new Date(notification.createdAt))}`
		},
		messages
	};
};
