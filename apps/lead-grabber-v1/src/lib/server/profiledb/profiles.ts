import { profileDb as prisma } from '$lib/profiledb-db';
import { calculateDecayedScore, evaluateDemotion } from './scoring.service';

/**
 * GET /api/v1/tenants/:tenantSlug/profiles
 * Paginate, sort, filter, and search tenant profiles. Recalculates live scores on-the-fly.
 */
export async function getTenantProfiles(
  tenantSlug: string,
  query: {
    page?: string;
    limit?: string;
    sortBy?: string;
    sortOrder?: string;
    search?: string;
    intentBucket?: string;
    representativeId?: string;
  } = {}
): Promise<{ status: number; body: any }> {
  const {
    page = '1',
    limit = '20',
    sortBy = 'lastEventAt',
    sortOrder = 'desc',
    search = '',
    intentBucket,
    representativeId,
  } = query;

  let tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        slug: tenantSlug,
        name: tenantSlug.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      },
    });
  }

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
  const skip = (pageNum - 1) * limitNum;

  // Supported sort fields
  const validSortFields = ['scoreRaw', 'scoreLive', 'lastEventAt', 'createdAt', 'updatedAt'];
  const actualSortBy = validSortFields.includes(sortBy as string) ? (sortBy as string) : 'lastEventAt';
  const actualSortOrder = sortOrder === 'asc' ? 'asc' : 'desc';

  const whereClause: any = {
    tenantId: tenant.id,
  };

  if (intentBucket) {
    whereClause.intentBucket = intentBucket as string;
  }

  if (representativeId) {
    if (representativeId === 'unassigned') {
      whereClause.representativeId = null;
    } else {
      whereClause.representativeId = representativeId as string;
    }
  }

  if (search) {
    whereClause.OR = [
      { name: { contains: search as string, mode: 'insensitive' } },
      { email: { contains: search as string, mode: 'insensitive' } },
      { phone: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  const profiles = await prisma.customerProfile.findMany({
    where: whereClause,
    include: {
      events: true,
      fingerprints: true,
    },
    orderBy: {
      [actualSortBy]: actualSortOrder,
    },
    skip,
    take: limitNum,
  });

  const totalCount = await prisma.customerProfile.count({
    where: whereClause,
  });

  const now = new Date();
  // Update live scores on the fly and sync to DB
  const updatedProfiles = await Promise.all(
    profiles.map(async (profile) => {
      const { demoted, newBucket, scoreLive, decayPct, inGrace } = evaluateDemotion(
        profile.scoreRaw,
        profile.lastEventAt,
        profile.intentBucket,
        now
      );

      let finalProfile = profile;
      if (scoreLive !== profile.scoreLive || newBucket !== profile.intentBucket) {
        finalProfile = await prisma.customerProfile.update({
          where: { id: profile.id },
          data: { scoreLive, intentBucket: newBucket },
          include: {
            events: true,
            fingerprints: true,
          },
        });
      }

      const sessions = new Set(
        finalProfile.events
          .map((ev) => {
            const p = (ev.payload as any) || {};
            return p.sessionId || p.session_id || null;
          })
          .filter(Boolean)
      );
      const sessionCount = Math.max(1, sessions.size);

      let clearPhone = '—';
      let clearEmail = '—';
      if (finalProfile.events && Array.isArray(finalProfile.events)) {
        for (const ev of finalProfile.events) {
          const ep = (ev.payload as any) || {};
          if (ep.phone && ep.phone !== '—') {
            clearPhone = ep.phone;
          } else if (ep.customer_phone && ep.customer_phone !== '—') {
            clearPhone = ep.customer_phone;
          } else if (ep.textContent && clearPhone === '—') {
            const match = ep.textContent.match(/Voice Call from:\s*(\+?[\d\s\-()]+)/);
            if (match) clearPhone = match[1].trim();
          }
          if (ep.email && ep.email !== '—') {
            clearEmail = ep.email;
          } else if (ep.customer_email && ep.customer_email !== '—') {
            clearEmail = ep.customer_email;
          }
        }
      }

      return {
        id: finalProfile.id,
        tenantId: finalProfile.tenantId,
        email: finalProfile.email,
        phone: finalProfile.phone,
        name: finalProfile.name,
        scoreRaw: finalProfile.scoreRaw,
        scoreLive: finalProfile.scoreLive,
        intentBucket: finalProfile.intentBucket,
        lastEventAt: finalProfile.lastEventAt,
        lastSeen: finalProfile.lastEventAt,
        createdAt: finalProfile.createdAt,
        updatedAt: finalProfile.updatedAt,
        isAnonymous: !finalProfile.email && !finalProfile.phone,
        group: finalProfile.group,
        tier: finalProfile.tier,
        sealedPackage: finalProfile.sealedPackage,
        sessionCount,
        decayPct,
        inGrace,
        bucket: finalProfile.intentBucket,
        wasDemoted: demoted,
        clearPhone,
        clearEmail,
      };
    })
  );

  return {
    status: 200,
    body: {
      data: updatedProfiles,
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum),
      },
    },
  };
}

