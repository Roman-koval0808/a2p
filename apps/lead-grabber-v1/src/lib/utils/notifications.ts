import { prisma } from '$lib/db';
import { broadcastCallEvent } from './sse';

export type NotificationType =
	| 'email'
	| 'sms'
	| 'voice'
	| 'web'
	| 'facebook'
	| 'chatbot'
	| 'leadform'
	| 'leadbox';
export type NotificationDirection = 'inbound' | 'outbound';

export interface CreateNotificationInput {
	company_id: string;
	type: NotificationType;
	direction: NotificationDirection;
	source_name?: string;
	source_identifier?: string; // phone, email, threadId
	message_preview: string;
	content?: string;
	communication_log_id?: string;
	message_id?: string;
	thread_id?: string;
}

/**
 * Create a notification. Call whenever a communication is logged or an inbox message is sent/received.
 * Requires: run `pnpm prisma migrate deploy` so the `notifications` table exists.
 */
export async function createNotification(input: CreateNotificationInput) {
	try {
		if (!prisma?.notification) return null;
		const notification = await prisma.notification.create({
			data: {
				companyId: input.company_id,
				type: input.type,
				direction: input.direction,
				sourceName: input.source_name ?? null,
				sourceIdentifier: input.source_identifier ?? null,
				messagePreview: input.message_preview,
				content: input.content ?? null,
				communicationLogId: input.communication_log_id ?? null,
				messageId: input.message_id ?? null,
				threadId: input.thread_id ?? null
			}
		});
		if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
			console.log(
				'Notification created:',
				notification.id,
				input.type,
				input.source_name ?? input.source_identifier ?? ''
			);
		}

		// Broadcast via SSE
		broadcastCallEvent(input.company_id, {
			type: 'new_notification',
			notification
		});

		// Specialized events for UI convenience
		if (input.type === 'sms' && input.direction === 'inbound') {
			broadcastCallEvent(input.company_id, {
				type: 'new_sms',
				notification
			});
		} else if (input.type === 'voice' && input.direction === 'inbound') {
			broadcastCallEvent(input.company_id, {
				type: 'incoming_call',
				notification
			});
		}

		return notification;
	} catch (err: unknown) {
		const code =
			err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : '';
		if (code !== 'P2021') console.error('Failed to create notification:', err);
		return null;
	}
}
