import { prisma } from '$lib/db';

/**
 * Profile merging. Identity resolution never merges on its own — two people can share a phone
 * number, and a bad auto-merge silently fuses two customers' histories. It raises candidates
 * (see identity-service) and a human resolves them here.
 *
 * A merge repoints everything that hangs off the duplicate onto the survivor, unions the field
 * data, then tombstones the duplicate via `mergedInto` rather than deleting it — merges get
 * reversed, and the snapshot stored on the candidate is what makes that possible.
 */

export interface MergeCandidateInput {
	companyId: string;
	primaryProfileId: string;
	duplicateProfileId: string;
	reason: string;
	detectedFromCommId?: string;
}

/**
 * Persist a candidate. Idempotent: the same pair surfacing on every subsequent email must not
 * pile up rows, and must not resurrect a pair someone already dismissed.
 */
export async function recordMergeCandidate(input: MergeCandidateInput) {
	const { companyId, primaryProfileId, duplicateProfileId, reason, detectedFromCommId } = input;
	if (!primaryProfileId || !duplicateProfileId || primaryProfileId === duplicateProfileId) {
		return null;
	}

	// The pair is unordered — A/B and B/A are the same duplicate. Normalize so the unique
	// constraint actually catches repeats regardless of which side was seen first.
	const [a, b] = [primaryProfileId, duplicateProfileId].sort();

	try {
		const existing = await prisma.profileMergeCandidate.findUnique({
			where: {
				companyId_primaryProfileId_duplicateProfileId: {
					companyId,
					primaryProfileId: a,
					duplicateProfileId: b
				}
			}
		});
		if (existing) return existing;

		return await prisma.profileMergeCandidate.create({
			data: {
				companyId,
				primaryProfileId: a,
				duplicateProfileId: b,
				reason,
				detectedFromCommId
			}
		});
	} catch (err) {
		// Never let candidate bookkeeping break the ingest path that raised it.
		console.error('[merge-service] Failed to record merge candidate:', err);
		return null;
	}
}

export interface MergeResult {
	survivorId: string;
	mergedId: string;
	moved: {
		identifiers: number;
		containers: number;
		events: number;
	};
}

/**
 * Fold `duplicateId` into `survivorId`. Both must belong to `companyId`.
 *
 * Field policy: the survivor wins every scalar it already has a value for; the duplicate only
 * fills blanks. Attributes/tags/metadata are unioned (survivor wins on key collisions) so nothing
 * the duplicate learned is thrown away.
 */
