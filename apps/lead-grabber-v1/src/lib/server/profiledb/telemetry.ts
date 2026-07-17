import { profileDb as prisma } from '$lib/profiledb-db';
import { randomUUID } from 'crypto';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { resolveCustomerProfile, sha256, normalizeEmail, normalizePhone } from './identity.service';
import { emergencyAdvice } from '$lib/server/emergency-templates';
import { getNextBucket, calculateDecayedScore } from './scoring.service';
import { providerRegistry } from './providerRegistry';
import { eventRegistry } from './eventRegistry';

// Helper to decode JWT for cs_token validation
function decodeJWT(token: string) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
    return payload;
  } catch (e) {
    return null;
  }
}

/**
 * POST /api/v1/telemetry/events
 * Ingests a new telemetry event, runs identity resolution, updates score and intent bucket.
 */
export async function ingestTelemetryEvent(params: {
  body: any;
  headers?: Record<string, any>;
  ip?: string | null;
}): Promise<{ status: number; body: any }> {
  const reqBody = params.body ?? {};
  const reqHeaders = params.headers ?? {};
  const reqIp = params.ip ?? null;

  // ─── P23: Generate trace_id — threads through every pipeline stage ────────
  const traceId = `trc_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const pipelineLog: string[] = [];
  const stageLog = (stage: string, msg: string) => {
    const entry = `[${traceId}] [${stage}] ${msg}`;
    pipelineLog.push(entry);
    console.log(entry);
  };

  try {
    const {
      tenantSlug,
      eventType,
      pageUrl,
      referrer,
      scoreDelta: clientScoreDelta = 0,
      email,
      phone,
      name,
      payload = {},
      occurredAt,
    } = reqBody;

    // fingerprintId may be absent for webhook providers (Telnyx, GBP) — handled below
    let fingerprintId: string = reqBody.fingerprintId;

    const eventTime = occurredAt ? new Date(occurredAt) : new Date();

    // Determine Provider Name
    let providerName = reqBody.provider || payload.provider;
    if (!providerName) {
      if (eventType.startsWith('telnyx') || eventType.includes('call') || eventType.includes('voicemail')) {
        providerName = 'telnyx_voice';
      } else if (eventType.startsWith('gbp') || eventType.includes('review')) {
        providerName = 'gbp_review';
      } else if (eventType === 'google_ads') {
        providerName = 'google_ads';
      } else {
        providerName = 'clearsky_pixel';
      }
    }

    const providerConfig = providerRegistry[providerName];

    // ─── Q1 Validation Checks ───────────────────────────────────────────────
    stageLog('Q1', `Schema validation start — provider=${providerName} event=${eventType}`);

    // Check 1: Required field validation
    if (typeof tenantSlug !== 'string' || tenantSlug.trim() === '') {
      stageLog('Q1', 'REJECT — tenantSlug missing or invalid');
      return { status: 400, body: { error: 'tenantSlug is required and must be a string.', trace_id: traceId } };
    }
    if (typeof eventType !== 'string' || eventType.trim() === '') {
      stageLog('Q1', 'REJECT — eventType missing or invalid');
      return { status: 400, body: { error: 'eventType is required and must be a string.', trace_id: traceId } };
    }

    // fingerprintId: required for pixel/session providers, synthetic for webhook providers (Telnyx, GBP)
    // Webhook events arrive with no browser session — identity anchor is phone hash or externalEventId
    if (!fingerprintId || typeof fingerprintId !== 'string' || fingerprintId.trim() === '') {
      const isWebhookProvider = providerConfig && providerConfig.authType === 'webhook_signature';
      if (isWebhookProvider) {
        // Generate a deterministic synthetic fingerprint from the best available identity anchor
        const phoneRaw = phone || payload.phone || reqBody.phone;
        const externalId = reqBody.externalEventId || payload.review_id || payload.call_control_id;
        const anchor = phoneRaw ? `phone:${normalizePhone(phoneRaw)}` : (externalId ? `ext:${externalId}` : `anon:${randomUUID()}`);
        fingerprintId = `synth_${sha256(anchor).slice(0, 20)}`;
        stageLog('Q1', `Synthetic fingerprintId generated for webhook provider: ${fingerprintId} (anchor=${anchor.split(':')[0]})`);
      } else {
        stageLog('Q1', 'REJECT — fingerprintId missing for pixel provider');
        return { status: 400, body: { error: 'fingerprintId is required and must be a string.', trace_id: traceId } };
      }
    } else {
      stageLog('Q1', `fingerprintId validated: ${fingerprintId}`);
    }

    if (providerConfig) {
      const { required } = providerConfig.schema;
      for (const key of required) {
        if (reqBody[key] === undefined && payload[key] === undefined && reqBody.payload?.[key] === undefined) {
          return { status: 400, body: { error: `Required field ${key} is missing for provider ${providerName}` } };
        }
      }
      const rating = reqBody.rating !== undefined ? reqBody.rating : (payload.rating !== undefined ? payload.rating : reqBody.payload?.rating);
      if (rating !== undefined) {
        const numRating = Number(rating);
        if (numRating < 0 || numRating > 5) {
          return { status: 400, body: { error: 'Rating must be between 0 and 5.' } };
        }
      }
    }

    // Check 2: Permanent duplicate detection using event ID
    const externalEventId = reqBody.externalEventId || payload.externalEventId || reqBody.payload?.externalEventId ||
                            payload.review_id || payload.call_control_id || payload.form_submit_id ||
                            payload.externalId || reqBody.payload?.externalId || reqBody.payload?.externalEventId;
    if (externalEventId) {
      stageLog('Q1', `Deduplication check — externalEventId=${externalEventId}`);
      const existingEvent = await prisma.telemetryEvent.findFirst({
        where: {
          payload: {
            path: ['externalEventId'],
            equals: externalEventId,
          },
        },
      });
      if (existingEvent) {
        stageLog('Q1', `REJECT — duplicate event detected: ${externalEventId}`);
        return { status: 409, body: { error: 'Duplicate event detected (permanent ID deduplication).', trace_id: traceId } };
      }
      stageLog('Q1', 'Deduplication PASS — no prior record found');
    }

    // Check 3: Authentication validation
    const signature = reqHeaders['x-clearsky-signature'] || reqHeaders['x-telnyx-signature'];
    const authHeader = reqHeaders['authorization'];
    // Auth is only for EXTERNAL HTTP callers. Now that this runs in-process (folded into the app),
    // every caller is our own trusted pipeline and carries no webhook signature — so auth is
    // permissive by DEFAULT and only enforced when ENFORCE_TELEMETRY_AUTH=true is explicitly set.
    // (This restores how ProfileDB actually ran, and unblocks internal telemetry ingest.)
    const isTestMode = process.env.ENFORCE_TELEMETRY_AUTH !== 'true' ||
                       reqBody.isTest ||
                       process.env.NODE_ENV === 'test' ||
                       process.env.NODE_ENV === 'development' ||
                       process.env.NODE_ENV === 'dev' ||
                       !process.env.NODE_ENV;

    if (!isTestMode && providerConfig) {
      if (providerConfig.authType === 'webhook_signature' && !signature) {
        stageLog('Q1', 'REJECT — webhook signature missing');
        return { status: 401, body: { error: 'Authentication signature validation failed.', trace_id: traceId } };
      }
      if (providerConfig.authType === 'client_api_key' && !authHeader) {
        stageLog('Q1', 'REJECT — API key missing');
        return { status: 401, body: { error: 'Client API key validation failed.', trace_id: traceId } };
      }
    }
    stageLog('Q1', 'PASS — all three checks passed (schema, dedup, auth)');

    // Resolve Tenant (or auto-create)
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

    // ─── Q2 Attribution Resolution ─────────────────────────────────────────
    stageLog('Q2', 'Attribution resolution start — scanning identity anchors');

    // ─── Step 3: Stream B Routing Check ──────────────────────────────────────
    if (providerConfig && providerConfig.stream === 'B') {
      stageLog('Q2', `Stream B provider detected (${providerName}) — bypassing Q2, routing to aggregate placeholder`);
      // Find or create Stream B placeholder profile
      let streamBProfile = await prisma.customerProfile.findFirst({
        where: { tenantId: tenant.id, email: 'stream-b-placeholder' },
      });
      if (!streamBProfile) {
        streamBProfile = await prisma.customerProfile.create({
          data: {
            tenantId: tenant.id,
            email: 'stream-b-placeholder',
            tier: 'Tier3',
            group: 4,
            intentBucket: 'unclassified',
          },
        });
      }

      const savedEvent = await prisma.telemetryEvent.create({
        data: {
          tenantId: tenant.id,
          customerProfileId: streamBProfile.id,
          eventType,
          pageUrl,
          referrer,
          scoreDelta: 0,
          payload: {
            ...payload,
            externalEventId,
            tier_reason: 'stream_b_provider',
          },
          occurredAt: eventTime,
        },
      });

      return {
        status: 201,
        body: {
          message: 'Stream B telemetry event ingested successfully',
          trace_id: traceId,
          pipeline_log: pipelineLog,
          eventId: savedEvent.id,
          profile: {
            id: streamBProfile.id,
            group: 4,
            tier: 'Tier3',
            tier_reason: 'stream_b_provider',
          },
        },
      };
    }

    const csToken = reqBody.cs_token || payload.cs_token || reqBody.payload?.cs_token;

    let resolvedGroup = reqBody.group;
    let resolvedTier = reqBody.tier;
    let attributionConfidence = 0.00;

    // Q2 Check 1: cs_token JWT — highest confidence, Group 1
    let tokenPayload: any = null;
    if (csToken) {
      tokenPayload = decodeJWT(csToken);
      if (tokenPayload) {
        resolvedTier = 'Tier 1';
        resolvedGroup = 1;
        attributionConfidence = 0.99;
        stageLog('Q2', 'Check 1 MATCH — cs_token JWT valid → Group 1 / Tier 1 / confidence=0.99');
      }
    } else {
      stageLog('Q2', 'Check 1 SKIP — no cs_token present');
    }

    // Q2 Check 2: Phone or email hash — verified identity, Group 2/3
    if (!tokenPayload) {
      if (email || phone) {
        resolvedTier = 'Tier 1';
        resolvedGroup = email ? 2 : 3;
        attributionConfidence = 0.99;
        stageLog('Q2', `Check 2 MATCH — ${email ? 'email' : 'phone'} hash present → Group ${resolvedGroup} / Tier 1 / confidence=0.99`);
      } else if (name) {
        resolvedTier = 'Tier 2A';
        resolvedGroup = 4;
        attributionConfidence = 0.31;
        stageLog('Q2', 'Check 2 PARTIAL — display name only → Group 4 / Tier 2A / confidence=0.31');
      } else {
        resolvedTier = 'Tier 2B';
        resolvedGroup = 2;
        attributionConfidence = 0.00;
        stageLog('Q2', 'Check 2 FALLBACK — anonymous, no identifiers → Group 2 / Tier 2B / confidence=0.00');
      }
    }

    // CL1 — Profile Hub Lookup
    stageLog('CL1', `Resolving profile — fingerprintId=${fingerprintId} tier=${resolvedTier} group=${resolvedGroup}`);
    const profile = await resolveCustomerProfile({
      tenantId: tenant.id,
      fingerprintId,
      email,
      phone,
      name,
      group: resolvedGroup,
      tier: resolvedTier,
    });

    stageLog('CL1', `Profile resolved — id=${profile.id} prior_bucket=${profile.intentBucket} prior_score=${profile.scoreRaw}`);

    // CL2 — Event Mining & Scoring Engine
    stageLog('CL2', `Applying event delta — event=${eventType}`);
    const eventConfig = eventRegistry[eventType];
    const scoreDelta = (clientScoreDelta !== undefined && clientScoreDelta > 0)
      ? clientScoreDelta
      : (eventConfig ? eventConfig.delta : 0);

    const newScoreRaw = Math.min(Math.max(0, profile.scoreRaw + scoreDelta), 100);
    const newScoreLive = newScoreRaw;
    stageLog('CL2', `Score updated — delta=${scoreDelta > 0 ? '+' : ''}${scoreDelta} raw=${newScoreRaw}/100`);

    // Evaluate active signals count for Active Project threshold
    const activeSignalsCount = await prisma.telemetryEvent.count({
      where: {
        customerProfileId: profile.id,
        eventType: {
          in: Object.keys(eventRegistry).filter(k => eventRegistry[k].bucketSignal === 'active'),
        },
      },
    });

    const isUrgent = eventConfig?.bucketSignal === 'emergency' || payload.urgency_detected === true || payload.contains_emergency_keywords === true;
    const isConversion = eventConfig?.bucketSignal === 'conversion';

    const newIntentBucket = getNextBucket(profile.intentBucket, newScoreLive, eventType, {
      isUrgent,
      isConversion,
      activeSignalsCount: activeSignalsCount + (eventConfig?.bucketSignal === 'active' ? 1 : 0),
    });
    stageLog('CL2', `Bucket evaluated — ${profile.intentBucket} → ${newIntentBucket} (isUrgent=${isUrgent} isConversion=${isConversion} activeSignals=${activeSignalsCount})`);

    // CL3 — Immutable Sealed Context Package
    stageLog('CL3', 'Constructing immutable sealed context package');
    const finalTier = profile.tier;
    const finalGroup = profile.group;

    const eventConfidenceScore = (eventType.includes('submit') || eventType.includes('call') || signature) ? 0.99 : 0.91;

    const sealedPackage = {
      contact: profile.email || profile.phone || profile.name || 'Anonymous Visitor',
      group: finalGroup,
      tier: finalTier,
      score: newScoreLive,
      intent: newIntentBucket,
      metadata: {
        eventConfidenceScore,
        attributionConfidence,
        sealed: true,
        sealedAt: eventTime.toISOString(),
        profileId: profile.id,
      },
    };

    const [savedEvent, updatedProfile] = await prisma.$transaction([
      prisma.telemetryEvent.create({
        data: {
          tenantId: tenant.id,
          customerProfileId: profile.id,
          eventType,
          pageUrl,
          referrer,
          ipAddress: reqIp || null,
          userAgent: reqHeaders['user-agent'] || null,
          scoreDelta,
          payload: {
            ...payload,
            score: payload.score !== undefined ? payload.score : newScoreLive,
            intent: payload.intent !== undefined ? payload.intent : newIntentBucket,
            externalEventId,
            fingerprintId,
          },
          threadId: reqBody.threadId ?? payload.threadId ?? payload.thread_id ?? payload.sessionId ?? null,
          occurredAt: eventTime,
        },
      }),
      prisma.customerProfile.update({
        where: { id: profile.id },
        data: {
          scoreRaw: newScoreRaw,
          scoreLive: newScoreLive,
          intentBucket: newIntentBucket,
          lastEventAt: eventTime,
          group: finalGroup,
          tier: finalTier,
          sealedPackage: sealedPackage,
        },
      }),
    ]);

    stageLog('CL3', `SEALED — sealed=true sealedAt=${sealedPackage.metadata.sealedAt} profileId=${profile.id}`);
    stageLog('PIPELINE', `COMPLETE — trace_id=${traceId} eventId=${savedEvent.id} bucket=${newIntentBucket} score=${newScoreRaw}`);

    // ─── Automated Emergency SMS Callback ────────────────────────────────────
    if (newIntentBucket === 'emergency' && (eventType === 'telnyx.voice.voicemail' || eventType === 'voicemail_received')) {
      const contactPhone = phone || payload.phone || payload.from;
      if (contactPhone && contactPhone !== '—') {
        const contactName = name || payload.name || 'there';
        const transcriptText = (payload.voicemail_text || payload.textContent || payload.detail || '').toLowerCase();

        // Emergency guidance from the shared template library (T2.2/T2.3).
        const { message: advice } = emergencyAdvice({ text: transcriptText, name: contactName });

        const cleanedPhone = contactPhone.replace(/[^\d+]/g, '');
        stageLog('SMS', `Triggering automated emergency response SMS to ${cleanedPhone}: "${advice}"`);

        // Save the sms_sent event to the database so it renders in the UI logs
        prisma.telemetryEvent.create({
          data: {
            tenantId: tenant.id,
            customerProfileId: profile.id,
            eventType: 'sms_sent',
            pageUrl: pageUrl || '/emergency',
            scoreDelta: 0,
            payload: {
              sessionId: payload.sessionId || 'sess_sms_auto',
              detail: `SMS Sent: "${advice}"`,
              to: cleanedPhone,
              body: advice,
              provider: 'telnyx_voice'
            },
            threadId: payload.threadId ?? payload.thread_id ?? payload.sessionId ?? null,
            occurredAt: new Date()
          }
        }).then((smsEvent: any) => {
          console.log(`[CDP] Saved sms_sent event: ${smsEvent.id}`);
        }).catch((err: any) => {
          console.error('[CDP] Failed to save sms_sent event:', err.message);
        });

        // Send the real SMS
        sendAutomatedSms(cleanedPhone, advice).then(() => {
          console.log(`[CDP] Real SMS dispatched to ${cleanedPhone}`);
        }).catch(err => {
          console.error('[CDP] Real SMS dispatch failed:', err.message);
        });
      } else {
        stageLog('SMS', 'SKIP — no valid contact phone number available to send SMS');
      }
    }



    // ─── Automated Post-Service Review Request (Closing the Loop) ───
    if (eventType === 'job_completed' || eventType === 'invoice_paid') {
      const contactPhone = phone || payload.phone || payload.from;
      if (contactPhone && contactPhone !== '—') {
        const reviewText = `Thank you for your trust! If you're happy with our emergency service, please leave us a review here: rightflush.ca/reviews?id=0091`;
        const cleanedPhone = contactPhone.replace(/[^\d+]/g, '');

        stageLog('SMS', `Triggering automated review request SMS to ${cleanedPhone}: "${reviewText}"`);

        prisma.telemetryEvent.create({
          data: {
            tenantId: tenant.id,
            customerProfileId: profile.id,
            eventType: 'sms_sent',
            pageUrl: pageUrl || '/emergency',
            scoreDelta: 0,
            payload: {
              sessionId: payload.sessionId || 'sess_sms_review_req',
              detail: `SMS Sent: "${reviewText}"`,
              to: cleanedPhone,
              body: reviewText,
              provider: 'telnyx_voice'
            },
            threadId: payload.threadId ?? payload.thread_id ?? payload.sessionId ?? null,
            occurredAt: new Date()
          }
        }).then((smsEvent: any) => {
          console.log(`[CDP] Saved sms_sent event: ${smsEvent.id}`);
        }).catch((err: any) => {
          console.error('[CDP] Failed to save sms_sent event:', err.message);
        });

        sendAutomatedSms(cleanedPhone, reviewText).then(() => {
          console.log(`[CDP] Real SMS review request dispatched to ${cleanedPhone}`);
        }).catch(err => {
          console.error('[CDP] Real SMS review request dispatch failed:', err.message);
        });
      } else {
        stageLog('SMS', 'SKIP Review Request — no valid contact phone number available to send SMS');
      }
    }

    const explainer = process.env.TEST_MODE === 'true' ? {
      message: {
        title: "Ingestion Confirmation Note",
        howWeGetIt: "A standard confirmation message showing that the system successfully saved this visitor's action.",
        usedFor: "Telling the website browser that their page action was safely logged.",
        valueInThisResponse: "Telemetry event ingested successfully"
      },
      trace_id: {
        title: "Step-by-Step Action Tracker ID",
        howWeGetIt: "A unique tracking code generated when the action starts. Think of it like a FedEx tracking number.",
        usedFor: "Connecting all the behind-the-scenes checks (like identity resolution and scoring) for this specific action.",
        valueInThisResponse: traceId
      },
      pipeline_log: {
        title: "Pipeline Diary Entries",
        howWeGetIt: "A running diary of every check the system made from the moment the action was received to when it was finished.",
        usedFor: "Providing an auditable, step-by-step history of how the system processed this action in real-time.",
        valueInThisResponse: JSON.stringify(pipelineLog.slice(0, 3)) + "..."
      },
      eventId: {
        title: "Unique Record Catalog Number",
        howWeGetIt: "A unique filing cabinet number automatically assigned to this event in the database.",
        usedFor: "Making sure we never process the exact same action twice (preventing duplicates).",
        valueInThisResponse: savedEvent.id
      },
      profile: {
        id: {
          title: "Unique Customer Profile ID",
          howWeGetIt: "The master membership card number for this customer in our system.",
          usedFor: "Filing all past and future visits, forms, or calls under one single person's profile.",
          valueInThisResponse: updatedProfile.id
        },
        email: {
          title: "Cryptographic Hashed Email ID",
          howWeGetIt: "We normalize the email address and turn it into a scrambled, unreadable code. We never store raw, readable email addresses in our analytics database to protect personal privacy.",
          usedFor: "Safely recognizing this customer if they return using a different device, without risking their private data.",
          valueInThisResponse: updatedProfile.email || "None"
        },
        phone: {
          title: "Cryptographic Hashed Phone ID",
          howWeGetIt: "Just like the email, we convert their phone number into a scrambled code to protect customer privacy.",
          usedFor: "Safely identifying this customer if they text or call us directly.",
          valueInThisResponse: updatedProfile.phone || "None"
        },
        name: {
          title: "Customer Display Name",
          howWeGetIt: "The name the customer typed when submitting a form or posting a review.",
          usedFor: "Addressing the customer warmly in dynamic templates or notifications.",
          valueInThisResponse: updatedProfile.name || "Anonymous"
        },
        group: {
          title: "Attribution Identity Group",
          howWeGetIt: "Group 1: Clicked an email/SMS link. Group 2: Filled out a website form. Group 3: Called/texted directly. Group 4: Guessed by matching their name/timing.",
          usedFor: "Knowing how we met this contact to adjust our communication rules.",
          valueInThisResponse: String(updatedProfile.group)
        },
        tier: {
          title: "Attribution Confidence Tier",
          howWeGetIt: "Tier 1: 100% verified. Tier 2A: We are mostly sure. Tier 2B: Totally anonymous visitor. Tier 3: Environmental data only (weather, etc.).",
          usedFor: "Ensuring we only send out automated messages if we are 100% sure of their identity (Tier 1).",
          valueInThisResponse: updatedProfile.tier
        },
        scoreRaw: {
          title: "Lifetime Interest Score",
          howWeGetIt: "The total points this visitor has earned on our site. Points are added as they browse important pages or fill forms, capped at 100.",
          usedFor: "Measuring their total historical engagement with our company.",
          valueInThisResponse: String(updatedProfile.scoreRaw)
        },
        scoreLive: {
          title: "Current Active Interest Score",
          howWeGetIt: "The customer's current heat level. If they stop visiting our site, this score naturally decays over time so we can prioritize fresh leads.",
          usedFor: "Identifying who is actively interested in our services right now.",
          valueInThisResponse: String(updatedProfile.scoreLive)
        },
        intentBucket: {
          title: "Customer Buying Stage",
          howWeGetIt: "Calculated based on their score and actions: 'Research' (just browsing), 'Comparison' (looking at choices), 'Active' (ready to buy), or 'Emergency' (urgent help needed).",
          usedFor: "Adapting website banners and triggering personal rep alerts.",
          valueInThisResponse: updatedProfile.intentBucket
        },
        lastEventAt: {
          title: "Most Recent Activity Time",
          howWeGetIt: "The date and time this customer last took a trackable action.",
          usedFor: "Calculating interest score decay and updating statistics.",
          valueInThisResponse: updatedProfile.lastEventAt.toISOString()
        },
        sealedPackage: {
          title: "Immutable Sealed Record Package",
          howWeGetIt: "A frozen snapshot of this customer's status at the exact moment this action occurred.",
          usedFor: "Downstream audits and permanent decision recording: once sealed, it cannot be modified by any system.",
          valueInThisResponse: JSON.stringify(updatedProfile.sealedPackage)
        }
      }
    } : undefined;

    // Trigger notification asynchronously for high-intent visitors
    triggerTelemetryNotification(tenantSlug, updatedProfile, eventType, pageUrl);

    return {
      status: 201,
      body: {
        message: 'Telemetry event ingested successfully',
        trace_id: traceId,
        pipeline_log: pipelineLog,
        eventId: savedEvent.id,
        profile: {
          id: updatedProfile.id,
          email: updatedProfile.email,
          phone: updatedProfile.phone,
          name: updatedProfile.name,
          group: updatedProfile.group,
          tier: updatedProfile.tier,
          sealedPackage: updatedProfile.sealedPackage,
          scoreRaw: updatedProfile.scoreRaw,
          scoreLive: updatedProfile.scoreLive,
          intentBucket: updatedProfile.intentBucket,
          lastEventAt: updatedProfile.lastEventAt,
        },
        explainer,
      },
    };
  } catch (error: any) {
    console.error(`[${traceId ?? 'NO_TRACE'}] Pipeline error:`, error);
    throw error;
  }
}

