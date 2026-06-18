import type { PrismaClient } from '@prisma/client';
import { normalizePhoneNumber } from '$lib/utils/phone';

/** Normalize contact (phone or email) for matching across Message and CommunicationLog. */
export function normalizeContactForMatch(value: string | null | undefined): string {
	if (value == null || value === '') return '';
	const s = String(value).trim().toLowerCase();
	// If it looks like a phone (digits, +, spaces, parens), normalize as phone
	if (/\d/.test(s) && /^[\d\s\-+().]+$/i.test(s)) {
		return normalizePhoneNumber(s);
	}
	return s;
}

/** Log-like shape: we only need source, metadata, companyId. */
type LogLike = { source: string | null; metadata: unknown; companyId: string };

/** Message-like shape: we need threadId, customerPhone, customerEmail, companyId. */
type MessageLike = {
	threadId: string;
	customerPhone: string | null;
	customerEmail: string | null;
	companyId: string;
};

/**
 * Find inbox Messages that belong to this CommunicationLog.
 * 1) By metadata.thread_id === message.threadId
 * 2) Else by log.source matching message.threadId, customerPhone, or customerEmail (normalized)
 */
export async function getMessagesForLog(
	prisma: PrismaClient,
	log: LogLike,
	companyId: string
): Promise<{ id: string; threadId: string; companyId: string }[]> {
	const sourceNorm = normalizeContactForMatch(log.source);
	const meta =
		log.metadata && typeof log.metadata === 'object'
			? (log.metadata as Record<string, unknown>)
			: null;
	const threadIdFromMeta = typeof meta?.thread_id === 'string' ? meta.thread_id : null;

	// 1) By thread_id
	if (threadIdFromMeta) {
		const byThread = await prisma.message.findMany({
			where: { companyId, threadId: threadIdFromMeta },
			select: { id: true, threadId: true, companyId: true }
		});
		if (byThread.length > 0) return byThread;
	}

	// 2) By source vs threadId / customerPhone / customerEmail
	if (!sourceNorm) return [];

	const candidates = await prisma.message.findMany({
		where: {
			companyId,
			OR: [
				{ threadId: { equals: sourceNorm, mode: 'insensitive' } },
				{ customerPhone: { not: null } },
				{ customerEmail: { not: null } }
			]
		},
		select: { id: true, threadId: true, companyId: true, customerPhone: true, customerEmail: true }
	});

	const matched = candidates.filter((m) => {
		const t = normalizeContactForMatch(m.threadId);
		const p = normalizeContactForMatch(m.customerPhone);
		const e = normalizeContactForMatch(m.customerEmail);
		return t === sourceNorm || p === sourceNorm || e === sourceNorm;
	});

	return matched.map((m) => ({ id: m.id, threadId: m.threadId, companyId: m.companyId }));
}

/**
 * Find CommunicationLogs that belong to this Message.
 * 1) By metadata.thread_id === message.threadId
 * 2) Else by log.source matching message.threadId, customerPhone, or customerEmail (normalized)
 */
export async function getLogsForMessage(
	prisma: PrismaClient,
	message: MessageLike,
	companyId: string
): Promise<{ id: string }[]> {
	const threadNorm = normalizeContactForMatch(message.threadId);
	const phoneNorm = normalizeContactForMatch(message.customerPhone);
	const emailNorm = normalizeContactForMatch(message.customerEmail);

	// 1) By metadata.thread_id (path filter or in-memory fallback)
	let byThread: { id: string }[] = [];
	try {
		byThread = await prisma.communicationLog.findMany({
			where: {
				companyId,
				metadata: { path: ['thread_id'], equals: message.threadId }
			},
			select: { id: true }
		});
	} catch {
		const allForCompany = await prisma.communicationLog.findMany({
			where: { companyId },
			select: { id: true, metadata: true }
		});
		byThread = allForCompany
			.filter((l) => (l.metadata as Record<string, unknown>)?.thread_id === message.threadId)
			.map((l) => ({ id: l.id }));
	}
	if (byThread.length > 0) return byThread;

	// 2) By source matching contact
	const norms = [threadNorm, phoneNorm, emailNorm].filter(Boolean);
	if (norms.length === 0) return [];

	const logs = await prisma.communicationLog.findMany({
		where: { companyId, source: { not: null } },
		select: { id: true, source: true }
	});

	const matched = logs.filter((l) => {
		const s = normalizeContactForMatch(l.source);
		return s && norms.includes(s);
	});

	return matched.map((l) => ({ id: l.id }));
}
