import { prisma } from '$lib/db';
import { logCommunication } from '$lib/utils/communication-log';
import { createNotification } from '$lib/utils/notifications';
import { createOrUpdateContact } from '$lib/utils/contacts';
export interface InboundEmailPayload {
	from: string;
	fromName?: string;
	to: string;
	subject: string;
	textBody?: string;
	htmlBody?: string;
	messageId: string;
	timestamp: string;
	attachments?: any[];
}

/**
 * Processes an inbound email by identifying the tenant via the recipient slug
 * and storing the message in the existing inbox (Message table).
 */
export async function processInboundEmail(payload: InboundEmailPayload) {
	try {
		// 1. Identify Tenant (Routing)
		// Recipient format: slug@hub.com or "Name" <slug@hub.com>
		const recipientEmail =
			payload.to.match(/<(.+)>|(\S+@\S+)/)?.[0]?.replace(/[<>]/g, '') || payload.to;
		const slug = recipientEmail.split('@')[0];

		const company = await prisma.company.findUnique({
			where: { emailSlug: slug }
		});

		if (!company) {
			console.warn(`[InboundEmail] No company found for slug: ${slug}. Discarding message.`);
			return { success: false, error: 'Tenant not found' };
		}

		const companyId = company.id;

		// 2. Prepare Message Data
		const content = payload.textBody || payload.htmlBody || '(No content)';
		const threadId = `email-${payload.messageId}`; // Use email messageId for consistency or a custom thread logic
		const customerName = payload.fromName || payload.from.split('@')[0];
		const customerEmail = payload.from;

		const newItem = {
			content: content,
			timestamp: new Date().toISOString(),
			is_agent_reply: false,
			subject: payload.subject,
			type: 'email'
		};

		// 3. Update or Create Message Thread (Inbox)
		// We check if a thread with this email ID or from this sender/subject already exists
		// For simplicity, we'll use a unique threadId based on the provider's message ID
		// but in a real scenario, you might want to group by subject/sender.

		let messageRecord = await prisma.message.findUnique({ where: { threadId } });

		if (messageRecord && messageRecord.companyId === companyId) {
			const prev = Array.isArray(messageRecord.messages) ? messageRecord.messages : [];
			messageRecord = await prisma.message.update({
				where: { id: messageRecord.id },
				data: {
					messages: [...prev, newItem],
					status: 'new',
					updated: new Date()
				}
			});
		} else {
			messageRecord = await prisma.message.create({
				data: {
					threadId,
					companyId,
					customerName,
					customerEmail,
					status: 'new',
					messages: [newItem]
				}
			});
		}

		// 4. Create/Update Contact
		const contact = await createOrUpdateContact({
			company_id: companyId,
			name: customerName,
			email: customerEmail
		});

		// 5. Log Communication
		await logCommunication({
			type: 'email',
			direction: 'inbound',
			status: 'success',
			source: customerEmail,
			destination: recipientEmail,
			company_id: companyId,
			customer_id: contact?.id ?? undefined,
			summary: payload.subject,
			content: content,
			metadata: { thread_id: threadId, email_message_id: payload.messageId }
		});

		return { success: true, messageId: messageRecord.id };
	} catch (error) {
		console.error('[InboundEmail] Failed to process email:', error);
		return { success: false, error: error instanceof Error ? error.message : 'Internal error' };
	}
}
