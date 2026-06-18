/**
 * Pure client-safe filter for contacts by search query (name, phone).
 * Use this in browser code. For server/Prisma-backed utils see $lib/utils/contacts.
 */
export function filterContacts<T extends { name?: string | null; phone?: string | null }>(
	contacts: T[],
	query: string
): T[] {
	if (!query) return contacts;
	const lowerQuery = query.toLowerCase();
	return contacts.filter(
		(c) => c.name?.toLowerCase().includes(lowerQuery) || (c.phone ?? '').toString().includes(query)
	);
}