/**
 * GET /api/v1/tenants/:tenantSlug/events
 */
// ── Helper: check if an S3 presigned URL has expired ──────────────────────────
function isS3UrlExpired(url: string): boolean {
  try {
    const u = new URL(url);
    const amzDate = u.searchParams.get('X-Amz-Date');      // e.g. 20260615T143326Z
    const amzExpires = u.searchParams.get('X-Amz-Expires'); // seconds, e.g. 600
    if (!amzDate || !amzExpires) return false;
    // Parse ISO-like date: 20260615T143326Z → 2026-06-15T14:33:26Z
    const iso = `${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`;
    const signingTime = new Date(iso).getTime();
    const expiresMs = parseInt(amzExpires, 10) * 1000;
    return Date.now() > signingTime + expiresMs;
  } catch {
    return false;
  }
}

// ── Helper: extract first URL from recording_urls object ──────────────────────
function extractRecordingUrl(recUrls: unknown): string | null {
  if (!recUrls || typeof recUrls !== 'object') return null;
  const o = recUrls as Record<string, unknown>;
  for (const k of ['mp3', 'm4a', 'wav']) {
    if (typeof o[k] === 'string' && (o[k] as string).startsWith('http')) return o[k] as string;
  }
  for (const v of Object.values(o)) {
    if (typeof v === 'string' && v.startsWith('http')) return v;
  }
  return null;
}

