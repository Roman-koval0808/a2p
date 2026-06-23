import { prisma } from '$lib/db';
import { createNotification } from '$lib/utils/notifications';
import { isA2pDbEnabled, mirrorToA2p } from '$lib/server/a2p-db';

export type CommunicationType =
	| 'email'
	| 'sms'
	| 'voice'
	| 'web'
	| 'facebook'
	| 'chatbot'
	| 'leadform'
	| 'leadbox';
export type CommunicationDirection = 'inbound' | 'outbound';
export type CommunicationStatus = 'success' | 'failed' | 'pending' | 'missed' | 'completed';

export interface CommunicationLogEntry {
	type: CommunicationType;
	direction: CommunicationDirection;
	status: CommunicationStatus;
	source?: string;
	destination?: string;
	customer_id?: string;
	company_id?: string;
	user_id?: string;
	summary?: string;
	content?: string;
	duration?: number;
	metadata?: Record<string, any>;
	assigned_members?: string[];
	thread_id?: string;
	/** Optional: for A2P mirror (contact name/company) */
	contact_name?: string;
	contact_company?: string;
}

/**
 * Logs a communication event to the database.
 * @param entry The communication log entry details
 * @returns The created record or null if logging failed
 */
export async function logCommunication(entry: CommunicationLogEntry) {
	try {
		// Convert assigned_members array to relation if provided
		const data: any = {
			type: entry.type,
			direction: entry.direction,
			status: entry.status,
			source: entry.source || null,
			destination: entry.destination || null,
			customerId: entry.customer_id || null,
			companyId: entry.company_id || null,
			userId: entry.user_id || null,
			summary: entry.summary || null,
			content: entry.content || null,
			duration: entry.duration || null,
			metadata: entry.metadata || null
		};

		// Handle thread linking or creation
		let threadId = entry.thread_id || (entry.metadata as { commId?: string })?.commId || (entry.metadata as { thread_id?: string })?.thread_id;
		
		if (threadId && entry.company_id) {
			// Ensure thread exists if an ID was passed in
			await prisma.communicationThread.upsert({
				where: { id: threadId },
				create: {
					id: threadId,
					companyId: entry.company_id,
					contactId: entry.customer_id || null,
					status: 'open',
					summary: entry.summary || null
				},
				update: {}
			});
		} else if (!threadId && entry.company_id) {
			const newThread = await prisma.communicationThread.create({
				data: {
					companyId: entry.company_id,
					contactId: entry.customer_id || null,
					status: 'open',
					summary: entry.summary || null
				}
			});
			threadId = newThread.id;
		}

		if (threadId) {
			data.communicationThreadId = threadId;
			let metaObj = entry.metadata || {};
			if (typeof metaObj === 'object' && !Array.isArray(metaObj)) {
				metaObj = {
					...metaObj,
					commId: threadId
				};
			}
			data.metadata = metaObj;
		}

		const record = await prisma.communicationLog.create({
			data
		});

		// Handle assigned members if provided
		if (entry.assigned_members && entry.assigned_members.length > 0) {
			await prisma.communicationLogAssignedMember.createMany({
				data: entry.assigned_members.map((userId) => ({
					communicationLogId: record.id,
					userId
				})),
				skipDuplicates: true
			});
		}

		// Show notification for every communication log
		if (entry.company_id) {
			await createNotification({
				company_id: entry.company_id,
				type: entry.type,
				direction: entry.direction,
				source_name: entry.source ?? undefined,
				source_identifier: entry.destination ?? undefined,
				message_preview:
					(entry.summary ?? entry.content ?? '').slice(0, 120) +
					((entry.summary ?? entry.content ?? '').length > 120 ? '...' : ''),
				content: entry.content ?? undefined,
				communication_log_id: record.id,
				communication_thread_id: data.communicationThreadId,
				thread_id: (entry.metadata as { thread_id?: string })?.thread_id
			} as any); // using as any since we added communication_thread_id in DB but types might not be updated yet
		}

		// Mirror into A2P DB when configured (leadbox/leadform/email/etc. then appear on A2P comm log page)
		if (isA2pDbEnabled()) {
			mirrorToA2p({
				type: entry.type,
				direction: entry.direction,
				source: entry.source,
				destination: entry.destination,
				summary: entry.summary,
				content: entry.content,
				metadata: entry.metadata,
				contact_name: entry.contact_name,
				contact_company: entry.contact_company
			}).catch((err) => console.error('A2P mirror failed:', err));
		}

		return record;
	} catch (err) {
		console.error('Failed to log communication:', err);
		// We don't want to throw here to prevent disrupting the main flow
		return null;
	}
}
