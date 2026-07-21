-- ============================================================================
-- ClearSky pipeline decision rule book — Sections 3-7 seed
-- ============================================================================
--
-- WHY THIS EXISTS
-- The pipeline halts at Section 3 with "Business configuration missing", so
-- Sections 4-8 have never executed for any event. The cause is that the whole
-- decision layer was never seeded: pipeline_business_configs,
-- pipeline_signal_action_mappings, pipeline_action_library and
-- pipeline_safety_rules are all empty. The tables exist; the rows never landed.
--
-- Section 3 needs, in order:
--   1. a business config for the company              (else: business_config_missing)
--   2. a signal -> action mapping for the dominant signal
--                                                     (else: no_action_mappings_for_dominant_signal)
--   3. an action_library row per mapped action
-- Only then does `decisionResult.decided` become true and Sections 4-7 run.
--
-- SAFETY POSTURE
-- Every action is seeded as `approval_required`. That is deliberate:
--   * the approval lane needs no per-action handler in the execution engine
--     (the automatic lane dispatches on hardcoded action ids and would fail
--     for any id it doesn't know), and
--   * it preserves the reference doc's non-negotiable boundary — public
--     replies are drafted for a human, never auto-posted.
-- Result: Section 5 records `pending_approval`, Section 6 records
-- `waiting_for_approval`, Section 7 closes the loop — matching the APEX
-- worked example in the reference doc.
--
-- IDEMPOTENT: safe to run repeatedly. Ids are stable/readable (not cuid)
-- because `id` has no database default — Prisma generates cuids client-side,
-- so raw SQL must supply them.
--
-- RUN:
--   cd apps/lead-grabber-v1
--   set -a; . ./.env; set +a
--   psql "$DATABASE_URL" -f prisma/seed/pipeline-rulebook.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Action library — what the system is allowed to DO.
--    requiredParams keys must be ones action-queue-engine.resolveParameters()
--    actually knows how to fill, otherwise Section 4 resolves them to null.
-- ---------------------------------------------------------------------------
INSERT INTO pipeline_action_library
	(id, "actionId", name, domain, "isPublicFacing", "callsA2p", "defaultExecutionMode", "defaultOwner", "requiredParams", active)
VALUES
	('seed_act_a2p_001', 'ACT-A2P-001', 'Draft SMS reply to customer', 'COMM', true,  true,  'approval_required', 'business_owner',
		'["customer_name","phone_number","text_content","ai_summary","brand_tone"]'::jsonb, true),
	('seed_act_a2p_002', 'ACT-A2P-002', 'Notify assigned representative', 'TASK', false, false, 'approval_required', 'business_owner',
		'["customer_name","phone_number","ai_summary","urgency_level"]'::jsonb, true),
	('seed_act_a2p_003', 'ACT-A2P-003', 'Log and route communication', 'TASK', false, false, 'approval_required', 'system',
		'["event_type","provider","ai_summary","sentiment","intent"]'::jsonb, true),
	('seed_act_a2p_004', 'ACT-A2P-004', 'Emergency dispatch alert', 'TASK', false, true,  'approval_required', 'business_owner',
		'["emergency_type","customer_name","phone_number","urgency_level"]'::jsonb, true),
	('seed_act_a2p_005', 'ACT-A2P-005', 'Schedule callback within SLA', 'TASK', false, false, 'approval_required', 'business_owner',
		'["customer_name","phone_number","urgency_level"]'::jsonb, true),
	('seed_act_a2p_006', 'ACT-A2P-006', 'Log complaint theme', 'TASK', false, false, 'approval_required', 'system',
		'["complaint_topics","sentiment","ai_summary"]'::jsonb, true),
	('seed_act_a2p_007', 'ACT-A2P-007', 'Create booking follow-up task', 'TASK', false, false, 'approval_required', 'business_owner',
		'["customer_name","phone_number","ai_summary","intent"]'::jsonb, true),
	('seed_act_a2p_008', 'ACT-A2P-008', 'Create quote / estimate opportunity', 'TASK', false, false, 'approval_required', 'business_owner',
		'["customer_name","phone_number","ai_summary","intent"]'::jsonb, true)
ON CONFLICT ("actionId") DO UPDATE SET
	name                   = EXCLUDED.name,
	domain                 = EXCLUDED.domain,
	"isPublicFacing"       = EXCLUDED."isPublicFacing",
	"callsA2p"             = EXCLUDED."callsA2p",
	"defaultExecutionMode" = EXCLUDED."defaultExecutionMode",
	"defaultOwner"         = EXCLUDED."defaultOwner",
	"requiredParams"       = EXCLUDED."requiredParams",
	active                 = EXCLUDED.active;

-- ---------------------------------------------------------------------------
-- 2. Signal -> action mappings, one primary + one secondary per SIG-COMM rule.
--    companyId NULL = global (applies to every company).
--    Without a row here the dominant signal maps to nothing and Section 3
--    returns no_action_mappings_for_dominant_signal.
-- ---------------------------------------------------------------------------
INSERT INTO pipeline_signal_action_mappings
	(id, "signalRuleId", "actionId", "isPrimary", "isSecondary", "companyId", active)
--    NOTE: ACT-A2P-001 (draft SMS reply) is intentionally NOT mapped. Customer-facing
--    replies are owned by process_orchestrator; queueing a pipeline SMS draft as well
--    would put a second competing draft in front of the approver for the same message.
--    Every mapped action below is an INTERNAL task.
VALUES
	-- SIG-COMM-000 EMERGENCY_SERVICE (Risk)
	('seed_map_000_p', 'SIG-COMM-000', 'ACT-A2P-004', true,  false, NULL, true),
	('seed_map_000_s', 'SIG-COMM-000', 'ACT-A2P-002', false, true,  NULL, true),
	-- SIG-COMM-001 HIGH_PRIORITY_CONTACT (Risk)
	('seed_map_001_p', 'SIG-COMM-001', 'ACT-A2P-002', true,  false, NULL, true),
	('seed_map_001_s', 'SIG-COMM-001', 'ACT-A2P-005', false, true,  NULL, true),
	-- SIG-COMM-002 NEW_QUOTE_REQUEST (Opportunity)
	('seed_map_002_p', 'SIG-COMM-002', 'ACT-A2P-008', true,  false, NULL, true),
	('seed_map_002_s', 'SIG-COMM-002', 'ACT-A2P-002', false, true,  NULL, true),
	-- SIG-COMM-003 CRITICAL_CHURN_RISK (Risk)
	('seed_map_003_p', 'SIG-COMM-003', 'ACT-A2P-002', true,  false, NULL, true),
	('seed_map_003_s', 'SIG-COMM-003', 'ACT-A2P-006', false, true,  NULL, true),
	-- SIG-COMM-004 BOOKING_INQUIRY (Momentum)  <- the demo's booking path
	('seed_map_004_p', 'SIG-COMM-004', 'ACT-A2P-007', true,  false, NULL, true),
	('seed_map_004_s', 'SIG-COMM-004', 'ACT-A2P-002', false, true,  NULL, true),
	-- SIG-COMM-005 CALLBACK_REQUESTED (Bottleneck)
	('seed_map_005_p', 'SIG-COMM-005', 'ACT-A2P-005', true,  false, NULL, true),
	('seed_map_005_s', 'SIG-COMM-005', 'ACT-A2P-002', false, true,  NULL, true),
	-- SIG-COMM-006 SERVICE_COMPLAINT (Bottleneck)
	('seed_map_006_p', 'SIG-COMM-006', 'ACT-A2P-006', true,  false, NULL, true),
	('seed_map_006_s', 'SIG-COMM-006', 'ACT-A2P-002', false, true,  NULL, true),
	-- SIG-COMM-007 GENERAL_MESSAGE (Momentum)
	('seed_map_007_p', 'SIG-COMM-007', 'ACT-A2P-003', true,  false, NULL, true)
ON CONFLICT (id) DO UPDATE SET
	"signalRuleId" = EXCLUDED."signalRuleId",
	"actionId"     = EXCLUDED."actionId",
	"isPrimary"    = EXCLUDED."isPrimary",
	"isSecondary"  = EXCLUDED."isSecondary",
	active         = EXCLUDED.active;

-- Keep re-runs declarative: drop any previously-seeded mapping that this file no longer
-- defines, so removing a row here actually removes it from the database.
DELETE FROM pipeline_signal_action_mappings
WHERE id LIKE 'seed_map_%'
  AND id NOT IN (
	'seed_map_000_p','seed_map_000_s','seed_map_001_p','seed_map_001_s',
	'seed_map_002_p','seed_map_002_s','seed_map_003_p','seed_map_003_s',
	'seed_map_004_p','seed_map_004_s','seed_map_005_p','seed_map_005_s',
	'seed_map_006_p','seed_map_006_s','seed_map_007_p'
  );

-- ---------------------------------------------------------------------------
-- 3. Business config, one row per existing company.
--    Deliberately NARROW: every column keeps its conservative schema default
--    (approval required, draft_only, no SMS auto-reply). officeTimezone is set
--    to America/Toronto to match BUSINESS_TIME_ZONE in google-calendar.ts
--    rather than the schema's 'UTC' default.
-- ---------------------------------------------------------------------------
INSERT INTO pipeline_business_configs
	(id, "companyId", "consultantReviewRequired", "primaryInternalOwner", "approvalRoute",
	 "autoNotifyConsultant", "autoNotifyBusinessOwner", "reviewReplyPolicy",
	 "publicResponseRequiresApproval", "brandTone", "slaResponseHours", "slaMinutes",
	 "smsAutoReplyAllowed", "officeTimezone", "maxRetries", "maxReplyLength", active, "updatedAt")
SELECT
	'seed_bc_' || c.id, c.id, true, 'consultant', 'consultant_then_client',
	true, false, 'draft_only',
	true, 'professional', 24, 10,
	false, 'America/Toronto', 3, 150, true, NOW()
FROM companies c
ON CONFLICT ("companyId") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Safety rules — ONE narrow rule encoding the reference doc's
--    non-negotiable: never auto-post a public-facing action.
--
--    Deliberately narrow. evaluateConditions() treats an empty/NULL conditions
--    object as a MATCH, and a matching rule BLOCKS the action — a broad rule
--    would block every action and trip `all_actions_blocked`, putting us right
--    back to Sections 4-8 never running. Both conditions must hold, and since
--    every seeded action is `approval_required` (never `automatic`), this rule
--    blocks nothing today; it is a guard for future automatic actions.
-- ---------------------------------------------------------------------------
INSERT INTO pipeline_safety_rules
	(id, "ruleId", "ruleName", conditions, "blockReason", severity, active)
VALUES
	('seed_saf_001', 'SAF-001', 'Never auto-post a public-facing action',
		'{"action_is_public_facing":{"operator":"=","value":true},"execution_mode":{"operator":"=","value":"automatic"}}'::jsonb,
		'Public-facing actions require human approval before posting.', 10, true),
	-- SAF-004 from the canonical rule book (002_seed_rules.sql). Ported because it evaluates
	-- ai_confidence_score, which buildEventData already supplies. Like SAF-001 it is narrow: both
	-- conditions must hold, so it cannot block the approval-lane actions we seed today.
	-- SAF-002 (legal threat) and SAF-003 (business match) are NOT ported — they test fields this
	-- implementation does not extract, so seeding them would create rules that can never evaluate.
	('seed_saf_004', 'SAF-004', 'Block low-confidence public action',
		'{"action_is_public_facing":{"operator":"=","value":true},"ai_confidence_score":{"operator":"<","value":0.7}}'::jsonb,
		'AI confidence too low for an automatic public-facing action; needs human review.', 9, true)
ON CONFLICT ("ruleId") DO UPDATE SET
	"ruleName"    = EXCLUDED."ruleName",
	conditions    = EXCLUDED.conditions,
	"blockReason" = EXCLUDED."blockReason",
	severity      = EXCLUDED.severity,
	active        = EXCLUDED.active;

COMMIT;

-- Verify what landed:
SELECT 'action_library'        AS table, count(*) FROM pipeline_action_library
UNION ALL SELECT 'signal_action_mappings', count(*) FROM pipeline_signal_action_mappings
UNION ALL SELECT 'business_configs',       count(*) FROM pipeline_business_configs
UNION ALL SELECT 'safety_rules',           count(*) FROM pipeline_safety_rules;
