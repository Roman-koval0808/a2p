import { profileDb as prisma } from '$lib/profiledb-db';
import type { CustomerProfile } from 'profiledb-client';
import { calculateDecayedScore, getNextBucket } from './scoring.service';
import { TIER, tierForIdentifiers, groupForIdentifiers, type LineType } from './tiers';
import { toE164 } from '$lib/utils/phone';
import crypto from 'crypto';

export function isValidName(name: string): boolean {
  if (!name) return false;
  // If it's a phone number (digits, plus, spaces, hyphens, parentheses)
  const cleaned = name.replace(/[\s\-()]/g, '');
  if (/^\+?\d+$/.test(cleaned)) return false;
  // If it's just a number
  if (/^\d+$/.test(name)) return false;
  return true;
}

interface ResolveIdentityInput {
  tenantId: string;
  fingerprintId: string;
  email?: string;
  phone?: string;
  name?: string;
  group?: number;
  tier?: string;
  /**
   * Telnyx line type for `phone` (§4.3a). Supplied by the caller, because it can only be resolved
   * from the raw number and we store a hash. Omitted means unclassified, which is Tier 2 — a
   * phone alone never buys Tier 1.
   */
  lineType?: LineType;
  /** The event arrived as an inbound SMS, so the sender is a mobile and no lookup is needed. */
  inboundSms?: boolean;
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  // §4.4: the stored key is canonical E.164, so "705 264 2251" and "+17052642251" are one person.
  return toE164(phone);
}

/**
 * The normalisation this file used before canonical E.164 — it only stripped formatting, so a
 * number typed without a country code hashed differently from the same number with one.
 *
 * Kept solely so profiles hashed under the old rule are still findable. Hashes can't be recomputed
 * from the stored value, so the only migration available is to look the legacy hash up on the way
 * past and rewrite it to the canonical one.
 */
function legacyNormalizePhone(phone: string): string {
  return phone.trim().replace(/[^\d+]/g, '');
}

function legacyPhoneHash(phone: string): string | undefined {
  const legacy = legacyNormalizePhone(phone);
  if (!legacy) return undefined;
  const hash = sha256(legacy);
  return hash;
}

/**
 * Follow `mergedInto` to the record that survived.
 *
 * Retired profiles are never deleted, so old IDs in cookies, threads and task records still
 * resolve — they just resolve to whoever they were merged into. Chains are walked with a hard cap
 * so a cycle introduced by a bad merge can't hang the request.
 */
export async function resolveMergedProfile<T extends { id: string; mergedInto?: string | null }>(
  profile: T
): Promise<T> {
  let current: any = profile;
  for (let hops = 0; hops < 10; hops++) {
    if (!current?.mergedInto) return current;
    const next = await prisma.customerProfile.findUnique({ where: { id: current.mergedInto } });
    if (!next) return current;
    current = next;
  }
  console.warn(`[Identity Resolution] mergedInto chain too long from ${profile.id} — stopping`);
  return current;
}

/**
 * Resolves the identity of a customer profile.
 * - Finds or creates a profile for the given fingerprint.
 * - Merges profiles if identifiers (email/phone) match an existing known profile.
 */
