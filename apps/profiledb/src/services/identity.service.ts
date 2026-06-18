import prisma from '../config/prisma';
import { CustomerProfile } from '@prisma/client';
import { calculateDecayedScore, getNextBucket } from './scoring.service';
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
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  // Normalize to E.164 format: keep leading '+' if present and digits.
  const cleaned = phone.trim().replace(/[^\d+]/g, '');
  return cleaned;
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
    currentProfile = existingFingerprint.customerProfile;
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
            tier: 'Tier 2B',
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
          currentProfile = retryFingerprint.customerProfile;
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
  }

  // --- Scenario A: New Identity (Identifiers don't match any existing profile) ---
  if (!profileByEmail && !profileByPhone) {
    // Update the current profile with the new identifiers
    const updateData: any = {};
    if (hashedEmail) updateData.email = hashedEmail;
    if (hashedPhone) updateData.phone = hashedPhone;
    if (name && isValidName(name)) updateData.name = name;

    // Resolve Q2 Tier & Group Upgrades
    if (hashedEmail || hashedPhone) {
      updateData.tier = 'Tier 1';
      updateData.group = input.group || (phone ? 3 : 2);
    } else if (name && currentProfile.tier === 'Tier 2B') {
      updateData.tier = 'Tier 2A';
      updateData.group = 4;
    }

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

    // Merge in transactions
    await prisma.$transaction(async (tx) => {
      // 1. Update DeviceFingerprints to point to targetProfile
      await tx.deviceFingerprint.updateMany({
        where: { customerProfileId: { in: sourceIds } },
        data: { customerProfileId: targetProfile.id },
      });

      // 2. Update TelemetryEvents to point to targetProfile
      await tx.telemetryEvent.updateMany({
        where: { customerProfileId: { in: sourceIds } },
        data: { customerProfileId: targetProfile.id },
      });

      // 3. Delete merged customer profiles
      await tx.customerProfile.deleteMany({
        where: { id: { in: sourceIds } },
      });
    });

    // Re-calculate raw score and updates for the targetProfile
    // Since they're already deleted in transaction above, we calculate from original values in memory
    // Let's add up raw scores
    let additionalRawScore = 0;
    let latestEventDate = targetProfile.lastEventAt;

    if (currentProfile.id !== targetProfile.id) {
      additionalRawScore += currentProfile.scoreRaw;
      if (currentProfile.lastEventAt > latestEventDate) {
        latestEventDate = currentProfile.lastEventAt;
      }
    }
    if (profileByEmail && profileByPhone && profileByEmail.id !== profileByPhone.id) {
      additionalRawScore += profileByPhone.scoreRaw;
      if (profileByPhone.lastEventAt > latestEventDate) {
        latestEventDate = profileByPhone.lastEventAt;
      }
    }

    const newScoreRaw = Math.min(targetProfile.scoreRaw + additionalRawScore, 100);

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

    // Resolve Q2 Tier & Group Upgrades
    if (mergedEmail || mergedPhone) {
      updateData.tier = 'Tier 1';
      updateData.group = input.group || targetProfile.group || (phone || targetProfile.phone ? 3 : 2);
    } else if (mergedName && targetProfile.tier === 'Tier 2B') {
      updateData.tier = 'Tier 2A';
      updateData.group = 4;
    }

    // Calculate new live score and intent bucket
    const currentLiveScore = calculateDecayedScore(newScoreRaw, latestEventDate, targetProfile.intentBucket);
    updateData.scoreLive = currentLiveScore;
    updateData.intentBucket = getNextBucket(targetProfile.intentBucket, currentLiveScore, '');

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

    // Resolve Q2 Tier & Group Upgrades
    if (mergedEmail || mergedPhone) {
      updateData.tier = 'Tier 1';
      updateData.group = input.group || targetProfile.group || (phone || targetProfile.phone ? 3 : 2);
    } else if (mergedName && targetProfile.tier === 'Tier 2B') {
      updateData.tier = 'Tier 2A';
      updateData.group = 4;
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
