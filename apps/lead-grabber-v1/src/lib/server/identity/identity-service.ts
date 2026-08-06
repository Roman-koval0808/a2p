import { prisma } from '$lib/db';
import { getLineType } from '$lib/server/number-lookup';
import { isExclusiveLine, type LineType } from '$lib/server/profiledb/tiers';
import { toE164 } from '$lib/utils/phone';
import type { IdentityMethod } from '@prisma/client';

export interface ResolveIdentityResult {
	customerProfile: any;
	confidence: number;
	method: IdentityMethod;
	isThinProfile: boolean;
	isMergeCandidate?: boolean;
	mergeCandidateProfileId?: string;
	mergeCandidateReason?: string;
	/**
	 * Telnyx line type for the calling number (§4.3a). `'unknown'` when the lookup was slow or
	 * failed — which is Tier 2, same as a landline. Never default upward.
	 */
	lineType: LineType;
	/**
	 * Whether the calling number identifies one person (a mobile) or merely a handset that a
	 * household or an office shares. Only an exclusive line can carry Tier 1.
	 */
	isExclusiveLine: boolean;
}

export async function resolveIdentityAtIntake(
	tx: any,
	input: {
		companyId: string;
		phoneNumber?: string | null;
		withheldCallerId?: boolean;
	}
): Promise<ResolveIdentityResult> {
	const db = tx || prisma;
	// Canonical E.164 for the identity key — "7052642251" and "+17052642251" must not be two
	// callers (§4.4). Falls back to the raw trimmed value if the number isn't a shape we can
	// canonicalise, so an odd number still resolves rather than being dropped.
	const phone = toE164(input.phoneNumber) || input.phoneNumber?.trim();

	if (!phone || input.withheldCallerId) {
		const thin = await db.pipelineCustomerProfile.create({
			data: {
				companyId: input.companyId,
				displayName: 'Withheld / Unknown Caller',
				tags: ['transcript_only']
			}
		});
		return {
			customerProfile: thin,
			confidence: 0.2,
			method: 'none',
			isThinProfile: true,
			// No number at all, so nothing to classify and nothing that could resolve a person.
			lineType: 'unknown',
			isExclusiveLine: false
		};
	}

	// §4.3a: the tier of this call depends on whether the line is exclusive to one person, and the
	// number itself can't tell us — portability means a mobile may carry a landline prefix. So the
	// lookup is awaited here, before any tier is derived, rather than fired off in the background.
	// It is cached, capped at 1.5s, and returns 'unknown' (i.e. Tier 2) if it can't answer in time.
	const lineType = await getLineType(phone, tx);
	const exclusive = isExclusiveLine(lineType);

	// Search by primary phone or CommIdentifier
	let profiles = await db.pipelineCustomerProfile.findMany({
		where: {
			companyId: input.companyId,
			OR: [
				{ phoneNumber: phone },
				{
					identifiers: {
						some: { kind: 'phone', value: phone }
					}
				}
			]
		},
		orderBy: { updatedAt: 'desc' }
	});

	if (profiles.length === 1) {
		return {
			customerProfile: profiles[0],
			// An exact ANI match only identifies a *person* when the line is one person's. On a
			// shared line it identifies the handset, and whoever rang from it first.
			confidence: exclusive ? 0.95 : 0.6,
			method: 'ani_exact',
			isThinProfile: false,
			lineType,
			isExclusiveLine: exclusive
		};
	}

	if (profiles.length > 1) {
		return {
			customerProfile: profiles[0], // Most recently active
			confidence: exclusive ? 0.7 : 0.5,
			method: 'ani_exact',
			isThinProfile: false,
			// Several profiles on one number is expected on a shared line — it's a household or an
			// office, not a duplicate — so don't invite a merge that would fuse two real people.
			isMergeCandidate: exclusive,
			mergeCandidateProfileId: exclusive ? profiles[1].id : undefined,
			mergeCandidateReason: exclusive ? 'multiple_profiles_matching_ani' : undefined,
			lineType,
			isExclusiveLine: exclusive
		};
	}

	// No match -> create thin profile immediately (phone + timestamp only)
	const thin = await db.pipelineCustomerProfile.create({
		data: {
			companyId: input.companyId,
			phoneNumber: phone,
			displayName: `Caller (${phone})`,
			// Recorded now because it's what decides whether this number may ever resolve a person.
			lineType,
			lookupDate: lineType === 'unknown' ? null : new Date()
		}
	});

	// Save to comm_identifiers collection as well
	// (companyId, kind, value) is unique, so a race that created this key on another profile a
	// moment ago loses here rather than producing a second record for the same person.
	await db.commIdentifier
		.create({
			data: {
				companyId: input.companyId,
				customerProfileId: thin.id,
				kind: 'phone',
				value: phone
			}
		})
		.catch((err: any) => {
			if (err?.code === 'P2002') {
				console.warn(`[identity] Phone key ${phone} already claimed by another profile`);
				return null;
			}
			throw err;
		});

	return {
		customerProfile: thin,
		confidence: exclusive ? 0.5 : 0.3,
		method: 'none',
		isThinProfile: true,
		lineType,
		isExclusiveLine: exclusive
	};
}

export async function enrichProfilePostTranscription(
	tx: any,
	input: {
		companyId: string;
		customerProfileId: string;
		extractedName?: string | null;
		extractedEmail?: string | null;
	}
): Promise<{
	updatedProfile: any;
	mergeCandidate?: {
		profileId: string;
		reason: string;
	};
}> {
	const db = tx || prisma;
	const current = await db.pipelineCustomerProfile.findUnique({
		where: { id: input.customerProfileId }
	});

	if (!current) {
		throw new Error(`Profile ${input.customerProfileId} not found for enrichment`);
	}

	const email = input.extractedEmail?.trim().toLowerCase();
	const name = input.extractedName?.trim();

	let mergeCandidate: { profileId: string; reason: string } | undefined;

	// Check if extracted email matches an existing profile with a different phone number
	if (email && email !== current.email) {
		const existingByEmail = await db.pipelineCustomerProfile.findFirst({
			where: {
				companyId: input.companyId,
				email,
				id: { not: current.id }
			}
		});

		if (existingByEmail) {
			// Spec I-3: Raised as merge candidate, NOT auto-merged!
			mergeCandidate = {
				profileId: existingByEmail.id,
				reason: `email_match (${email})`
			};
		}
	}

	// Check if name matches existing profile
	if (!mergeCandidate && name && name !== current.displayName) {
		const existingByName = await db.pipelineCustomerProfile.findFirst({
			where: {
				companyId: input.companyId,
				displayName: name,
				id: { not: current.id }
			}
		});

		if (existingByName) {
			mergeCandidate = {
				profileId: existingByName.id,
				reason: `name_match (${name})`
			};
		}
	}

	// Update current profile safely
	const updateData: any = {};
	if (name && !current.displayName?.includes(name)) {
		updateData.displayName = name;
	}
	if (email && !current.email) {
		updateData.email = email;
	}

	const updatedProfile = await db.pipelineCustomerProfile.update({
		where: { id: current.id },
		data: updateData
	});

	if (email) {
		await db.commIdentifier.upsert({
			where: {
				customerProfileId_kind_value: {
					customerProfileId: current.id,
					kind: 'email',
					value: email
				}
			},
			create: {
				companyId: input.companyId,
				customerProfileId: current.id,
				kind: 'email',
				value: email
			},
			update: {}
		}).catch(() => {});
	}

	return {
		updatedProfile,
		mergeCandidate
	};
}
