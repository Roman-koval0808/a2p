import { Router } from 'express';
import { ingestTelemetryEvent, getTenantEvents, clearTenantTelemetry, sendSmsController } from '../controllers/telemetry.controller';
import {
  getTenantProfiles,
  getProfileDetails,
  getProfileHistory,
} from '../controllers/profile.controller';
import { getAnalyticsAggregation, getTenantAnalytics } from '../controllers/analytics.controller';
import { createOfflineRepEntry } from '../controllers/offline.controller';

const router = Router();

// Ingestion
router.post('/telemetry/events', ingestTelemetryEvent);
router.post('/telemetry/send-sms', sendSmsController);

// Events Retrieval
router.get('/tenants/:tenantSlug/events', getTenantEvents);

// Data Reset
router.post('/tenants/:tenantSlug/clear', clearTenantTelemetry);

// Profiles & History Retrieval
router.get('/tenants/:tenantSlug/profiles', getTenantProfiles);
router.get('/tenants/:tenantSlug/profiles/:id', getProfileDetails);
router.get('/tenants/:tenantSlug/profiles/:id/history', getProfileHistory);

// Build 8 / P24 — Offline rep entry (no browser session required)
router.post('/tenants/:tenantSlug/profiles/offline', createOfflineRepEntry);

import { explainDecision } from '../controllers/ai.controller';

// System Admin Analytics
router.get('/analytics/aggregation', getAnalyticsAggregation);
router.get('/tenants/:tenantSlug/analytics', getTenantAnalytics);

// AI Explain Interface
router.post('/ai/explain', explainDecision);

export default router;
