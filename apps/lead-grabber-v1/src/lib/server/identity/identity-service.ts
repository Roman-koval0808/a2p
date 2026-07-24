import { prisma } from '$lib/db';
import { lookupNumberCached } from '$lib/server/number-lookup';
import type { IdentityMethod } from '@prisma/client';

export interface ResolveIdentityResult {
	customerProfile: any;
	confidence: number;
	method: IdentityMethod;
	isThinProfile: boolean;
	isMergeCandidate?: boolean;
	mergeCandidateProfileId?: string;
	mergeCandidateReason?: string;
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
	const phone = input.phoneNumber?.trim();

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
			isThinProfile: true
		};
	}

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
		// Trigger background cached number lookup
		lookupNumberCached(input.companyId, phone).catch(() => {});
		return {
			customerProfile: profiles[0],
			confidence: 0.95,
			method: 'ani_exact',
			isThinProfile: false
		};
	}

	if (profiles.length > 1) {
		lookupNumberCached(input.companyId, phone).catch(() => {});
		return {
			customerProfile: profiles[0], // Most recently active
			confidence: 0.7,
			method: 'ani_exact',
			isThinProfile: false,
			isMergeCandidate: true,
			mergeCandidateProfileId: profiles[1].id,
			mergeCandidateReason: 'multiple_profiles_matching_ani'
		};
	}

	// No match -> create thin profile immediately (phone + timestamp only)
	const thin = await db.pipelineCustomerProfile.create({
		data: {
			companyId: input.companyId,
			phoneNumber: phone,
			displayName: `Caller (${phone})`
		}
	});

	// Save to comm_identifiers collection as well
	await db.commIdentifier.create({
		data: {
			customerProfileId: thin.id,
			kind: 'phone',
			value: phone
		}
	});

	lookupNumberCached(input.companyId, phone).catch(() => {});

	return {
		customerProfile: thin,
		confidence: 0.5,
		method: 'none',
		isThinProfile: true
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
