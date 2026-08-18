import type { PrismaClient } from '@prisma/client';
import { toE164 as canonicalE164 } from '$lib/utils/phone';

/**
 * Normalize to E.164 for DB lookup.
 *
 * Delegates to the canonical implementation. This used to strip formatting and prepend "+", which
 * turned a bare NANP number into a different country's: "7052642251" became "+7052642251" rather
 * than "+17052642251" — a key that matches nothing and forks the caller into their own record.
 */
export function toE164(phone: string): string {
	return canonicalE164(phone);
}

/** Get company id that owns this number (for incoming call/SMS). */
export async function getCompanyIdByPhoneNumber(
	prisma: PrismaClient,
	phoneNumber: string
): Promise<string | null> {
	const r = await getCompanyAndFlowByPhoneNumber(prisma, phoneNumber);
	return r?.companyId ?? null;
}

/** Get company and IVR flow for this number. When callFlowId is null, number is not used for IVR (pending call). */
export async function getCompanyAndFlowByPhoneNumber(
	prisma: PrismaClient,
	phoneNumber: string
): Promise<{ companyId: string; callFlowId: string | null } | null> {
	const e164 = toE164(phoneNumber);
	if (!e164) return null;
	const row = await prisma.companyPhoneNumber.findUnique({
		where: { phoneNumber: e164 },
		select: { companyId: true, callFlowId: true }
	});
	return row ? { companyId: row.companyId, callFlowId: row.callFlowId } : null;
}

/** Get the primary number assigned to company (for outbound dial/SMS). */
export async function getFirstCompanyNumber(
	prisma: PrismaClient,
	companyId: string
): Promise<{ phoneNumber: string; id: string } | null> {
	const row = await prisma.companyPhoneNumber.findFirst({
		where: { companyId },
		orderBy: { created: 'asc' },
		select: { phoneNumber: true, id: true }
	});
	return row ?? null;
}
