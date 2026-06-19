import { prisma } from '$lib/db';

interface ResolveLocalProfileArgs {
	companyId: string;
	email?: string | null;
	phone?: string | null;
	name?: string | null;
	sessionId?: string | null;
}

/**
 * Resolves a customer profile in Svelte database.
 * If conflicts occur (different profiles matching email vs phone), merges them.
 */
export async function resolveAndMergeLocalProfile(tx: any, args: ResolveLocalProfileArgs) {
	const { companyId, email, phone, name, sessionId } = args;

	// 1. Try to find existing profiles by email and phone
	let profileByEmail = null;
	let profileByPhone = null;

	if (email) {
		profileByEmail = await tx.pipelineCustomerProfile.findFirst({
			where: { companyId, email }
		});
	}

	if (phone) {
		profileByPhone = await tx.pipelineCustomerProfile.findFirst({
			where: { companyId, phoneNumber: phone }
		});
	}

	let customerProfile = null;

	// 2. Query for session-first lookup to anchor profile if no identifier matches yet
	if (!profileByEmail && !profileByPhone && sessionId) {
		const searchPatterns = [
			`"session_id":"${sessionId}"`,
			`"sessionId":"${sessionId}"`,
		];
		const histEvent = await tx.pipelineEvent.findFirst({
			where: {
				customerProfileId: { not: null },
				OR: searchPatterns.map(p => ({
					unstructuredText: { contains: p }
				}))
			},
			include: { customerProfile: true },
			orderBy: { createdAt: 'desc' }
		});
		if (histEvent?.customerProfile) {
			customerProfile = histEvent.customerProfile;
		}
	}

	// 3. Resolve identity match & handle conflicts
	if (profileByEmail && profileByPhone) {
		if (profileByEmail.id === profileByPhone.id) {
			customerProfile = profileByEmail;
		} else {
			// Conflict: Two different profiles exist. Merge profileByPhone into profileByEmail.
			customerProfile = profileByEmail;
			
			// Update all related records pointing to profileByPhone to point to profileByEmail
			await tx.pipelineEvent.updateMany({
				where: { customerProfileId: profileByPhone.id },
				data: { customerProfileId: profileByEmail.id }
			});

			// Merge tags
			let mergedTags = [];
			try {
				const tagsEmail = Array.isArray(profileByEmail.tags) ? profileByEmail.tags : JSON.parse(profileByEmail.tags as string || '[]');
				const tagsPhone = Array.isArray(profileByPhone.tags) ? profileByPhone.tags : JSON.parse(profileByPhone.tags as string || '[]');
				mergedTags = Array.from(new Set([...tagsEmail, ...tagsPhone]));
			} catch (e) {
				mergedTags = profileByEmail.tags || [];
			}

			// Update primary profile fields
			const updates: any = {
				tags: mergedTags
			};
			if (phone && !profileByEmail.phoneNumber) {
				updates.phoneNumber = phone;
			}
			if (name && (!profileByEmail.displayName || profileByEmail.displayName === 'Unknown')) {
				updates.displayName = name;
				updates.firstName = name.split(' ')[0];
			}

			await tx.pipelineCustomerProfile.update({
				where: { id: profileByEmail.id },
				data: updates
			});

			// Delete the phone profile
			await tx.pipelineCustomerProfile.delete({
				where: { id: profileByPhone.id }
			});
		}
	} else if (profileByEmail) {
		customerProfile = profileByEmail;
		// Enrich phone if present
		const updates: any = {};
		if (phone && !profileByEmail.phoneNumber) {
			updates.phoneNumber = phone;
		}
		if (name && (!profileByEmail.displayName || profileByEmail.displayName === 'Unknown')) {
			updates.displayName = name;
			updates.firstName = name.split(' ')[0];
		}
		if (Object.keys(updates).length > 0) {
			customerProfile = await tx.pipelineCustomerProfile.update({
				where: { id: profileByEmail.id },
				data: updates
			});
		}
	} else if (profileByPhone) {
		customerProfile = profileByPhone;
		// Enrich email if present
		const updates: any = {};
		if (email && !profileByPhone.email) {
			updates.email = email;
		}
		if (name && (!profileByPhone.displayName || profileByPhone.displayName === 'Unknown')) {
			updates.displayName = name;
			updates.firstName = name.split(' ')[0];
		}
		if (Object.keys(updates).length > 0) {
			customerProfile = await tx.pipelineCustomerProfile.update({
				where: { id: profileByPhone.id },
				data: updates
			});
		}
	}

	// 4. Fallback: Name match if displayName matches name exactly and we didn't find by email/phone
	if (!customerProfile && name) {
		customerProfile = await tx.pipelineCustomerProfile.findFirst({
			where: { companyId, displayName: name }
		});
		if (customerProfile) {
			const updates: any = {};
			if (email && !customerProfile.email) updates.email = email;
			if (phone && !customerProfile.phoneNumber) updates.phoneNumber = phone;
			if (Object.keys(updates).length > 0) {
				customerProfile = await tx.pipelineCustomerProfile.update({
					where: { id: customerProfile.id },
					data: updates
				});
			}
		}
	}

	// 5. If still not found, create new profile
	if (!customerProfile) {
		// Try to pull name/details from existing Svelte Contact model if we have a match
		let contactName = name || null;
		if (phone) {
			const existingContact = await tx.contact.findFirst({
				where: { companyId, phone }
			});
			if (existingContact && existingContact.name && !contactName) {
				contactName = existingContact.name;
			}
		}

		customerProfile = await tx.pipelineCustomerProfile.create({
			data: {
				companyId,
				email: email || null,
				phoneNumber: phone || null,
				displayName: contactName || null,
				firstName: contactName ? contactName.split(' ')[0] : null,
				tags: ["Resolved Profile"]
			}
		});
	} else {
		// If name is provided and current name is empty/short, update it
		if (name && (!customerProfile.displayName || customerProfile.displayName.length < name.length)) {
			customerProfile = await tx.pipelineCustomerProfile.update({
				where: { id: customerProfile.id },
				data: {
					displayName: name,
					firstName: name.split(' ')[0]
				}
			});
		}
	}

	// 6. Retroactive session linking
	if (sessionId && customerProfile) {
		const searchPatterns = [
			`"session_id":"${sessionId}"`,
			`"sessionId":"${sessionId}"`,
		];
		await tx.pipelineEvent.updateMany({
			where: {
				customerProfileId: null,
				OR: searchPatterns.map(p => ({
					unstructuredText: { contains: p }
				}))
			},
			data: { customerProfileId: customerProfile.id }
		});
	}

	// 7. Link to Svelte Contact (create/update contact to mirror name/phone/email)
	try {
		if (phone || email) {
			const contactPhone = phone || undefined;
			const contactEmail = email || undefined;
			const contactName = customerProfile.displayName || undefined;

			// Check if Svelte contact exists
			const existingContact = await tx.contact.findFirst({
				where: {
					companyId,
					OR: [
						...(contactPhone ? [{ phone: contactPhone }] : []),
						...(contactEmail ? [{ email: contactEmail }] : [])
					]
				}
			});

			if (!existingContact) {
				// Create matching Svelte Contact
				await tx.contact.create({
					data: {
						companyId,
						name: contactName || 'Valued Customer',
						phone: contactPhone || null,
						email: contactEmail || null
					}
				});
			} else if (contactName && (!existingContact.name || existingContact.name === 'Anonymous' || existingContact.name === 'Valued Customer')) {
				// Update Svelte Contact name if it is anonymous or default
				await tx.contact.update({
					where: { id: existingContact.id },
					data: { name: contactName }
				});
			}
		}
	} catch (contactErr) {
		console.error('[profile-service] Svelte Contact sync error:', contactErr);
	}

	return customerProfile;
}
