import { prisma } from '$lib/db';
import { toE164 } from '$lib/utils/phone';
import { filterContacts } from './contacts-filter';

export { filterContacts };

/**
 * Canonical email for use as an identity key (§4.4): lowercased and trimmed, every time.
 *
 * `Bert@X.com` and `bert@x.com` are one person. Matching on the raw string made them two contacts
 * — Postgres `=` is case-sensitive — and that is the single most likely cause of a duplicate.
 */
function emailKey(email: string | null | undefined): string | null {
	const cleaned = email?.trim().toLowerCase();
	return cleaned || null;
}

interface ContactData {
	company_id: string;
	name?: string;
	email?: string;
	phone?: string;
}

/**
 * Fetches contacts for a company
 * @param companyId - The company ID to fetch contacts for
 * @param limit - Maximum number of contacts to fetch (default: 50)
 * @returns Array of contacts
 */
export async function getContactsByCompany(companyId: string, limit: number = 50) {
	try {
		const contacts = await prisma.contact.findMany({
			where: {
				companyId: companyId
			},
			take: limit,
			orderBy: {
				updated: 'desc'
			}
		});
		return contacts;
	} catch (error) {
		console.error('Error fetching contacts:', error);
		return [];
	}
}

export async function createOrUpdateContact(data: ContactData) {
	// Never store a placeholder as a real contact name — leave it blank so the UI shows the phone.
	const GENERIC_NAMES = ['Anonymous', 'Unknown Caller', 'Unknown Customer', 'Unknown', 'Valued Customer'];
	if (data.name && GENERIC_NAMES.includes(data.name.trim())) {
		data = { ...data, name: undefined };
	}

	if (!data.name && !data.email && !data.phone) {
		return null;
	}

	try {
		let contact = null;

		// Identity keys — canonical forms, not display forms. `normalizePhoneNumber` only strips
		// formatting, so "7052642251" and "+17052642251" stayed two different people; `toE164`
		// resolves both to one key.
		const normalizedPhone = data.phone ? toE164(data.phone) : null;
		const normalizedEmail = emailKey(data.email);

		// Priority 1: Match by phone number (normalized) - this is the most reliable identifier
		if (normalizedPhone) {
			try {
				// Fetch all contacts for this company that have phone numbers
				const allContacts = await prisma.contact.findMany({
					where: {
						companyId: data.company_id,
						phone: {
							not: null
						}
					}
				});

				// Find contact with matching canonical phone number. Comparing canonical-to-canonical
				// means rows stored under the old formatting still match.
				for (const c of allContacts) {
					if (c.phone) {
						const existingNormalized = toE164(c.phone);
						if (existingNormalized && existingNormalized === normalizedPhone) {
							contact = c;
							break;
						}
					}
				}
			} catch (err) {
				// No contacts found or error - continue
			}
		}

		// Priority 2: Match by email (if no phone match found).
		// Case-insensitive, so a row written before normalisation ("Bert@X.com") still matches the
		// canonical key and gets folded into the same contact instead of forking a new one.
		if (!contact && normalizedEmail) {
			try {
				contact = await prisma.contact.findFirst({
					where: {
						email: { equals: normalizedEmail, mode: 'insensitive' },
						companyId: data.company_id
					}
				});
			} catch (err) {
				// Contact not found
			}
		}

		// Update existing or create new contact
		if (contact) {
			// Merge into existing contact - keep original name, add new name to past_names
			const updates: any = {};

			// Handle name merging: prefer NEW name, add old name to past_names if different
			if (data.name && data.name !== contact.name && data.name !== 'Anonymous') {
				if (contact.name && contact.name !== 'Anonymous' && contact.name !== data.name) {
					// Get existing past_names array or initialize empty array
					let pastNames: string[] = [];
					if (contact.pastNames) {
						try {
							pastNames = Array.isArray(contact.pastNames) ? contact.pastNames : [];
						} catch (e) {
							pastNames = [];
						}
					}

					// Add OLD name to past_names if it's not already there
					if (!pastNames.includes(contact.name)) {
						pastNames.push(contact.name);
						updates.pastNames = pastNames;
					}
					// Update primary name to the NEW name
					updates.name = data.name;
				} else if ((!contact.name || contact.name === 'Anonymous') && data.name) {
					// If existing contact has no name or is Anonymous, update the name
					updates.name = data.name;
				}
			}

			// Store the canonical email. This also rewrites a row that was saved before
			// normalisation, so each contact is healed once rather than on every touch.
			if (normalizedEmail && normalizedEmail !== contact.email) {
				updates.email = normalizedEmail;
			}

			// Same for the phone: store canonical E.164, healing legacy formatting in place.
			if (normalizedPhone && toE164(contact.phone) !== normalizedPhone) {
				updates.phone = normalizedPhone;
			} else if (normalizedPhone && !contact.phone) {
				updates.phone = normalizedPhone;
			}

			if (Object.keys(updates).length > 0) {
				return await prisma.contact.update({
					where: { id: contact.id },
					data: updates
				});
			}
			return contact;
		} else {
			// Create new contact
			const contactData = {
				companyId: data.company_id,
				name: data.name || 'Anonymous',
				email: normalizedEmail,
				phone: normalizedPhone || data.phone || null
			};

			console.log('Creating new contact:', contactData);
			return await prisma.contact.create({
				data: contactData
			});
		}
	} catch (err) {
		console.error('Error in createOrUpdateContact:', err);
		throw err;
	}
}
