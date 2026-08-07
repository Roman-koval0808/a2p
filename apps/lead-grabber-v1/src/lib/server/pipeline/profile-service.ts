import { prisma } from '$lib/db';
import { toE164 } from '$lib/utils/phone';

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
	const { companyId, name, sessionId } = args;

	// Identity keys are canonical before they are looked up or stored (§4.4). Raw values meant
	// "Bert@X.com" missed "bert@x.com" and "7052642251" missed "+17052642251", so the same person
	// was looked up, not found, and created again.
	const email = args.email?.trim().toLowerCase() || null;
	const phone = toE164(args.phone) || null;

	// 1. Try to find existing profiles by email and phone
	let profileByEmail = null;
	let profileByPhone = null;

	if (email) {
		profileByEmail = await tx.pipelineCustomerProfile.findFirst({
			// Case-insensitive so rows written before normalisation still resolve here rather than
			// forking a second record.
			where: { companyId, email: { equals: email, mode: 'insensitive' } }
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
			
			// Point everything hanging off the phone profile at the survivor. Containers and
			// identifiers move too — moving only the events left the rest orphaned on a record
			// that was about to disappear.
			await tx.pipelineEvent.updateMany({
				where: { customerProfileId: profileByPhone.id },
				data: { customerProfileId: profileByEmail.id }
			});
			await tx.commContainer.updateMany({
				where: { customerProfileId: profileByPhone.id },
				data: { customerProfileId: profileByEmail.id }
			});
			// (companyId, kind, value) is unique on identifiers, so anything the survivor already
			// holds would collide — move only what's genuinely new.
			const survivorKeys = await tx.commIdentifier.findMany({
				where: { customerProfileId: profileByEmail.id },
				select: { kind: true, value: true }
			});
			const held = new Set(survivorKeys.map((k: any) => `${k.kind}:${k.value}`));
			const moving = await tx.commIdentifier.findMany({
				where: { customerProfileId: profileByPhone.id },
				select: { id: true, kind: true, value: true }
			});
			for (const k of moving) {
				if (held.has(`${k.kind}:${k.value}`)) continue;
				await tx.commIdentifier.update({
					where: { id: k.id },
					data: { customerProfileId: profileByEmail.id }
				});
			}

			// Merge tags
			let mergedTags = [];
			try {
				const tagsEmail = Array.isArray(profileByEmail.tags) ? profileByEmail.tags : JSON.parse(profileByEmail.tags as string || '[]');
				const tagsPhone = Array.isArray(profileByPhone.tags) ? profileByPhone.tags : JSON.parse(profileByPhone.tags as string || '[]');
				mergedTags = Array.from(new Set([...tagsEmail, ...tagsPhone]));
			} catch (e) {
				mergedTags = profileByEmail.tags || [];
			}

			// Retire the phone profile FIRST — never delete it. Its ID is sitting in cookies,
			// conversation threads and task records, and looking one up has to keep working by
			// following `mergedInto` to the survivor.
			//
			// It has to give up its identifiers before the survivor can take them:
			// (companyId, phoneNumber) is unique, so claiming the number while the loser still
			// holds it is a constraint violation.
			await tx.pipelineCustomerProfile.update({
				where: { id: profileByPhone.id },
				data: {
					email: null,
					phoneNumber: null,
					mergedInto: profileByEmail.id,
					status: 'merged'
				}
			});

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

	// 4. Fallback: Name match if displayName matches name exactly and we didn't find by email/phone.
	//
	// NB this is the one weak match here — two people share a name routinely. It attaches to an
	// existing record rather than merging two, so it can't fuse two histories, but it is why a name
	// alone never earns Tier 1.
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
			// Contacts may hold the number in any legacy format, so compare canonical-to-canonical
			// rather than exact-matching a string that was never normalised on the way in.
			const candidates = await tx.contact.findFirst({
				where: { companyId, OR: [{ phone }, { phone: args.phone ?? undefined }] }
			});
			const existingContact = candidates;
			if (existingContact && existingContact.name && !contactName) {
				contactName = existingContact.name;
			}
		}

		// A person is only created when the lookup above found nobody. If a concurrent request
		// created them a moment ago, the unique constraint on (companyId, email) / (companyId,
		// phoneNumber) rejects this write — and the answer is to go back to the lookup and use
		// what they created, never to retry with a second record.
		try {
			customerProfile = await tx.pipelineCustomerProfile.create({
				data: {
					companyId,
					email: email || null,
					phoneNumber: phone || null,
					displayName: contactName || null,
					firstName: contactName ? contactName.split(' ')[0] : null,
					tags: ['Resolved Profile']
				}
			});
		} catch (err: any) {
			if (err?.code !== 'P2002') throw err;
			customerProfile = await tx.pipelineCustomerProfile.findFirst({
				where: {
					companyId,
					OR: [
						...(email ? [{ email }] : []),
						...(phone ? [{ phoneNumber: phone }] : [])
					]
				}
			});
			if (!customerProfile) throw err;
			console.log(
				`[profile-service] Lost a create race for ${email || phone} — using the existing profile ${customerProfile.id}`
			);
		}
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