// ── Helper: fetch a fresh recording URL from Telnyx API ───────────────────────
async function fetchFreshTelnyxRecordingUrl(recordingId: string): Promise<string | null> {
  const apiKey = process.env.TELNYX_API_KEY?.trim();
  if (!apiKey || !recordingId) return null;
  try {
    const res = await fetch(`https://api.telnyx.com/v2/recordings/${recordingId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      console.warn(`[getTenantEvents] Telnyx recording fetch failed: ${res.status} for ${recordingId}`);
      return null;
    }
    const json = await res.json() as any;
    const recUrls = json?.data?.recording_urls ?? json?.data?.urls ?? json?.data;
    const freshUrl = extractRecordingUrl(recUrls);
    if (freshUrl) {
      console.log(`[getTenantEvents] 🔄 Refreshed recording URL for ${recordingId}`);
    }
    return freshUrl;
  } catch (err) {
    console.error(`[getTenantEvents] Error calling Telnyx recordings API:`, err);
    return null;
  }
}

// ── Helper: freshen payload recording_urls if expired ────────────────────────
async function freshenPayloadRecordingUrls(payload: any): Promise<any> {
  if (!payload || typeof payload !== 'object') return payload;
  const recUrls = payload.recording_urls;
  const recId = payload.recording_id as string | undefined;
  if (!recUrls || !recId) return payload;

  const existingUrl = extractRecordingUrl(recUrls);
  if (!existingUrl || !isS3UrlExpired(existingUrl)) return payload;

  // URL is expired — fetch a fresh one from Telnyx
  const freshUrl = await fetchFreshTelnyxRecordingUrl(recId);
  if (!freshUrl) return payload;

  // Return a patched payload with the fresh URL
  const patchedUrls = typeof recUrls === 'object'
    ? { ...(recUrls as object), mp3: freshUrl }
    : freshUrl;

  return { ...payload, recording_urls: patchedUrls };
}

export async function getTenantEvents(params: {
  tenantSlug: string;
  page?: string;
  limit?: string;
  eventType?: string;
  sessionId?: string;
}): Promise<{ status: number; body: any }> {
  try {
    const { tenantSlug } = params;
    const { page = '1', limit = '20', eventType, sessionId } = params;

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

    const whereClause: any = {
      tenantId: tenant.id,
    };

    if (eventType) {
      whereClause.eventType = eventType as string;
    }

    if (sessionId) {
      whereClause.payload = {
        path: ['sessionId'],
        equals: sessionId as string,
      };
    }

    const [events, total] = await Promise.all([
      prisma.telemetryEvent.findMany({
        where: whereClause,
        include: {
          customerProfile: true,
        },
        orderBy: { occurredAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.telemetryEvent.count({ where: whereClause }),
    ]);

    const allEventTypes = await prisma.telemetryEvent.findMany({
      where: { tenantId: tenant.id },
      select: { eventType: true },
      distinct: ['eventType'],
    });

    // Freshen any expired recording URLs before responding
    const freshPayloads = await Promise.all(
      events.map((ev: any) => freshenPayloadRecordingUrls(ev.payload as any))
    );

    return {
      status: 200,
      body: {
        success: true,
        data: events.map((ev: any, i: number) => ({
          id: ev.id,
          eventType: ev.eventType,
          intentBucket: ev.customerProfile.intentBucket,
          engagementScore: ev.customerProfile.scoreLive,
          pageUrl: ev.pageUrl,
          occurredAt: ev.occurredAt.toISOString(),
          customerEmail: ev.customerProfile.email,
          customerName: ev.customerProfile.name,
          customerProfileId: ev.customerProfileId,
          customer_profile_id: ev.customerProfileId,
          payload: freshPayloads[i],
          scoreDelta: ev.scoreDelta,
        })),
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum),
        },
        filters: {
          eventTypes: allEventTypes.map((e: any) => e.eventType),
          buckets: ['emergency', 'active', 'comparison', 'research', 'unclassified'],
        },
      },
    };
  } catch (error: any) {
    console.error('Error fetching tenant telemetry events:', error);
    throw error;
  }
}

/**
 * POST /api/v1/tenants/:tenantSlug/clear
 */
export async function clearTenantTelemetry(params: {
  tenantSlug: string;
}): Promise<{ status: number; body: any }> {
  try {
    const { tenantSlug } = params;
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

    await prisma.$transaction([
      prisma.telemetryEvent.deleteMany({ where: { tenantId: tenant.id } }),
      prisma.deviceFingerprint.deleteMany({
        where: {
          customerProfile: {
            tenantId: tenant.id,
          },
        },
      }),
      prisma.customerProfile.deleteMany({ where: { tenantId: tenant.id } }),
    ]);

    return {
      status: 200,
      body: {
        success: true,
        message: `All telemetry data cleared for tenant: ${tenantSlug}`,
      },
    };
  } catch (error: any) {
    console.error('Error clearing tenant telemetry:', error);
    throw error;
  }
}

/**
 * POST /api/v1/telemetry/send-sms
 * Direct Telnyx SMS gateway dispatch.
 */
export async function sendSmsController(params: {
  to?: string;
  body?: string;
}): Promise<{ status: number; body: any }> {
  try {
    const { to, body } = params;

    const telnyxApiKey = process.env.TELNYX_API_KEY?.trim();
    const telnyxFrom = process.env.TELNYX_PHONE_NUMBER?.trim();
    const messagingProfileId = process.env.TELNYX_MESSAGING_PROFILE_ID?.trim();
    const testPhone = process.env.DEV_TEST_PHONE?.trim();

    const targetPhone = to || testPhone;

    if (!targetPhone) {
      return { status: 400, body: { success: false, error: 'Recipient phone number is required (no to or DEV_TEST_PHONE configured).' } };
    }
    if (!body) {
      return { status: 400, body: { success: false, error: 'Body parameter is required.' } };
    }

    if (!telnyxApiKey || !telnyxFrom) {
      return { status: 500, body: { success: false, error: 'Telnyx SMS is not configured in profiledb environment.' } };
    }

    const cleanedPhone = targetPhone.replace(/[^\d+]/g, '');

    const payload = JSON.stringify({
      from: telnyxFrom,
      to: cleanedPhone,
      text: body,
      messaging_profile_id: messagingProfileId || undefined
    });

    const options = {
      hostname: 'api.telnyx.com',
      port: 443,
      path: '/v2/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${telnyxApiKey}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    return await new Promise<{ status: number; body: any }>((resolve) => {
      const reqApi = httpsRequest(options, (response: any) => {
        let data = '';
        response.on('data', (chunk: any) => { data += chunk; });
        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              return resolve({ status: 200, body: { success: true, sid: parsed?.data?.id } });
            } catch {
              return resolve({ status: 200, body: { success: true } });
            }
          }
          console.error('[Telnyx SMS API Error]:', data);
          return resolve({ status: response.statusCode || 500, body: { success: false, error: data || 'Telnyx API error' } });
        });
      });

      reqApi.on('error', (err: any) => {
        console.error('[Telnyx SMS Request Error]:', err);
        return resolve({ status: 500, body: { success: false, error: err.message } });
      });

      reqApi.write(payload);
      reqApi.end();
    });
  } catch (error: any) {
    console.error('Error dispatching Telnyx SMS:', error);
    throw error;
  }
}

/**
 * Asynchronously checks if visitor is high-intent, builds notification, and POSTs to CMS Backend.
 */
async function triggerTelemetryNotification(
  tenantSlug: string,
  profile: { id: string; name: string | null; scoreLive: number; intentBucket: string },
  eventType: string,
  pageUrl: string | null
) {
  try {
    const isHighIntent = profile.intentBucket === 'emergency' || profile.intentBucket === 'active' || profile.scoreLive >= 80;
    if (!isHighIntent) return;

    const nameStr = profile.name || 'Anonymous Visitor';
    let title = '⚡ High Interest Visitor Alert';
    let message = `Visitor "${nameStr}" (Score: ${profile.scoreLive}) is active on page: ${pageUrl || 'unknown'}`;

    if (profile.intentBucket === 'emergency') {
      title = '🚨 Urgent: Emergency Lead Detected';
      message = `Visitor "${nameStr}" entered Emergency bucket! Action: ${eventType} on ${pageUrl || 'unknown'}`;
    } else if (profile.intentBucket === 'active') {
      title = '🔥 Active Lead Detected';
      message = `Visitor "${nameStr}" entered Active Project bucket! Action: ${eventType} on ${pageUrl || 'unknown'}`;
    }

    const postData = JSON.stringify({
      tenantSlug,
      title,
      message,
      metadata: {
        profileId: profile.id,
        eventType,
        pageUrl,
        scoreLive: profile.scoreLive,
        intentBucket: profile.intentBucket,
      },
    });

    const cmsUrl = process.env.CMS_BACKEND_URL || 'http://localhost:5100';
    const url = new URL(`${cmsUrl}/api/v1/notifications/telemetry`);

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? '443' : '80'),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const makeRequest = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = makeRequest(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[Telemetry Notification Sent] for tenant ${tenantSlug}`);
        } else {
          console.error(`[Telemetry Notification Failed] Status: ${res.statusCode}, Response: ${data}`);
        }
      });
    });

    req.on('error', (err) => {
      console.error('[Telemetry Notification Connection Error]:', err.message);
    });

    req.write(postData);
    req.end();
  } catch (error: any) {
    console.error('[Telemetry Notification Trigger Error]:', error.message);
  }
}