export async function mergeProfiles(input: {
	companyId: string;
	survivorId: string;
	duplicateId: string;
	userId?: string;
	candidateId?: string;
}): Promise<MergeResult> {
	const { companyId, survivorId, duplicateId, userId, candidateId } = input;

	if (survivorId === duplicateId) {
		throw new Error('Cannot merge a profile into itself');
	}

	return await prisma.$transaction(async (tx) => {
		const [survivor, duplicate] = await Promise.all([
			tx.pipelineCustomerProfile.findFirst({ where: { id: survivorId, companyId } }),
			tx.pipelineCustomerProfile.findFirst({ where: { id: duplicateId, companyId } })
		]);

		if (!survivor) throw new Error(`Survivor profile ${survivorId} not found for this company`);
		if (!duplicate) throw new Error(`Duplicate profile ${duplicateId} not found for this company`);
		if (duplicate.mergedInto) throw new Error(`Profile ${duplicateId} was already merged`);
		if (survivor.mergedInto) throw new Error(`Profile ${survivorId} is itself a merged tombstone`);

		// Snapshot before anything moves — this is the only record of what the duplicate was.
		const movedIdentifiers = await tx.commIdentifier.findMany({
			where: { customerProfileId: duplicateId },
			select: { id: true, kind: true, value: true }
		});
		const movedContainers = await tx.commContainer.findMany({
			where: { customerProfileId: duplicateId },
			select: { id: true }
		});
		const movedEvents = await tx.pipelineEvent.findMany({
			where: { customerProfileId: duplicateId },
			select: { id: true }
		});

		// Identifiers: the survivor may already hold the same kind+value (that's often exactly why
		// the pair was flagged), and (profile, kind, value) is unique — so move what's new and drop
		// what would collide.
		const survivorIdentifiers = await tx.commIdentifier.findMany({
			where: { customerProfileId: survivorId },
			select: { kind: true, value: true }
		});
		const survivorKeys = new Set(survivorIdentifiers.map((i) => `${i.kind}:${i.value}`));

		let identifiersMoved = 0;
		for (const ident of movedIdentifiers) {
			if (survivorKeys.has(`${ident.kind}:${ident.value}`)) {
				await tx.commIdentifier.delete({ where: { id: ident.id } });
				continue;
			}
			await tx.commIdentifier.update({
				where: { id: ident.id },
				data: { customerProfileId: survivorId }
			});
			identifiersMoved++;
		}

		const containers = await tx.commContainer.updateMany({
			where: { customerProfileId: duplicateId },
			data: { customerProfileId: survivorId }
		});
		const events = await tx.pipelineEvent.updateMany({
			where: { customerProfileId: duplicateId },
			data: { customerProfileId: survivorId }
		});

		// Union the field data. Survivor wins; duplicate fills gaps.
		const survivorAttrs = (survivor.attributes as Record<string, unknown>) || {};
		const duplicateAttrs = (duplicate.attributes as Record<string, unknown>) || {};
		const survivorMeta = (survivor.metadata as Record<string, unknown>) || {};
		const duplicateMeta = (duplicate.metadata as Record<string, unknown>) || {};
		const survivorTags = Array.isArray(survivor.tags) ? (survivor.tags as unknown[]) : [];
		const duplicateTags = Array.isArray(duplicate.tags) ? (duplicate.tags as unknown[]) : [];

		// (companyId, email) and (companyId, phoneNumber) are unique — the duplicate has to give up
		// its identifiers before the survivor can take them, so clear it first in the same tx.
		await tx.pipelineCustomerProfile.update({
			where: { id: duplicateId },
			data: {
				email: null,
				phoneNumber: null,
				mergedInto: survivorId,
				status: 'merged'
			}
		});

		const updatedSurvivor = await tx.pipelineCustomerProfile.update({
			where: { id: survivorId },
			data: {
				firstName: survivor.firstName ?? duplicate.firstName,
				lastName: survivor.lastName ?? duplicate.lastName,
				displayName: survivor.displayName ?? duplicate.displayName,
				email: survivor.email ?? duplicate.email,
				phoneNumber: survivor.phoneNumber ?? duplicate.phoneNumber,
				externalId: survivor.externalId ?? duplicate.externalId,
				lineType: survivor.lineType ?? duplicate.lineType,
				carrier: survivor.carrier ?? duplicate.carrier,
				smsCapable: survivor.smsCapable ?? duplicate.smsCapable,
				// Consent is the one field where the duplicate can override: if either profile
				// granted consent it stands, and we keep whichever source recorded it.
				smsConsent: survivor.smsConsent || duplicate.smsConsent,
				consentSource: survivor.consentSource ?? duplicate.consentSource,
				attributes: { ...duplicateAttrs, ...survivorAttrs } as any,
				metadata: { ...duplicateMeta, ...survivorMeta } as any,
				tags: Array.from(new Set([...survivorTags, ...duplicateTags])) as any
			}
		});

		const snapshot = {
			mergedAt: new Date().toISOString(),
			duplicate: {
				id: duplicate.id,
				email: duplicate.email,
				phoneNumber: duplicate.phoneNumber,
				displayName: duplicate.displayName,
				status: duplicate.status,
				attributes: duplicateAttrs,
				metadata: duplicateMeta,
				tags: duplicateTags
			},
			moved: {
				identifierIds: movedIdentifiers.map((i) => i.id),
				containerIds: movedContainers.map((c) => c.id),
				eventIds: movedEvents.map((e) => e.id)
			}
		};

		if (candidateId) {
			await tx.profileMergeCandidate.update({
				where: { id: candidateId },
				data: {
					status: 'merged',
					resolvedByUserId: userId,
					resolvedAt: new Date(),
					primaryProfileId: survivorId,
					duplicateProfileId: duplicateId,
					mergeSnapshot: snapshot as any
				}
			});
		}

		// Any other pending candidate naming the now-tombstoned profile is moot.
		await tx.profileMergeCandidate.updateMany({
			where: {
				companyId,
				status: 'pending',
				OR: [{ primaryProfileId: duplicateId }, { duplicateProfileId: duplicateId }],
				...(candidateId ? { id: { not: candidateId } } : {})
			},
			data: { status: 'dismissed', resolvedAt: new Date(), resolvedByUserId: userId }
		});

		console.log(
			`[merge-service] Merged ${duplicateId} → ${survivorId} (identifiers ${identifiersMoved}, containers ${containers.count}, events ${events.count})`
		);

		return {
			survivorId: updatedSurvivor.id,
			mergedId: duplicateId,
			moved: {
				identifiers: identifiersMoved,
				containers: containers.count,
				events: events.count
			}
		};
	});
}

/** Reject a candidate so the same pair stops resurfacing on every new message. */
export async function dismissMergeCandidate(input: {
	companyId: string;
	candidateId: string;
	userId?: string;
}) {
	const { companyId, candidateId, userId } = input;
	const candidate = await prisma.profileMergeCandidate.findFirst({
		where: { id: candidateId, companyId }
	});
	if (!candidate) throw new Error('Merge candidate not found');

	return await prisma.profileMergeCandidate.update({
		where: { id: candidateId },
		data: { status: 'dismissed', resolvedByUserId: userId, resolvedAt: new Date() }
	});
}

/** Pending candidates with both profiles hydrated, for the review screen. */
export async function listMergeCandidates(companyId: string, status = 'pending') {
	const candidates = await prisma.profileMergeCandidate.findMany({
		where: { companyId, status },
		orderBy: { createdAt: 'desc' },
		take: 100
	});

	const ids = Array.from(
		new Set(candidates.flatMap((c) => [c.primaryProfileId, c.duplicateProfileId]))
	);
	const profiles = await prisma.pipelineCustomerProfile.findMany({
		where: { id: { in: ids } },
		select: {
			id: true,
			displayName: true,
			firstName: true,
			lastName: true,
			email: true,
			phoneNumber: true,
			status: true,
			mergedInto: true,
			attributes: true,
			createdAt: true,
			updatedAt: true,
			_count: { select: { identifiers: true, commContainers: true, events: true } }
		}
	});
	const byId = new Map(profiles.map((p) => [p.id, p]));

	return candidates
		.map((c) => ({
			...c,
			primary: byId.get(c.primaryProfileId) ?? null,
			duplicate: byId.get(c.duplicateProfileId) ?? null
		}))
		// A profile can be deleted out from under a stale candidate; nothing to review then.
		.filter((c) => c.primary && c.duplicate);
}
