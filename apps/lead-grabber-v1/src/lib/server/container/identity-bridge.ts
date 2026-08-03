// Feed a cross-channel container match back into profile identity resolution.
//
// Identity merging (profiledb identity.service) only fuses an email profile with a phone profile
// when ONE event carries BOTH identifiers. Our flows never do: an outbound email supplies only an
// address, an inbound call/SMS only a number. So the same human ends up with two profiles.
//
// The container matcher is the one place that concludes "these are the same conversation, so the
// same person". This module turns that conclusion into an identity merge — by handing both
// identifiers to the existing, tested resolveCustomerProfile merge path rather than duplicating
// merge logic here.
//
// IRREVERSIBLE: the merge deletes the source profile. It is therefore gated on a confidence bar
// well above the one used to link containers, and every attempt is logged.

import { prisma } from '$lib/db';

/**
 * Linking containers is cheap to undo; merging profiles is not. Require materially more certainty
 * than MIN_CONFIDENCE (0.6) before deleting anyone's profile.
 */
export const IDENTITY_MERGE_MIN_CONFIDENCE = 0.85;

export interface IdentityBridgeResult {
	merged: boolean;
	reason: string;
	profileId?: string;
}

/**
 * Given a container the incoming message was just linked to, merge the identity behind THAT
 * container with the identity behind the message.
 *
 * `phone` / `email` are the incoming message's identifiers; the counterpart identifier is read off
 * the matched container's contact/profile. A merge only happens when the two together give us both
 * an email and a phone that are not already on one profile.
 */
export async function bridgeIdentitiesForMatchedContainer(input: {
	companyId: string;
	containerId: string;
	confidence?: number;
	phone?: string | null;
	email?: string | null;
	log?: (msg: string) => void;
}): Promise<IdentityBridgeResult> {
	const olog = input.log || (() => {});

	const confidence = input.confidence ?? 0;
	if (confidence < IDENTITY_MERGE_MIN_CONFIDENCE) {
		return {
			merged: false,
			reason: `confidence ${confidence.toFixed(2)} < ${IDENTITY_MERGE_MIN_CONFIDENCE}`
		};
	}

	const container = await prisma.commContainer.findUnique({
		where: { id: input.containerId },
		include: { contact: true, customerProfile: true }
	});
	if (!container) return { merged: false, reason: 'container_not_found' };

	// Identifiers from the matched conversation's side.
	const otherEmail =
		(container.contact as any)?.email || (container.customerProfile as any)?.email || null;
	const otherPhone =
		(container.contact as any)?.phone || (container.customerProfile as any)?.phoneNumber || null;

	// Union of both sides — the whole point is that each side knows only one identifier.
	const email = (input.email || otherEmail || '').trim().toLowerCase() || null;
	const phone = (input.phone || otherPhone || '').trim() || null;

	if (!email || !phone) {
		return { merged: false, reason: 'need_both_email_and_phone' };
	}

	const { resolveCustomerProfile, sha256, normalizeEmail, normalizePhone } = await import(
		'$lib/server/profiledb/identity.service'
	);
	const { profileDb } = await import('$lib/profiledb-db');

	const hashedEmail = sha256(normalizeEmail(email));
	const hashedPhone = sha256(normalizePhone(phone));

	const [byEmail, byPhone] = await Promise.all([
		profileDb.customerProfile.findFirst({ where: { email: hashedEmail } }),
		profileDb.customerProfile.findFirst({ where: { phone: hashedPhone } })
	]);

	if (!byEmail || !byPhone) return { merged: false, reason: 'no_second_profile_to_merge' };
	if (byEmail.id === byPhone.id) {
		return { merged: false, reason: 'already_one_profile', profileId: byEmail.id };
	}

	// Reuse an existing fingerprint of the phone profile so resolveCustomerProfile resolves to it
	// and then merges it into the email profile (email takes precedence there).
	const fingerprint = await profileDb.deviceFingerprint.findFirst({
		where: { customerProfileId: byPhone.id },
		orderBy: { lastSeenAt: 'desc' }
	});
	if (!fingerprint) return { merged: false, reason: 'no_fingerprint_for_phone_profile' };

	olog(
		`[IdentityBridge] Merging profiles on container match (confidence ${confidence.toFixed(2)}): ` +
			`phone profile ${byPhone.id} -> email profile ${byEmail.id}.`
	);

	const profile = await resolveCustomerProfile({
		tenantId: byPhone.tenantId,
		fingerprintId: fingerprint.fingerprintId,
		email,
		phone
	});

	return { merged: true, reason: 'merged_on_container_match', profileId: profile.id };
}