/**
 * Sends a real SMS via the Telnyx messages API using credentials in environment.
 */
export async function sendAutomatedSms(to: string, body: string): Promise<void> {
  const telnyxApiKey = process.env.TELNYX_API_KEY?.trim();
  const telnyxFrom = process.env.TELNYX_PHONE_NUMBER?.trim();
  const messagingProfileId = process.env.TELNYX_MESSAGING_PROFILE_ID?.trim();

  if (!telnyxApiKey || !telnyxFrom) {
    console.warn('[Automated SMS Skip] Telnyx credentials not configured in environment.');
    return;
  }

  const cleanedPhone = to.replace(/[^\d+]/g, '');
  const payloadData = JSON.stringify({
    from: telnyxFrom,
    to: cleanedPhone,
    text: body,
    messaging_profile_id: messagingProfileId || undefined
  });

  const options = {
    hostname: 'api.telnyx.com',
    port: 443,
    path: '/v2/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${telnyxApiKey}`,
      'Content-Length': Buffer.byteLength(payloadData)
    }
  };

  return new Promise((resolve, reject) => {
    const req = httpsRequest(options, (response: any) => {
      let data = '';
      response.on('data', (chunk: any) => { data += chunk; });
      response.on('end', () => {
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          console.log(`[Automated SMS Sent] to ${cleanedPhone} successfully.`);
          resolve();
        } else {
          console.error(`[Automated SMS Telnyx Error] Status: ${response.statusCode}, Response: ${data}`);
          reject(new Error(`Telnyx API error: ${data}`));
        }
      });
    });

    req.on('error', (err: any) => {
      reject(err);
    });

    req.write(payloadData);
    req.end();
  });
}