export async function resolveCustomerProfile(input: ResolveIdentityInput): Promise<CustomerProfile> {
  const { tenantId, fingerprintId, email, phone, name } = input;

  const normalizedEmail = email ? normalizeEmail(email) : undefined;
  const normalizedPhone = phone ? normalizePhone(phone) : undefined;
  const hashedEmail = normalizedEmail ? sha256(normalizedEmail) : undefined;
  const hashedPhone = normalizedPhone ? sha256(normalizedPhone) : undefined;

  // 1. Process Anonymous / Session Resolution
  // Check if fingerprint is already mapped to a profile
  const existingFingerprint = await prisma.deviceFingerprint.findUnique({
    where: { fingerprintId },
    include: { customerProfile: true },
  });

  let currentProfile: CustomerProfile;

  if (existingFingerprint) {
    // The fingerprint may still point at a record that has since been retired into another —
    // follow the trail rather than reviving a tombstone.
    currentProfile = await resolveMergedProfile(existingFingerprint.customerProfile);
    // Update lastSeenAt for fingerprint
    await prisma.deviceFingerprint.update({
      where: { fingerprintId },
      data: { lastSeenAt: new Date() },
    });
  } else {
    // Attempt to create the profile and link the fingerprint.
    // Wrap in a transaction to rollback profile creation if fingerprint linking fails.
    try {
      currentProfile = await prisma.$transaction(async (tx) => {
        const profile = await tx.customerProfile.create({
          data: {
            tenantId,
            intentBucket: 'unclassified',
            scoreRaw: 0,
            scoreLive: 0,
            lastEventAt: new Date(),
            group: 2,
            tier: TIER.ANON_ENGAGED,
          },
        });

        await tx.deviceFingerprint.create({
          data: {
            fingerprintId,
            customerProfileId: profile.id,
          },
        });

        return profile;
      });
    } catch (err: any) {
      // If it's a unique constraint violation on fingerprintId (Prisma code P2002),
      // it means another concurrent request succeeded first. Fetch the profile it created.
      if (err.code === 'P2002' || err.message?.includes('Unique constraint')) {
        const retryFingerprint = await prisma.deviceFingerprint.findUnique({
          where: { fingerprintId },
          include: { customerProfile: true },
        });
        if (retryFingerprint) {
          currentProfile = await resolveMergedProfile(retryFingerprint.customerProfile);
          await prisma.deviceFingerprint.update({
            where: { fingerprintId },
            data: { lastSeenAt: new Date() },
          });
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }
  }

  // If no identifiers provided, return the resolved profile
  if (!hashedEmail && !hashedPhone) {
    return currentProfile;
  }

  // 2. Query for existing matches by email/phone under this tenant
  let profileByEmail: CustomerProfile | null = null;
  let profileByPhone: CustomerProfile | null = null;

  if (hashedEmail) {
    profileByEmail = await prisma.customerProfile.findUnique({
      where: {
        tenantId_email: { tenantId, email: hashedEmail },
      },
    });
  }

  if (hashedPhone) {
    profileByPhone = await prisma.customerProfile.findUnique({
      where: {
        tenantId_phone: { tenantId, phone: hashedPhone },
      },
    });

    // Nothing under the canonical hash may still mean we know this person — under the pre-E.164
    // hash. Check before concluding they're new, or the normalisation fix would itself fork the
    // record it exists to prevent.
    if (!profileByPhone && phone) {
      const legacy = legacyPhoneHash(phone);
      if (legacy && legacy !== hashedPhone) {
        const legacyMatch = await prisma.customerProfile.findUnique({
          where: { tenantId_phone: { tenantId, phone: legacy } },
        });
        if (legacyMatch) {
          // Rewrite in place so this profile is canonical from here on and the legacy path is
          // walked once per person, not on every event.
          profileByPhone = await prisma.customerProfile.update({
            where: { id: legacyMatch.id },
            data: { phone: hashedPhone },
          });
          console.log(
            `[Identity Resolution] Rehashed legacy phone key to canonical E.164 for profile ${legacyMatch.id}`
          );
        }
      }
    }
  }

  // --- Scenario A: New Identity (Identifiers don't match any existing profile) ---
  if (!profileByEmail && !profileByPhone) {
    // Update the current profile with the new identifiers
    const updateData: any = {};
    if (hashedEmail) updateData.email = hashedEmail;
    if (hashedPhone) updateData.phone = hashedPhone;
    if (name && isValidName(name)) updateData.name = name;

    // Resolve Q2 Tier & Group. A phone only reaches Tier 1 on a mobile line (§4.3a).
    const tierInput = {
      hasEmail: !!hashedEmail,
      hasPhone: !!hashedPhone,
      lineType: input.lineType,
      inboundSms: input.inboundSms,
      hasName: !!(name && isValidName(name)),
      currentTier: currentProfile.tier
    };
    updateData.tier = tierForIdentifiers(tierInput);
    updateData.group = input.group || groupForIdentifiers(tierInput);
    if (hashedPhone && input.lineType) updateData.lineType = input.lineType;

    currentProfile = await prisma.customerProfile.update({
      where: { id: currentProfile.id },
      data: updateData,
    });

    return currentProfile;
  }

  // --- Conflict Resolution & Scenario B: Existing Identity Match ---
  // Determine target primary profile to merge into.
  // If email exists, it takes precedence. Otherwise, use phone.
  const targetProfile = profileByEmail || profileByPhone!;
  const profilesToDelete: string[] = [];

  // Identify profiles to merge into targetProfile
  const sourceProfileIds = new Set<string>();

  if (currentProfile.id !== targetProfile.id) {
    sourceProfileIds.add(currentProfile.id);
    profilesToDelete.push(currentProfile.id);
  }

  // If we have separate email and phone profiles, merge phone profile into email profile
  if (profileByEmail && profileByPhone && profileByEmail.id !== profileByPhone.id) {
    sourceProfileIds.add(profileByPhone.id);
    profilesToDelete.push(profileByPhone.id);
  }

  if (sourceProfileIds.size > 0) {
    const sourceIds = Array.from(sourceProfileIds);
    console.log(`[Identity Resolution] MERGING PROFILES. targetProfileId=${targetProfile.id} (${targetProfile.name || 'Anonymous'}), sourceIds=${sourceIds.join(', ')}`);
    console.log(`[Identity Resolution] Merging Inputs: email=${email}, phone=${phone}, name=${name}`);

    // Point the keys at the survivor and retire the losers — never delete them. Old profile IDs
    // are sitting in cookies, conversation threads and task records, and looking one up has to
    // keep working; `mergedInto` is the trail that makes that possible.
    const { totalScore, latestEventAt } = await prisma.$transaction(async (tx) => {
      // 1. Fingerprints follow the person — this is what carries the other device across.
      await tx.deviceFingerprint.updateMany({
        where: { customerProfileId: { in: sourceIds } },
        data: { customerProfileId: targetProfile.id },
      });

      // 2. So does every event. Moving the activity is what makes the score correct below.
      await tx.telemetryEvent.updateMany({
        where: { customerProfileId: { in: sourceIds } },
        data: { customerProfileId: targetProfile.id },
      });

      // 3. Retire the sources. They give up their identifiers first, because (tenantId, email) and
      //    (tenantId, phone) are unique and the survivor is about to claim them.
      await tx.customerProfile.updateMany({
        where: { id: { in: sourceIds } },
        data: {
          email: null,
          phone: null,
          mergedInto: targetProfile.id,
        },
      });

      // 4. Let the score fall out of the merged activity rather than adding the two totals up.
      //    Adding double-counts the moment anything overlaps, and every event now hangs off the
      //    survivor, so summing them is both simpler and right.
      const agg = await tx.telemetryEvent.aggregate({
        where: { customerProfileId: targetProfile.id },
        _sum: { scoreDelta: true },
        _max: { occurredAt: true },
      });

      return {
        totalScore: agg._sum.scoreDelta ?? 0,
        latestEventAt: agg._max.occurredAt ?? null,
      };
    });

    const newScoreRaw = Math.min(Math.max(totalScore, 0), 100);

    // The merged record belongs to somebody who was active at the most recent of the two, so the
    // decay clock restarts from there — an old fragment stops ageing out on its own timeline.
    let latestEventDate = latestEventAt ?? targetProfile.lastEventAt;
    for (const p of [currentProfile, profileByEmail, profileByPhone]) {
      if (p && p.lastEventAt > latestEventDate) latestEventDate = p.lastEventAt;
    }

    // Update targetProfile details with merged score/identifiers
    const updateData: any = {
      scoreRaw: newScoreRaw,
      lastEventAt: latestEventDate,
    };

    // Merge email, phone, and name, preserving the best available values
    const mergedEmail = targetProfile.email || hashedEmail || currentProfile.email || (profileByPhone ? profileByPhone.email : null);
    const mergedPhone = targetProfile.phone || hashedPhone || currentProfile.phone || (profileByEmail ? profileByEmail.phone : null);
    const mergedName = (name && isValidName(name) ? name : null) ||
                       (targetProfile.name && isValidName(targetProfile.name) ? targetProfile.name : null) ||
                       (currentProfile.name && isValidName(currentProfile.name) ? currentProfile.name : null) ||
                       (profileByPhone?.name && isValidName(profileByPhone.name) ? profileByPhone.name : null) ||
                       (profileByEmail?.name && isValidName(profileByEmail.name) ? profileByEmail.name : null);

    console.log(`[Identity Resolution] Resolved Merged Fields: name=${mergedName}, phone=${mergedPhone}, email=${mergedEmail}`);

    if (mergedEmail) updateData.email = mergedEmail;
    if (mergedPhone) updateData.phone = mergedPhone;
    if (mergedName && mergedName !== '—') updateData.name = mergedName;

    // Resolve Q2 Tier & Group. The merged record inherits the best line type either side knew —
    // a mobile learned on one of them makes the survivor Tier 1; neither knowing keeps it Tier 2.
    const mergedLineType =
      input.lineType ||
      (targetProfile as any).lineType ||
      (currentProfile as any).lineType ||
      undefined;
    const tierInput = {
      hasEmail: !!mergedEmail,
      hasPhone: !!mergedPhone,
      lineType: mergedLineType as LineType | undefined,
      inboundSms: input.inboundSms,
      hasName: !!mergedName,
      // Tier 1 already earned on either side survives the merge.
      currentTier:
        targetProfile.tier === TIER.IDENTIFIED || currentProfile.tier === TIER.IDENTIFIED
          ? TIER.IDENTIFIED
          : targetProfile.tier
    };
    updateData.tier = tierForIdentifiers(tierInput);
    updateData.group = input.group || targetProfile.group || groupForIdentifiers(tierInput);
    if (mergedLineType) updateData.lineType = mergedLineType;

    // Calculate new live score and intent bucket
    const currentLiveScore = calculateDecayedScore(newScoreRaw, latestEventDate, targetProfile.intentBucket);
    updateData.scoreLive = currentLiveScore;
    // A merge is not an event and carries no bucket signal, so the bucket is whatever the surviving
    // record already held. (This previously passed the score in the signal argument, which fell
    // through to the same answer by accident.)
    updateData.intentBucket = getNextBucket(targetProfile.intentBucket, null);

    const updatedTarget = await prisma.customerProfile.update({
      where: { id: targetProfile.id },
      data: updateData,
    });
    console.log(`[Identity Resolution] MERGE COMPLETED. Target Profile updated:`, {
      id: updatedTarget.id,
      name: updatedTarget.name,
      phone: updatedTarget.phone,
      email: updatedTarget.email,
      tier: updatedTarget.tier,
      group: updatedTarget.group,
      scoreLive: updatedTarget.scoreLive,
      intentBucket: updatedTarget.intentBucket
    });

    return updatedTarget;
  } else {
    // Current profile is already the target profile, just update fields if needed
    console.log(`[Identity Resolution] UPDATE PROFILE (already target). targetProfileId=${targetProfile.id} (${targetProfile.name || 'Anonymous'})`);
    const updateData: any = {};
    const mergedEmail = targetProfile.email || hashedEmail;
    const mergedPhone = targetProfile.phone || hashedPhone;
    const mergedName = (name && isValidName(name) ? name : null) ||
                       (targetProfile.name && isValidName(targetProfile.name) ? targetProfile.name : null);

    if (mergedEmail && mergedEmail !== targetProfile.email) updateData.email = mergedEmail;
    if (mergedPhone && mergedPhone !== targetProfile.phone) updateData.phone = mergedPhone;
    if (mergedName && mergedName !== '—' && mergedName !== targetProfile.name) updateData.name = mergedName;

    // Resolve Q2 Tier & Group (§4.3a — a phone is only Tier 1 on a mobile line).
    const lineType = (input.lineType || (targetProfile as any).lineType || undefined) as
      | LineType
      | undefined;
    const tierInput = {
      hasEmail: !!mergedEmail,
      hasPhone: !!mergedPhone,
      lineType,
      inboundSms: input.inboundSms,
      hasName: !!mergedName,
      currentTier: targetProfile.tier
    };
    const nextTier = tierForIdentifiers(tierInput);
    if (nextTier !== targetProfile.tier) updateData.tier = nextTier;
    const nextGroup = input.group || targetProfile.group || groupForIdentifiers(tierInput);
    if (nextGroup !== targetProfile.group) updateData.group = nextGroup;
    if (input.lineType && input.lineType !== (targetProfile as any).lineType) {
      updateData.lineType = input.lineType;
    }

    if (Object.keys(updateData).length > 0) {
      const updated = await prisma.customerProfile.update({
        where: { id: targetProfile.id },
        data: updateData,
      });
      console.log(`[Identity Resolution] PROFILE UPDATED:`, {
        id: updated.id,
        name: updated.name,
        phone: updated.phone,
        email: updated.email,
        tier: updated.tier,
        group: updated.group
      });
      return updated;
    }

    return targetProfile;
  }
}
