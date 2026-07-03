import { prisma } from '$lib/db';

const last10 = (p: string | null | undefined) => (p || '').replace(/\D/g, '').slice(-10);

/**
 * Resolve a customer's account balance by PHONE (normalized last-10 digits). Prefers a
 * directly-known balance; otherwise finds a same-phone contact that has one — which covers a
 * duplicate/older row, or a different phone format (e.g. "(905) 705-5234" vs "+19057055234").
 * Never matches by name. Returns null when there's genuinely no balance on record.
 */
export async function resolveBalanceByPhone(
	companyId: string,
	phone: string | null | undefined,
	knownBalance?: number | null
): Promise<number | null> {
	if (knownBalance !== null && knownBalance !== undefined) return knownBalance;
	const digits = last10(phone);
	if (!digits) return null;
	try {
		const candidates = await prisma.contact.findMany({
			where: { companyId, accountBalance: { not: null } },
			select: { phone: true, accountBalance: true }
		});
		const alt = candidates.find((c) => last10(c.phone) === digits);
		return alt?.accountBalance ?? null;
	} catch {
		return null;
	}
}
