import { TELNYX_API_KEY } from '$env/static/private';
import { prisma } from '$lib/db';

const normalizeDigits = (phone: string) => (phone || '').replace(/\D/g, '');

export interface TelnyxNumber {
	phone_number: string;
	status?: string;
	features?: { sms?: boolean };
}

/**
 * The company's numbers that are ACTUALLY usable — the exact intersection the "Manage Numbers"
 * screen shows: present in our DB AND live in the Telnyx account (`/api/telnyx/numbers/list`
 * filters `allNumbers` by `companyNumberSet`). The DB alone is not trustworthy: it can hold ghost
 * rows that no longer exist in Telnyx (see the "in DB but not found in Telnyx account" sync logs),
 * and sending FROM one of those fails with "10004 Invalid source number".
 *
 * Returns [] if Telnyx can't be reached, so callers must handle "no usable sender" explicitly
 * rather than silently falling back to a number that may be a ghost.
 */
export async function getActiveCompanyNumbers(companyId: string): Promise<TelnyxNumber[]> {
	const dbNumbers = await prisma.companyPhoneNumber.findMany({
		where: { companyId },
		select: { phoneNumber: true }
	});
	const companyNumberSet = new Set(dbNumbers.map((n) => normalizeDigits(n.phoneNumber)));
	if (companyNumberSet.size === 0) return [];

	try {
		const res = await fetch('https://api.telnyx.com/v2/phone_numbers?page[size]=250', {
			method: 'GET',
			headers: { Authorization: `Bearer ${TELNYX_API_KEY}` }
		});
		if (!res.ok) {
			console.error('[company-sender] Telnyx list failed:', res.status);
			return [];
		}
		const data = await res.json();
		const allNumbers: TelnyxNumber[] = data.data || [];
		return allNumbers.filter((n) => companyNumberSet.has(normalizeDigits(n.phone_number)));
	} catch (e: any) {
		console.error('[company-sender] Telnyx list error:', e?.message || e);
		return [];
	}
}

/**
 * Pick a valid SMS sender for this company, matching the "Manage Numbers" view.
 * Preference order: an explicitly-supplied number IF it's active & SMS-capable → any active,
 * SMS-capable, in-service number → null (never a ghost). null means "do not send".
 */
export async function resolveSmsSender(
	companyId: string,
	preferred?: string | null
): Promise<string | null> {
	const active = await getActiveCompanyNumbers(companyId);
	const usable = active.filter(
		(n) => n.features?.sms !== false && (n.status ?? 'active').toLowerCase() !== 'deleted'
	);
	if (usable.length === 0) return null;

	if (preferred) {
		const match = usable.find((n) => normalizeDigits(n.phone_number) === normalizeDigits(preferred));
		if (match) return match.phone_number;
	}
	// Prefer one Telnyx marks active/in-service, else the first usable.
	const inService = usable.find((n) => ['active', 'in_service'].includes((n.status ?? '').toLowerCase()));
	return (inService ?? usable[0]).phone_number;
}
