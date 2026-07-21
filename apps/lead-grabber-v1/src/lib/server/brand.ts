// Resolves the business name used to sign customer-facing messages.
//
// Every template used to default to a hardcoded 'RightFlush Plumbing' — a name from the original
// spec walkthrough, not a real tenant. Whenever a caller omitted `brand`, live SMS and email went
// out to real customers signed as a DIFFERENT company (an emergency SMS to a ClearSky caller was
// signed "— RightFlush Plumbing"). Signing as the wrong business is worse than not signing at all,
// so the fallback here is deliberately neutral: we never substitute another company's name.

import { prisma } from '$lib/db';

/** Used when we genuinely cannot determine the business name. Neutral, never another brand. */
export const NEUTRAL_BRAND = 'our team';

const cache = new Map<string, string>();

/**
 * The company's real name. Prefers an explicitly supplied brand, then the Company record,
 * then a neutral phrase. Cached per company (names change rarely).
 */
export async function resolveBrand(
	companyId: string | null | undefined,
	explicitBrand?: string | null
): Promise<string> {
	const explicit = explicitBrand?.trim();
	if (explicit) return explicit;
	if (!companyId) return NEUTRAL_BRAND;

	const cached = cache.get(companyId);
	if (cached) return cached;

	try {
		const company = await prisma.company.findUnique({
			where: { id: companyId },
			select: { name: true }
		});
		const name = company?.name?.trim();
		if (name) {
			cache.set(companyId, name);
			return name;
		}
	} catch (e: any) {
		console.error('[brand] company lookup failed:', e?.message || e);
	}
	return NEUTRAL_BRAND;
}