/**
 * GET /api/v1/tenants/:tenantSlug/profiles/:id
 * Get profile details, recalculating and updating live score.
 */
export async function getProfileDetails(
  tenantSlug: string,
  id: string
): Promise<{ status: number; body: any }> {
  let tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        slug: tenantSlug,
        name: tenantSlug.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      },
    });
  }

  const profile = await prisma.customerProfile.findFirst({
    where: { id, tenantId: tenant.id },
    include: {
      fingerprints: true,
      events: true,
    },
  });

  if (!profile) {
    return { status: 404, body: { error: 'Profile not found' } };
  }

  const now = new Date();
  const { demoted, newBucket, scoreLive, decayPct, inGrace } = evaluateDemotion(
    profile.scoreRaw,
    profile.lastEventAt,
    profile.intentBucket,
    now
  );

  let finalProfile = profile;
  if (scoreLive !== profile.scoreLive || newBucket !== profile.intentBucket) {
    finalProfile = await prisma.customerProfile.update({
      where: { id: profile.id },
      data: { scoreLive, intentBucket: newBucket },
      include: {
        fingerprints: true,
        events: true,
      },
    });
  }

  const sessions = new Set(
    finalProfile.events
      .map((ev) => {
        const p = (ev.payload as any) || {};
        return p.sessionId || p.session_id || null;
      })
      .filter(Boolean)
  );
  const sessionCount = Math.max(1, sessions.size);

  let clearPhone = '—';
  let clearEmail = '—';
  if (finalProfile.events && Array.isArray(finalProfile.events)) {
    for (const ev of finalProfile.events) {
      const ep = (ev.payload as any) || {};
      if (ep.phone && ep.phone !== '—') {
        clearPhone = ep.phone;
      } else if (ep.customer_phone && ep.customer_phone !== '—') {
        clearPhone = ep.customer_phone;
      } else if (ep.textContent && clearPhone === '—') {
        const match = ep.textContent.match(/Voice Call from:\s*(\+?[\d\s\-()]+)/);
        if (match) clearPhone = match[1].trim();
      }
      if (ep.email && ep.email !== '—') {
        clearEmail = ep.email;
      } else if (ep.customer_email && ep.customer_email !== '—') {
        clearEmail = ep.customer_email;
      }
    }
  }

  return {
    status: 200,
    body: {
      ...finalProfile,
      lastSeen: finalProfile.lastEventAt,
      isAnonymous: !finalProfile.email && !finalProfile.phone,
      sessionCount,
      decayPct,
      inGrace,
      bucket: finalProfile.intentBucket,
      wasDemoted: demoted,
      clearPhone,
      clearEmail,
    },
  };
}

/**
 * GET /api/v1/tenants/:tenantSlug/profiles/:id/history
 * Get the full event logs sorted chronologically (unified timeline).
 */
export async function getProfileHistory(
  tenantSlug: string,
  id: string
): Promise<{ status: number; body: any }> {
  let tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        slug: tenantSlug,
        name: tenantSlug.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      },
    });
  }

  const profile = await prisma.customerProfile.findFirst({
    where: { id, tenantId: tenant.id },
  });

  if (!profile) {
    return { status: 404, body: { error: 'Profile not found' } };
  }

  const events = await prisma.telemetryEvent.findMany({
    where: { customerProfileId: id, tenantId: tenant.id },
    orderBy: { occurredAt: 'asc' },
  });

  return { status: 200, body: events };
}

/**
 * PUT /api/v1/tenants/:tenantSlug/profiles/:id/representative
 * Assign a profile to a representative (User ID from clearsky-db-client).
 */
export async function assignRepresentative(
  tenantSlug: string,
  id: string,
  representativeId: string | null | undefined
): Promise<{ status: number; body: any }> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
  });

  if (!tenant) {
    return { status: 404, body: { error: 'Tenant not found' } };
  }

  const profile = await prisma.customerProfile.findFirst({
    where: { id, tenantId: tenant.id },
  });

  if (!profile) {
    return { status: 404, body: { error: 'Profile not found' } };
  }

  const updatedProfile = await prisma.customerProfile.update({
    where: { id: profile.id },
    data: { representativeId: representativeId || null },
  });

  return { status: 200, body: updatedProfile };
}
