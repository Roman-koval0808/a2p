import { prisma } from '$lib/db';
import { normalizePhoneNumber } from '$lib/utils/phone';
import { filterContacts } from './contacts-filter';

export { filterContacts };

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

		// Normalize phone number if provided
		const normalizedPhone = data.phone ? normalizePhoneNumber(data.phone) : null;

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

				// Find contact with matching normalized phone number
				for (const c of allContacts) {
					if (c.phone) {
						const existingNormalized = normalizePhoneNumber(c.phone);
						if (existingNormalized === normalizedPhone) {
							contact = c;
							break;
						}
					}
				}
			} catch (err) {
				// No contacts found or error - continue
			}
		}

		// Priority 2: Match by email (if no phone match found)
		if (!contact && data.email) {
			try {
				contact = await prisma.contact.findFirst({
					where: {
						email: data.email,
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

			// Update email if provided and different
			if (data.email && data.email !== contact.email) {
				updates.email = data.email;
			}

			// Update phone if normalized version is different
			if (normalizedPhone && contact.phone) {
				const existingNormalized = normalizePhoneNumber(contact.phone);
				if (existingNormalized !== normalizedPhone) {
					// Keep the more complete format (with + if available)
					updates.phone = normalizedPhone.startsWith('+') ? normalizedPhone : contact.phone;
				}
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
				email: data.email || null,
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
