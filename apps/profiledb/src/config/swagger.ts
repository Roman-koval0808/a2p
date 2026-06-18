export const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Centralized Customer Data Platform (CDP) & Telemetry API',
    version: '1.0.0',
    description: 'High-performance telemetry ingestion, scoring engine, and identity merging service for multi-tenant customer tracking.',
  },
  servers: [
    {
      url: '/api/v1',
      description: 'API version 1 root',
    },
  ],
  paths: {
    '/telemetry/events': {
      post: {
        summary: 'Ingest telemetry event',
        description: 'Ingests click, view, form submit, or SMS actions, resolves profile identities, updates scoring, and assigns intent buckets.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tenantSlug', 'fingerprintId', 'eventType'],
                properties: {
                  tenantSlug: { type: 'string', example: 'plumber-a', description: 'Tenant unique identifier' },
                  fingerprintId: { type: 'string', example: 'fp_abc123xyz', description: 'Browser fingerprint or tracking cookie ID' },
                  eventType: { type: 'string', example: 'clearsky.web.click', description: 'Type of event being tracked' },
                  pageUrl: { type: 'string', example: '/pricing', description: 'Optional page URL' },
                  referrer: { type: 'string', example: 'https://google.com', description: 'Referrer URL' },
                  scoreDelta: { type: 'integer', example: 15, default: 0, description: 'Score changes for profile engagement' },
                  email: { type: 'string', format: 'email', example: 'lead@gmail.com', description: 'Optional email used to trigger identity resolution & merges' },
                  phone: { type: 'string', example: '+15550199', description: 'Optional phone used to trigger identity resolution & merges' },
                  name: { type: 'string', example: 'John Doe', description: 'Optional customer name' },
                  payload: { type: 'object', example: { buttonId: 'pricing_table_cta' }, description: 'Arbitrary key-value tracking properties' },
                  occurredAt: { type: 'string', format: 'date-time', example: '2026-05-28T16:08:26Z', description: 'Timestamp event occurred (ISO 8601)' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Telemetry event ingested and profile updated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    eventId: { type: 'string' },
                    profile: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        email: { type: 'string', nullable: true },
                        phone: { type: 'string', nullable: true },
                        name: { type: 'string', nullable: true },
                        scoreRaw: { type: 'integer' },
                        scoreLive: { type: 'integer' },
                        intentBucket: { type: 'string' },
                        lastEventAt: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: 'Missing required parameters' },
          404: { description: 'Tenant not found' },
        },
      },
    },
    '/tenants/{tenantSlug}/events': {
      get: {
        summary: 'Get tenant telemetry events',
        description: 'Get all telemetry events for a tenant with optional filtering by event type or session ID.',
        parameters: [
          { name: 'tenantSlug', in: 'path', required: true, schema: { type: 'string' }, example: 'plumber-a' },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, example: 1 },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 }, example: 20 },
          { name: 'eventType', in: 'query', schema: { type: 'string' }, example: 'clearsky.web.click' },
          { name: 'sessionId', in: 'query', schema: { type: 'string' }, example: 'fp_abc123xyz' },
        ],
        responses: {
          200: {
            description: 'Filtered telemetry events',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          eventType: { type: 'string' },
                          intentBucket: { type: 'string' },
                          engagementScore: { type: 'integer' },
                          pageUrl: { type: 'string', nullable: true },
                          occurredAt: { type: 'string' },
                          customerEmail: { type: 'string', nullable: true },
                          customerName: { type: 'string', nullable: true },
                          payload: { type: 'object' },
                        },
                      },
                    },
                    pagination: {
                      type: 'object',
                      properties: {
                        total: { type: 'integer' },
                        page: { type: 'integer' },
                        limit: { type: 'integer' },
                        pages: { type: 'integer' },
                      },
                    },
                    filters: {
                      type: 'object',
                      properties: {
                        eventTypes: { type: 'array', items: { type: 'string' } },
                        buckets: { type: 'array', items: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/tenants/{tenantSlug}/clear': {
      post: {
        summary: 'Clear tenant telemetry data',
        description: 'Deletes all telemetry events, device fingerprints, and profiles under the specified tenant.',
        parameters: [
          { name: 'tenantSlug', in: 'path', required: true, schema: { type: 'string' }, example: 'plumber-a' },
        ],
        responses: {
          200: {
            description: 'Tenant telemetry cleared successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/tenants/{tenantSlug}/profiles': {
      get: {
        summary: 'List tenant profiles',
        description: 'Get paginated, sorted, and filtered list of customer profiles under a tenant, with live scores recalculated on-the-fly.',
        parameters: [
          { name: 'tenantSlug', in: 'path', required: true, schema: { type: 'string' }, example: 'plumber-a' },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, example: 1 },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 }, example: 20 },
          { name: 'sortBy', in: 'query', schema: { type: 'string', enum: ['scoreRaw', 'scoreLive', 'lastEventAt', 'createdAt', 'updatedAt'], default: 'lastEventAt' }, example: 'lastEventAt' },
          { name: 'sortOrder', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' }, example: 'desc' },
          { name: 'search', in: 'query', schema: { type: 'string' }, example: 'John', description: 'Search term matching name, email, or phone' },
          { name: 'intentBucket', in: 'query', schema: { type: 'string', enum: ['unclassified', 'research', 'comparison', 'active', 'emergency'] }, example: 'research' },
        ],
        responses: {
          200: {
            description: 'List of matching profiles',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          tenantId: { type: 'string' },
                          email: { type: 'string', nullable: true },
                          phone: { type: 'string', nullable: true },
                          name: { type: 'string', nullable: true },
                          scoreRaw: { type: 'integer' },
                          scoreLive: { type: 'integer' },
                          intentBucket: { type: 'string' },
                          lastEventAt: { type: 'string' },
                        },
                      },
                    },
                    pagination: {
                      type: 'object',
                      properties: {
                        total: { type: 'integer' },
                        page: { type: 'integer' },
                        limit: { type: 'integer' },
                        totalPages: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
          404: { description: 'Tenant not found' },
        },
      },
    },
    '/tenants/{tenantSlug}/profiles/{id}': {
      get: {
        summary: 'Get profile details',
        description: 'Get details of a single customer profile, including linked browser fingerprints, with real-time live score updates.',
        parameters: [
          { name: 'tenantSlug', in: 'path', required: true, schema: { type: 'string' }, example: 'plumber-a' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'da39a3ee-5e6b-4b0d-9fae-e23111223344' },
        ],
        responses: {
          200: {
            description: 'Customer profile object',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    tenantId: { type: 'string' },
                    email: { type: 'string', nullable: true },
                    phone: { type: 'string', nullable: true },
                    name: { type: 'string', nullable: true },
                    scoreRaw: { type: 'integer' },
                    scoreLive: { type: 'integer' },
                    intentBucket: { type: 'string' },
                    lastEventAt: { type: 'string' },
                    fingerprints: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          fingerprintId: { type: 'string' },
                          lastSeenAt: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          404: { description: 'Profile or Tenant not found' },
        },
      },
    },
    '/tenants/{tenantSlug}/profiles/{id}/history': {
      get: {
        summary: 'Get profile timeline history',
        description: 'Retrieves all telemetry events associated with the profile in ascending chronological order.',
        parameters: [
          { name: 'tenantSlug', in: 'path', required: true, schema: { type: 'string' }, example: 'plumber-a' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'da39a3ee-5e6b-4b0d-9fae-e23111223344' },
        ],
        responses: {
          200: {
            description: 'Chronological timeline of telemetry events',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      tenantId: { type: 'string' },
                      customerProfileId: { type: 'string' },
                      eventType: { type: 'string' },
                      pageUrl: { type: 'string', nullable: true },
                      referrer: { type: 'string', nullable: true },
                      ipAddress: { type: 'string', nullable: true },
                      userAgent: { type: 'string', nullable: true },
                      scoreDelta: { type: 'integer' },
                      payload: { type: 'object' },
                      occurredAt: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          404: { description: 'Profile or Tenant not found' },
        },
      },
    },
    '/tenants/{tenantSlug}/analytics': {
      get: {
        summary: 'Get tenant analytics',
        description: 'Get detailed telemetry & profile analytics for a specific tenant, including stage breakdowns, event distribution, temperature stats, and weekly activity timeline.',
        parameters: [
          { name: 'tenantSlug', in: 'path', required: true, schema: { type: 'string' }, example: 'plumber-a' },
        ],
        responses: {
          200: {
            description: 'Tenant analytics summary',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    intentBuckets: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          bucket: { type: 'string' },
                          count: { type: 'integer' },
                        },
                      },
                    },
                    eventTypes: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          eventType: { type: 'string' },
                          count: { type: 'integer' },
                        },
                      },
                    },
                    temperatures: {
                      type: 'object',
                      properties: {
                        hot: { type: 'integer' },
                        warm: { type: 'integer' },
                        cold: { type: 'integer' },
                      },
                    },
                    dailyActivity: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          date: { type: 'string' },
                          count: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          404: { description: 'Tenant not found' },
        },
      },
    },
    '/analytics/aggregation': {
      get: {
        summary: 'Cross-tenant admin aggregation',
        description: 'Exposes summary statistics, metric breakdowns, and a flattened ML dataset with profile features ready for model training.',
        responses: {
          200: {
            description: 'Analytics summary and feature output',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    summary: {
                      type: 'object',
                      properties: {
                        totalTenants: { type: 'integer' },
                        totalProfiles: { type: 'integer' },
                        totalEvents: { type: 'integer' },
                      },
                    },
                    intentBucketsDistribution: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          bucket: { type: 'string' },
                          count: { type: 'integer' },
                        },
                      },
                    },
                    eventTypesDistribution: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          eventType: { type: 'string' },
                          count: { type: 'integer' },
                        },
                      },
                    },
                    tenantSummaries: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          slug: { type: 'string' },
                          name: { type: 'string' },
                          profileCount: { type: 'integer' },
                          eventCount: { type: 'integer' },
                          avgScoreLive: { type: 'number' },
                        },
                      },
                    },
                    mlDataset: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          profileId: { type: 'string' },
                          tenantId: { type: 'string' },
                          hasEmail: { type: 'boolean' },
                          hasPhone: { type: 'boolean' },
                          hasName: { type: 'boolean' },
                          fingerprintCount: { type: 'integer' },
                          scoreRaw: { type: 'integer' },
                          scoreLive: { type: 'integer' },
                          intentBucket: { type: 'string' },
                          daysSinceLastEvent: { type: 'number' },
                          totalEvents: { type: 'integer' },
                          eventTypesBreakdown: { type: 'object' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
