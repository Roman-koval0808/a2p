import { Request, Response } from 'express';
import prisma from '../config/prisma';

/**
 * GET /api/v1/analytics/aggregation
 * Summarizes platform telemetry and profile counts, generating clean feature datasets for downstream ML model tasks.
 */
export async function getAnalyticsAggregation(req: Request, res: Response) {
  try {
    // 1. Core aggregate stats
    const tenantCount = await prisma.tenant.count();
    const profileCount = await prisma.customerProfile.count();
    const eventCount = await prisma.telemetryEvent.count();

    // 2. Profiles by intent bucket
    const profilesByBucket = await prisma.customerProfile.groupBy({
      by: ['intentBucket'],
      _count: {
        id: true,
      },
    });

    // 3. Events by event type
    const eventsByType = await prisma.telemetryEvent.groupBy({
      by: ['eventType'],
      _count: {
        id: true,
      },
    });

    // 4. Tenant summaries
    const tenants = await prisma.tenant.findMany({
      include: {
        _count: {
          select: {
            profiles: true,
            events: true,
          },
        },
        profiles: {
          select: {
            scoreLive: true,
          },
        },
      },
    });

    const tenantSummaries = tenants.map((t) => {
      const avgScoreLive =
        t.profiles.length > 0
          ? t.profiles.reduce((sum, p) => sum + p.scoreLive, 0) / t.profiles.length
          : 0;

      return {
        id: t.id,
        slug: t.slug,
        name: t.name,
        profileCount: t._count.profiles,
        eventCount: t._count.events,
        avgScoreLive: Math.round(avgScoreLive * 100) / 100,
      };
    });

    // 5. ML Model Feature Ingestion Export (clean representation of profiles)
    // Limit to latest 1000 profiles or all profiles if small
    const mlFeaturesProfiles = await prisma.customerProfile.findMany({
      take: 1000,
      include: {
        events: {
          select: {
            eventType: true,
            scoreDelta: true,
          },
        },
        fingerprints: {
          select: {
            id: true,
          },
        },
      },
    });

    const mlDataset = mlFeaturesProfiles.map((p) => {
      const now = new Date();
      const daysSinceLastEvent = Math.max(
        0,
        (now.getTime() - p.lastEventAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Count event types
      const typeCounts: Record<string, number> = {};
      p.events.forEach((ev) => {
        typeCounts[ev.eventType] = (typeCounts[ev.eventType] || 0) + 1;
      });

      return {
        profileId: p.id,
        tenantId: p.tenantId,
        hasEmail: p.email !== null,
        hasPhone: p.phone !== null,
        hasName: p.name !== null,
        fingerprintCount: p.fingerprints.length,
        scoreRaw: p.scoreRaw,
        scoreLive: p.scoreLive,
        intentBucket: p.intentBucket,
        daysSinceLastEvent: Math.round(daysSinceLastEvent * 100) / 100,
        totalEvents: p.events.length,
        eventTypesBreakdown: typeCounts,
      };
    });

    return res.status(200).json({
      summary: {
        totalTenants: tenantCount,
        totalProfiles: profileCount,
        totalEvents: eventCount,
      },
      intentBucketsDistribution: profilesByBucket.map((item) => ({
        bucket: item.intentBucket,
        count: item._count.id,
      })),
      eventTypesDistribution: eventsByType.map((item) => ({
        eventType: item.eventType,
        count: item._count.id,
      })),
      tenantSummaries,
      mlDataset,
    });
  } catch (error: any) {
    console.error('Error generating analytics aggregation:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}

/**
 * GET /api/v1/tenants/:tenantSlug/analytics
 * Get detailed telemetry & profile analytics for a specific tenant.
 */
export async function getTenantAnalytics(req: Request, res: Response) {
  try {
    const { tenantSlug } = req.params;

    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });

    if (!tenant) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // 1. Intent Stage breakdown
    const profilesByBucket = await prisma.customerProfile.groupBy({
      where: { tenantId: tenant.id },
      by: ['intentBucket'],
      _count: {
        id: true,
      },
    });

    // 2. Event Types breakdown
    const eventsByType = await prisma.telemetryEvent.groupBy({
      where: { tenantId: tenant.id },
      by: ['eventType'],
      _count: {
        id: true,
      },
    });

    // 3. Temp breakdown (Hot >= 80, Warm 40-79, Cold < 40)
    const hotCount = await prisma.customerProfile.count({
      where: { tenantId: tenant.id, scoreLive: { gte: 80 } },
    });
    const warmCount = await prisma.customerProfile.count({
      where: { tenantId: tenant.id, scoreLive: { gte: 40, lt: 80 } },
    });
    const coldCount = await prisma.customerProfile.count({
      where: { tenantId: tenant.id, scoreLive: { lt: 40 } },
    });

    // 4. Over-time telemetry activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentEvents = await prisma.telemetryEvent.findMany({
      where: {
        tenantId: tenant.id,
        occurredAt: { gte: sevenDaysAgo },
      },
      select: {
        occurredAt: true,
      },
    });

    const activityOverTime: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateString = d.toISOString().split('T')[0];
      activityOverTime[dateString] = 0;
    }

    recentEvents.forEach(ev => {
      const dateString = ev.occurredAt.toISOString().split('T')[0];
      if (activityOverTime[dateString] !== undefined) {
        activityOverTime[dateString]++;
      }
    });

    const dailyActivity = Object.entries(activityOverTime).map(([date, count]) => ({
      date,
      count,
    }));

    return res.status(200).json({
      intentBuckets: profilesByBucket.map((item) => ({
        bucket: item.intentBucket,
        count: item._count.id,
      })),
      eventTypes: eventsByType.map((item) => ({
        eventType: item.eventType,
        count: item._count.id,
      })),
      temperatures: {
        hot: hotCount,
        warm: warmCount,
        cold: coldCount,
      },
      dailyActivity,
    });
  } catch (error: any) {
    console.error('Error generating tenant analytics:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}

