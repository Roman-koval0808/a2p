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

		// Send email alert to owners/admins if configured
		if (input.direction === 'inbound') {
			try {
				const company = await prisma.company.findUnique({
					where: { id: input.company_id },
					select: { settings: true, name: true }
				});
				if (company) {
					let settings = company.settings;
					if (typeof settings === 'string') {
						try {
							settings = JSON.parse(settings);
						} catch {
							settings = null;
						}
					}
					const notifSettings = (settings as any)?.notifications;
					if (notifSettings?.email) {
						const members = await prisma.companyMember.findMany({
							where: {
								companyId: input.company_id,
								role: { in: ['owner', 'admin'] },
								status: 'active'
							},
							include: { user: true }
						});
						const recipientEmails = members.map((m) => m.user.email).filter(Boolean);
						if (recipientEmails.length > 0) {
							const { sendEmail } = await import('$lib/server/brevo');
							const subject = `[Lead Grabber] New ${input.type.toUpperCase()} Lead/Alert from ${input.source_name || 'Anonymous'}`;
							const htmlContent = `
								<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
									<h2 style="color: #333; margin-top: 0;">New Incoming Communication</h2>
									<p><strong>Company:</strong> ${company.name}</p>
									<p><strong>Type:</strong> ${input.type.toUpperCase()}</p>
									<p><strong>From:</strong> ${input.source_name || 'Anonymous'} (${input.source_identifier || 'Unknown'})</p>
									<p><strong>Message Preview:</strong></p>
									<div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #007bff; margin: 15px 0; font-style: italic;">
										${input.message_preview}
									</div>
									${input.content ? `<p><strong>Full Content:</strong></p><p style="white-space: pre-wrap;">${input.content}</p>` : ''}
									<div style="margin-top: 30px; border-top: 1px solid #eee; padding-top: 15px; font-size: 12px; color: #777;">
										This is an automated notification from Lead Grabber. You can adjust your preferences in settings.
									</div>
								</div>
							`;
							await sendEmail({
								to: recipientEmails.map((email) => ({ email })),
								subject,
								htmlContent
							});
							console.log(`[Email Notification] Alert sent to ${recipientEmails.join(', ')}`);
						}
					}
				}
			} catch (emailErr) {
				console.error('[Email Notification Error] Failed to send email alert:', emailErr);
			}
		}
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
