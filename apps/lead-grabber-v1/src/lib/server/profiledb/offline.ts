import { randomUUID } from 'crypto';
import { profileDb as prisma } from '$lib/profiledb-db';
import { resolveCustomerProfile, sha256, normalizeEmail, normalizePhone } from './identity.service';

interface CreateOfflineRepEntryInput {
  name?: string;
  email?: string;
  phone?: string;
  serviceDiscussed?: string;
  source?: string;             // e.g. "door_knock" | "trade_show" | "referral" | "phone_call"
  conversationNotes?: string;
}

/**
 * POST /api/v1/tenants/:tenantSlug/profiles/offline
 *
 * Build 8 — P24: Offline rep entry.
 * Allows a sales rep or consultant to manually create or retrieve a customer
 * profile from a face-to-face or phone conversation, without a browser session.
 *
 * - Hashes email and phone before any DB operation.
 * - Sets profile_origin = "offline_rep_entry" on new profiles.
 * - If an existing profile is found by email/phone hash, returns it with a
 *   `conflict: true` flag so the rep can review/confirm rather than duplicate.
 * - Generates a deterministic synthetic fingerprintId from the email or phone
 *   hash so the profile can be linked to future browser sessions if the contact
 *   later arrives via pixel or JWT link.
 * - Returns a JWT-ready profile ID that can be used in subsequent cs_token
 *   campaign dispatch (the JWT minting itself is handled by the campaign layer).
 */
export async function createOfflineRepEntry(
  tenantSlug: string,
  input: CreateOfflineRepEntryInput
): Promise<{ status: number; body: any }> {
  const traceId = `trc_offline_${randomUUID().replace(/-/g, '').slice(0, 10)}`;

  try {
    const {
      name,
      email,
      phone,
      serviceDiscussed,
      source,             // e.g. "door_knock" | "trade_show" | "referral" | "phone_call"
      conversationNotes,
    } = input;

    // ── Validate required fields ──────────────────────────────────────────────
    if (typeof tenantSlug !== 'string' || tenantSlug.trim() === '') {
      return { status: 400, body: { error: 'tenantSlug is required.', trace_id: traceId } };
    }
    if (!name && !email && !phone) {
      return {
        status: 400,
        body: {
          error: 'At least one of name, email, or phone is required for offline entry.',
          trace_id: traceId,
        },
      };
    }

    // ── Resolve or create tenant ──────────────────────────────────────────────
    let tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          slug: tenantSlug,
          name: tenantSlug.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        },
      });
    }

    // ── Hash PII before any DB query ─────────────────────────────────────────
    const normalizedEmail = email ? normalizeEmail(email) : undefined;
    const normalizedPhone = phone ? normalizePhone(phone) : undefined;
    const hashedEmail = normalizedEmail ? sha256(normalizedEmail) : undefined;
    const hashedPhone = normalizedPhone ? sha256(normalizedPhone) : undefined;

    // ── Check for existing profile ────────────────────────────────────────────
    let existingProfile = null;
    if (hashedEmail) {
      existingProfile = await prisma.customerProfile.findUnique({
        where: { tenantId_email: { tenantId: tenant.id, email: hashedEmail } },
      });
    }
    if (!existingProfile && hashedPhone) {
      existingProfile = await prisma.customerProfile.findUnique({
        where: { tenantId_phone: { tenantId: tenant.id, phone: hashedPhone } },
      });
    }

    // ── Conflict: return existing for rep confirmation ────────────────────────
    if (existingProfile) {
      return {
        status: 200,
        body: {
          conflict: true,
          message: 'An existing profile was found matching the provided email or phone. Please review and confirm.',
          trace_id: traceId,
          profile: {
            id: existingProfile.id,
            name: existingProfile.name,
            tier: existingProfile.tier,
            group: existingProfile.group,
            intentBucket: existingProfile.intentBucket,
            scoreLive: existingProfile.scoreLive,
            profile_origin: existingProfile.profile_origin,
            lastEventAt: existingProfile.lastEventAt,
          },
        },
      };
    }

    // ── Generate deterministic synthetic fingerprintId ───────────────────────
    // This allows future pixel sessions to be stitched to this profile via the
    // identity service when the same email or phone is encountered again.
    const anchorStr = hashedEmail ?? hashedPhone ?? `name:${sha256(name ?? 'anon')}`;
    const syntheticFingerprintId = `synth_offline_${anchorStr.slice(0, 20)}`;

    // ── Create the new offline profile ───────────────────────────────────────
    const newProfile = await prisma.$transaction(async (tx) => {
      const profile = await tx.customerProfile.create({
        data: {
          tenantId: tenant!.id,
          name: name ?? null,
          email: hashedEmail ?? null,
          phone: hashedPhone ?? null,
          // Q2 Attribution: email or phone = Tier 1, name only = Tier 2 (locked model: 1/2/2B/3)
          tier: (hashedEmail || hashedPhone) ? 'Tier 1' : 'Tier 2',
          group: hashedEmail ? 2 : (hashedPhone ? 3 : 4),
          intentBucket: 'unclassified',
          scoreRaw: 0,
          scoreLive: 0,
          profile_origin: 'offline_rep_entry',
          lastEventAt: new Date(),
        },
      });

      // Link synthetic fingerprint so future sessions can stitch
      await tx.deviceFingerprint.create({
        data: {
          fingerprintId: syntheticFingerprintId,
          customerProfileId: profile.id,
        },
      });

      // Record the offline entry as a telemetry event for the audit log
      await tx.telemetryEvent.create({
        data: {
          tenantId: tenant!.id,
          customerProfileId: profile.id,
          eventType: 'offline_rep_entry',
          scoreDelta: 0,
          payload: {
            source: source ?? 'offline_rep_entry',
            serviceDiscussed: serviceDiscussed ?? null,
            conversationNotes: conversationNotes ?? null,
            trace_id: traceId,
            profile_origin: 'offline_rep_entry',
          },
          occurredAt: new Date(),
        },
      });

      return profile;
    });

    return {
      status: 201,
      body: {
        message: 'Offline rep entry created successfully.',
        trace_id: traceId,
        profile: {
          id: newProfile.id,
          name: newProfile.name,
          tier: newProfile.tier,
          group: newProfile.group,
          intentBucket: newProfile.intentBucket,
          scoreRaw: newProfile.scoreRaw,
          profile_origin: newProfile.profile_origin,
          syntheticFingerprintId,
          note: 'Use this profile ID to generate a cs_token JWT for personalized outreach.',
        },
      },
    };
  } catch (error: any) {
    console.error(`[${traceId}] Offline rep entry error:`, error);
    const err: any = new Error(error?.message ?? 'Internal server error');
    err.status = 500;
    err.trace_id = traceId;
    err.details = error?.message;
    throw err;
  }
}
