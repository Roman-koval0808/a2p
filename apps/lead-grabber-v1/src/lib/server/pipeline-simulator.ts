import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";

// -------------------------------------------------------------
// TYPES & SCHEMAS
// -------------------------------------------------------------

export interface RuleCondition {
  operator:
    | ">="
    | "<="
    | "="
    | ">"
    | "<"
    | "not_empty"
    | "empty"
    | "contains_any"
    | "is_null"
    | "is_not_null";
  value?: any;
}

export interface SignalRule {
  signal_rule_id: string;
  signal_name: string;
  event_type: string;
  provider?: string;
  network_category?: string;
  signal_bucket: string;
  active: boolean;
  conditions: Record<string, RuleCondition>;
  required_fields: string[];
  cooldown_hours?: number;
  default_priority: number;
  default_confidence: number;
  purpose?: string;
}

// -------------------------------------------------------------
// RULE BOOKS DEFINITION
// -------------------------------------------------------------

export const GBP_REVIEW_RULES: SignalRule[] = [
  {
    signal_rule_id: "SIG-TRUST-001",
    signal_name: "negative_review_risk",
    event_type: "review_received",
    provider: "google_business_profile",
    network_category: "Trust",
    signal_bucket: "Risk",
    active: true,
    conditions: {
      review_rating: { operator: "<=", value: 2 },
    },
    required_fields: ["review_rating"],
    default_priority: 1,
    default_confidence: 1.0,
    purpose:
      "A 1-star or 2-star review may damage trust and should be reviewed quickly.",
  },
  {
    signal_rule_id: "SIG-TRUST-002",
    signal_name: "neutral_review_improvement_opportunity",
    event_type: "review_received",
    provider: "google_business_profile",
    network_category: "Trust",
    signal_bucket: "Opportunity",
    active: true,
    conditions: {
      review_rating: { operator: "=", value: 3 },
    },
    required_fields: ["review_rating"],
    default_priority: 2,
    default_confidence: 1.0,
    purpose: "A 3-star review may show a fixable customer experience issue.",
  },
  {
    signal_rule_id: "SIG-TRUST-003",
    signal_name: "positive_review_received",
    event_type: "review_received",
    provider: "google_business_profile",
    network_category: "Trust",
    signal_bucket: "Momentum",
    active: true,
    conditions: {
      review_rating: { operator: ">=", value: 4 },
    },
    required_fields: ["review_rating"],
    default_priority: 3,
    default_confidence: 1.0,
    purpose: "A 4-star or 5-star review adds trust momentum.",
  },
  {
    signal_rule_id: "SIG-TRUST-004",
    signal_name: "positive_review_with_minor_issue",
    event_type: "review_received",
    provider: "google_business_profile",
    network_category: "Trust",
    signal_bucket: "Opportunity",
    active: true,
    conditions: {
      review_rating: { operator: ">=", value: 4 },
      "ai_context.contains_problem": { operator: "=", value: true },
      "ai_context.confidence_score": { operator: ">=", value: 0.8 },
    },
    required_fields: [
      "business_id",
      "review_rating",
      "review_text",
      "ai_context.contains_problem",
    ],
    cooldown_hours: 24,
    default_priority: 3,
    default_confidence: 0.88,
    purpose:
      "The customer is generally happy, but the review reveals a specific issue the business can improve.",
  },
  {
    signal_rule_id: "SIG-TRUST-005",
    signal_name: "communication_experience_issue_detected",
    event_type: "review_received",
    provider: "google_business_profile",
    network_category: "Trust",
    signal_bucket: "Bottleneck",
    active: true,
    conditions: {
      "ai_context.contains_problem": { operator: "=", value: true },
      "ai_context.complaint_topics": {
        operator: "contains_any",
        value: [
          "communication",
          "slow response",
          "not called back",
          "poor follow-up",
          "appointment communication",
        ],
      },
      "ai_context.confidence_score": { operator: ">=", value: 0.8 },
    },
    required_fields: [
      "business_id",
      "review_text",
      "ai_context.contains_problem",
    ],
    cooldown_hours: 72,
    default_priority: 2,
    default_confidence: 0.9,
    purpose:
      "The review suggests a communication process issue specifically identified as a problem.",
  },
  {
    signal_rule_id: "SIG-TRUST-006",
    signal_name: "service_quality_praise_detected",
    event_type: "review_received",
    provider: "google_business_profile",
    network_category: "Trust",
    signal_bucket: "Momentum",
    active: true,
    conditions: {
      "ai_context.praise_topics": { operator: "not_empty" },
      "ai_context.contains_problem": { operator: "=", value: false },
      review_rating: { operator: ">=", value: 4 },
      "ai_context.confidence_score": { operator: ">=", value: 0.8 },
    },
    required_fields: ["review_rating", "ai_context.praise_topics"],
    default_priority: 3,
    default_confidence: 0.9,
    purpose:
      "The review contains positive language with no identified problems.",
  },
  {
    signal_rule_id: "SIG-TRUST-007",
    signal_name: "positive_review_reply_needed",
    event_type: "review_received",
    provider: "google_business_profile",
    network_category: "Trust",
    signal_bucket: "Opportunity",
    active: true,
    conditions: {
      review_rating: { operator: ">=", value: 4 },
      business_reply_completed: { operator: "=", value: false },
      elapsed_hours: { operator: ">=", value: 24 },
    },
    required_fields: [
      "business_id",
      "review_rating",
      "business_reply_completed",
    ],
    default_priority: 2,
    default_confidence: 0.9,
    purpose:
      "A business should still respond to positive reviews to strengthen trust and show engagement.",
  },
  {
    signal_rule_id: "SIG-TRUST-008",
    signal_name: "negative_review_response_needed",
    event_type: "review_received",
    provider: "google_business_profile",
    network_category: "Trust",
    signal_bucket: "Risk",
    active: true,
    conditions: {
      review_rating: { operator: "<=", value: 2 },
      business_reply_completed: { operator: "=", value: false },
      elapsed_hours: { operator: ">=", value: 2 },
    },
    required_fields: [
      "business_id",
      "review_rating",
      "business_reply_completed",
    ],
    default_priority: 1,
    default_confidence: 0.9,
    purpose: "Negative reviews need a faster response window.",
  },
  {
    signal_rule_id: "SIG-TRUST-009",
    signal_name: "mixed_review_reply_needed",
    event_type: "review_received",
    provider: "google_business_profile",
    network_category: "Trust",
    signal_bucket: "Opportunity",
    active: true,
    conditions: {
      review_rating: { operator: ">=", value: 4 },
      "ai_context.contains_problem": { operator: "=", value: true },
      business_reply_completed: { operator: "=", value: false },
      elapsed_hours: { operator: ">=", value: 12 },
    },
    required_fields: [
      "business_id",
      "review_rating",
      "ai_context.contains_problem",
      "business_reply_completed",
    ],
    cooldown_hours: 48,
    default_priority: 2,
    default_confidence: 0.9,
    purpose:
      "A mostly positive review with an identified problem is a chance to thank the customer and acknowledge the improvement area.",
  },
  {
    signal_rule_id: "SIG-TRUST-010",
    signal_name: "repeated_communication_bottleneck_detected",
    event_type: "review_received",
    provider: "google_business_profile",
    network_category: "Trust",
    signal_bucket: "Bottleneck",
    active: true,
    conditions: {
      "ai_context.complaint_topics": {
        operator: "contains_any",
        value: [
          "communication",
          "slow response",
          "not called back",
          "poor follow-up",
          "appointment communication",
        ],
      },
      count_reviews_with_communication_complaints_last_30_days: {
        operator: ">=",
        value: 3,
      },
    },
    required_fields: ["business_id", "ai_context.complaint_topics"],
    default_priority: 1,
    default_confidence: 0.9,
    purpose:
      "One communication complaint may be a minor issue. Three in 30 days may indicate a real process problem.",
  },
  {
    signal_rule_id: "SIG-TRUST-011",
    signal_name: "review_rating_decline_detected",
    event_type: "review_received",
    provider: "google_business_profile",
    network_category: "Trust",
    signal_bucket: "Performance",
    active: true,
    conditions: {
      rating_drop_detected: { operator: "=", value: true },
    },
    required_fields: ["business_id"],
    default_priority: 1,
    default_confidence: 0.9,
    purpose: "The business reputation may be weakening.",
  },
  {
    signal_rule_id: "SIG-TRUST-012",
    signal_name: "review_momentum_increasing",
    event_type: "review_received",
    provider: "google_business_profile",
    network_category: "Trust",
    signal_bucket: "Momentum",
    active: true,
    conditions: {
      count_reviews_last_30_days: { operator: ">", value: 0 },
      momentum_increasing: { operator: "=", value: true },
    },
    required_fields: ["business_id"],
    default_priority: 3,
    default_confidence: 0.9,
    purpose: "The business is gaining trust momentum.",
  },
  {
    signal_rule_id: "SIG-TRUST-013",
    signal_name: "review_velocity_competitive_gap",
    event_type: "review_received",
    provider: "google_business_profile",
    network_category: "Trust",
    signal_bucket: "Competitive",
    active: true,
    conditions: {
      review_velocity_lagging: { operator: "=", value: true },
    },
    required_fields: ["business_id"],
    default_priority: 2,
    default_confidence: 0.85,
    purpose:
      "The business may be falling behind competitors in review acquisition.",
  },
  {
    signal_rule_id: "SIG-TRUST-014",
    signal_name: "reputation_advantage_detected",
    event_type: "review_received",
    provider: "google_business_profile",
    network_category: "Trust",
    signal_bucket: "Competitive",
    active: true,
    conditions: {
      reputation_advantage_detected: { operator: "=", value: true },
    },
    required_fields: ["business_id"],
    default_priority: 3,
    default_confidence: 0.85,
    purpose:
      "The business may have a reputation advantage that can be used in marketing.",
  },
  {
    signal_rule_id: "SIG-TRUST-015",
    signal_name: "testimonial_candidate_detected",
    event_type: "review_received",
    provider: "google_business_profile",
    network_category: "Trust",
    signal_bucket: "Opportunity",
    active: true,
    conditions: {
      review_rating: { operator: ">=", value: 4 },
      "ai_context.praise_topics": { operator: "not_empty" },
      "ai_context.complaint_topics": { operator: "empty" },
      "ai_context.confidence_score": { operator: ">=", value: 0.85 },
    },
    required_fields: [
      "review_rating",
      "ai_context.praise_topics",
      "ai_context.complaint_topics",
    ],
    default_priority: 3,
    default_confidence: 0.9,
    purpose: "A strong positive review may be useful as a testimonial.",
  },
  {
    signal_rule_id: "SIG-TRUST-016",
    signal_name: "service_proof_point_detected",
    event_type: "review_received",
    provider: "google_business_profile",
    network_category: "Trust",
    signal_bucket: "Opportunity",
    active: true,
    conditions: {
      "ai_context.service_mentioned": { operator: "is_not_null" },
      review_rating: { operator: ">=", value: 4 },
      "ai_context.praise_topics": { operator: "not_empty" },
    },
    required_fields: [
      "ai_context.service_mentioned",
      "review_rating",
      "ai_context.praise_topics",
    ],
    default_priority: 3,
    default_confidence: 0.9,
    purpose:
      "The review provides proof that the business performed well on a specific service.",
  },
  {
    signal_rule_id: "SIG-TRUST-017",
    signal_name: "safety_compliance_risk_detected",
    event_type: "review_received",
    provider: "google_business_profile",
    network_category: "Trust",
    signal_bucket: "Risk",
    active: true,
    conditions: {
      "ai_context.contains_emergency_keywords": { operator: "=", value: true },
      "ai_context.contains_problem": { operator: "=", value: true },
      "ai_context.confidence_score": { operator: ">=", value: 0.8 },
    },
    required_fields: [
      "business_id",
      "review_text",
      "ai_context.contains_emergency_keywords",
    ],
    default_priority: 1,
    default_confidence: 0.9,
    purpose:
      "The review mentions a safety concern or emergency situation which is a high-risk liability.",
  },
];

export const TELNYX_SIGNAL_RULES: SignalRule[] = [
  {
    signal_rule_id: "SIG-COMM-000",
    signal_name: "EMERGENCY_SERVICE",
    event_type: "voicemail_received",
    provider: "telnyx_voice",
    network_category: "Communication",
    signal_bucket: "Risk",
    active: true,
    conditions: {
      "ai_context.contains_emergency_keywords": { operator: "=", value: true },
    },
    required_fields: ["ai_context.contains_emergency_keywords"],
    default_priority: 1,
    default_confidence: 1.0,
    purpose: "Critical emergency services requiring immediate dispatch bypass.",
  },
  {
    signal_rule_id: "SIG-COMM-001",
    signal_name: "HIGH_PRIORITY_CONTACT",
    event_type: "voicemail_received",
    provider: "telnyx_voice",
    network_category: "Communication",
    signal_bucket: "Risk",
    active: true,
    conditions: {
      "ai_context.contains_quote_request": { operator: "=", value: true },
      "ai_context.contains_callback_request": { operator: "=", value: true },
    },
    required_fields: [
      "ai_context.contains_quote_request",
      "ai_context.contains_callback_request",
    ],
    default_priority: 1,
    default_confidence: 0.95,
    purpose:
      "Quote requests combined with callback requests are high-value leads requiring immediate response.",
  },
  {
    signal_rule_id: "SIG-COMM-002",
    signal_name: "NEW_QUOTE_REQUEST",
    event_type: "voicemail_received",
    provider: "telnyx_voice",
    network_category: "Communication",
    signal_bucket: "Opportunity",
    active: true,
    conditions: {
      "ai_context.contains_quote_request": { operator: "=", value: true },
    },
    required_fields: ["ai_context.contains_quote_request"],
    default_priority: 1,
    default_confidence: 0.9,
    purpose: "Potential new business leads asking for pricing.",
  },
  {
    signal_rule_id: "SIG-COMM-003",
    signal_name: "CRITICAL_CHURN_RISK",
    event_type: "voicemail_received",
    provider: "telnyx_voice",
    network_category: "Communication",
    signal_bucket: "Risk",
    active: true,
    conditions: {
      "ai_context.contains_problem": { operator: "=", value: true },
      "ai_context.contains_callback_request": { operator: "=", value: true },
    },
    required_fields: [
      "ai_context.contains_problem",
      "ai_context.contains_callback_request",
    ],
    default_priority: 1,
    default_confidence: 0.85,
    purpose:
      "Customers with problems who are explicitly asking for a call back are high churn risks.",
  },
  {
    signal_rule_id: "SIG-COMM-004",
    signal_name: "BOOKING_INQUIRY",
    event_type: "voicemail_received",
    provider: "telnyx_voice",
    network_category: "Communication",
    signal_bucket: "Momentum",
    active: true,
    conditions: {
      "ai_context.service_mentioned": { operator: "is_not_null" },
      "ai_context.contains_quote_request": { operator: "=", value: false },
      "ai_context.requested_action": { operator: "!=", value: "praise" },
    },
    required_fields: ["ai_context.service_mentioned"],
    default_priority: 1,
    default_confidence: 0.9,
    purpose:
      "Customers asking about specific services represent potential revenue.",
  },
  {
    signal_rule_id: "SIG-COMM-005",
    signal_name: "CALLBACK_REQUESTED",
    event_type: "voicemail_received",
    provider: "telnyx_voice",
    network_category: "Communication",
    signal_bucket: "Bottleneck",
    active: true,
    conditions: {
      "ai_context.contains_callback_request": { operator: "=", value: true },
    },
    required_fields: ["ai_context.contains_callback_request"],
    default_priority: 1,
    default_confidence: 0.9,
    purpose:
      "Any explicit request for a callback is a high-priority revenue opportunity.",
  },
  {
    signal_rule_id: "SIG-COMM-006",
    signal_name: "SERVICE_COMPLAINT",
    event_type: "voicemail_received",
    provider: "telnyx_voice",
    network_category: "Communication",
    signal_bucket: "Bottleneck",
    active: true,
    conditions: {
      "ai_context.contains_problem": { operator: "=", value: true },
    },
    required_fields: ["ai_context.contains_problem"],
    default_priority: 2,
    default_confidence: 0.85,
    purpose: "General customer complaints detected semantically.",
  },
  {
    signal_rule_id: "SIG-COMM-007",
    signal_name: "GENERAL_MESSAGE",
    event_type: "voicemail_received",
    provider: "telnyx_voice",
    network_category: "Communication",
    signal_bucket: "Momentum",
    active: true,
    conditions: {
      "ai_context.contains_problem": { operator: "=", value: false },
      "ai_context.contains_quote_request": { operator: "=", value: false },
      "ai_context.contains_callback_request": { operator: "=", value: false },
    },
    required_fields: [],
    default_priority: 3,
    default_confidence: 0.9,
    purpose: "Message doesn't contain specific high-priority facts.",
  },
];

export const SAFETY_COMPLIANCE_RULES = [
  {
    rule_id: "SAF-001",
    rule_name: "never_autopost_negative_reviews",
    conditions: {
      rating: { operator: "<=", value: 2 },
      action_is_public_facing: { operator: "=", value: true },
      execution_mode: { operator: "=", value: "automatic" },
    },
    block_reason:
      "Safety Rule SAF-001: Automatic posting is prohibited for reviews with 2 stars or fewer.",
    severity: 3,
  },
  {
    rule_id: "SAF-002",
    rule_name: "never_autopost_emergencies",
    conditions: {
      signal_rule_id: { operator: "=", value: "SIG-TRUST-017" },
      action_is_public_facing: { operator: "=", value: true },
      execution_mode: { operator: "=", value: "automatic" },
    },
    block_reason:
      "Safety Rule SAF-002: Safety compliance concerns or emergencies require manual consultant review.",
    severity: 3,
  },
];

// -------------------------------------------------------------
// CONDITION EVALUATOR
// -------------------------------------------------------------

function checkCondition(
  field: string,
  condition: RuleCondition,
  actual: any,
): { pass: boolean; detail: string } {
  const { operator, value } = condition;
  const fieldName = field.replace("ai_context.", "").replace(/_/g, " ");

  let pass = false;
  let detail = "";

  const tryFloat = (v: any) => {
    if (v === null || v === undefined) return NaN;
    return parseFloat(v);
  };

  switch (operator) {
    case "=":
      pass = actual == value;
      detail = pass
        ? `${fieldName} is exactly ${value}`
        : `${fieldName} ${actual} is not ${value}`;
      break;
    case ">":
      pass = tryFloat(actual) > tryFloat(value);
      detail = pass
        ? `${fieldName} ${actual} is > ${value}`
        : `${fieldName} ${actual} is not greater than ${value}`;
      break;
    case ">=":
      pass = tryFloat(actual) >= tryFloat(value);
      detail = pass
        ? `${fieldName} ${actual} is >= ${value}`
        : `${fieldName} ${actual} is below threshold ${value}`;
      break;
    case "<":
      pass = tryFloat(actual) < tryFloat(value);
      detail = pass
        ? `${fieldName} ${actual} is < ${value}`
        : `${fieldName} ${actual} is not less than ${value}`;
      break;
    case "<=":
      pass = tryFloat(actual) <= tryFloat(value);
      detail = pass
        ? `${fieldName} ${actual} is <= ${value}`
        : `${fieldName} ${actual} is above risk threshold ${value}`;
      break;
    case "contains_any":
      if (actual === null || actual === undefined) {
        pass = false;
        detail = `${fieldName} data missing`;
      } else if (!Array.isArray(value)) {
        pass = false;
        detail = `operator requires list value`;
      } else {
        const actualList = Array.isArray(actual)
          ? actual.map((v) => String(v).toLowerCase())
          : [String(actual).toLowerCase()];
        const matches = value.filter((v: string) =>
          actualList.some((av: string) => av.includes(v.toLowerCase())),
        );
        pass = matches.length > 0;
        detail = pass
          ? `${fieldName} mentions ${matches.join(", ")}`
          : `${fieldName} does not mention requested topics`;
      }
      break;
    case "not_empty":
    case "is_not_null":
      pass =
        actual !== null &&
        actual !== undefined &&
        (typeof actual === "string" ? actual.length > 0 : true) &&
        (Array.isArray(actual) ? actual.length > 0 : true);
      detail = pass
        ? `${fieldName} exists`
        : `${fieldName} is empty or missing`;
      break;
    case "empty":
    case "is_null":
      pass =
        actual === null ||
        actual === undefined ||
        (typeof actual === "string" ? actual.length === 0 : false) ||
        (Array.isArray(actual) ? actual.length === 0 : false);
      detail = pass
        ? `${fieldName} is empty or missing`
        : `${fieldName} has data`;
      break;
    default:
      detail = `Unknown operator ${operator}`;
  }

  return { pass, detail };
}

function evaluateConditions(
  conditions: Record<string, RuleCondition>,
  data: any,
): boolean {
  for (const [field, condition] of Object.entries(conditions)) {
    const actual = data[field];
    const { pass } = checkCondition(field, condition, actual);
    if (!pass) return false;
  }
  return true;
}

// -------------------------------------------------------------
// PIPELINE ENGINE CORE
// -------------------------------------------------------------

export class PipelineSimulator {
  static async run(payload: {
    author_name: string;
    customer_email?: string;
    customer_phone?: string;
    rating: number;
    comment: string;
    mode: "review" | "call" | "sms" | "email" | "faq";
    sessionId: string;
  }) {
    const traceId = `trc_${Math.random().toString(36).substring(2, 9)}`;
    const pipelineSteps: string[] = [];
    const nowStr = () =>
      new Date().toISOString().replace("T", " ").replace("Z", "").slice(0, 23);

    const log = (msg: string, details?: any) => {
      const timestamp = nowStr();
      let icon = "🔵";
      if (msg.startsWith("Rule ") || msg.includes("Family Group")) icon = "🌸";
      if (msg.includes("MATCHED") || msg.includes("completed successfully"))
        icon = "✅";
      if (
        msg.includes("blocked") ||
        msg.includes("BLOCKED") ||
        msg.includes("WARNING")
      )
        icon = "🟡";
      if (
        msg.includes("error") ||
        msg.includes("ERROR") ||
        msg.includes("failed")
      )
        icon = "🔴";

      let entry = `${icon} [${timestamp}] [${traceId}] ${msg}`;
      if (details) {
        const dataStr =
          typeof details === "string"
            ? details
            : JSON.stringify(details, null, 2);
        entry += `\n   ╰─ Context: ${dataStr.replace(/\n/g, "\n   ")}`;
      }
      pipelineSteps.push(entry);
      console.log(entry);
    };

    log(
      `--- [UNIFIED PIPELINE START] Provider: ${payload.mode} | Trace: ${traceId} ---`,
    );

    try {
      // ---------------------------------------------------------
      // PHASE 1: EVENT INTAKE & NORMALIZATION (Steps 1–5)
      // ---------------------------------------------------------
      log(
        `[Step 1] Raw data received: Provider hands us a review/telemetry from "${payload.author_name || "Anonymous"}"`,
      );

      let provider = "google_business_profile";
      let eventType = "review_received";
      if (payload.mode === "call") {
        provider = "telnyx_voice";
        eventType = "voicemail_received";
      } else if (payload.mode === "sms") {
        provider = "telnyx_sms";
        eventType = "sms_received";
      } else if (payload.mode === "email") {
        provider = "google_workspace_email";
        eventType = "email_received";
      } else if (payload.mode === "faq") {
        provider = "google_business_profile";
        eventType = "faq_received";
      }

      log(
        `[Step 2/3] Official naming: Mapping "${payload.mode}" intake to internal event "${eventType}"`,
      );
      log(
        `[Step 4/5] Tidying up: Normalized rating to ${payload.rating || "N/A"} stars`,
      );

      // ---------------------------------------------------------
      // Step 6: Finding business & Profile Progressive Resolution
      // ---------------------------------------------------------
      const business = {
        id: "clearsky-demo",
        business_id: "clearsky-demo",
        name: "ClearSky Plumbers",
        market_id: "market_timmins",
      };
      log(
        `[Step 6] Finding business: Mapped to "${business.name}" (${business.business_id})`,
      );
      log(
        `[Step 6b] Identity Resolution: Resolving profile for "${payload.author_name || "Anonymous"}"...`,
      );
      // Q2 tier resolution for the simulator: verified email/phone = Tier 1, else Tier 2B
      const resolvedTier =
        payload.customer_email || payload.customer_phone ? "Tier 1" : "Tier 2B";
      const customerProfile = {
        id: `cp_${Math.random().toString(36).substring(2, 9)}`,
        display_name: payload.author_name || "Anonymous",
        email: payload.customer_email || "test@example.com",
        phone: payload.customer_phone || "+15550009999",
        tier: resolvedTier,
      };
      log(
        `[Step 6b] Q2 Attribution: Resolved tier = "${resolvedTier}" (${resolvedTier === "Tier 1" ? "verified identifier present" : "anonymous — no email/phone"})`,
      );
      log(
        `[Step 6b] Identity Resolution Complete: profile ID ${customerProfile.id}`,
      );

      // ---------------------------------------------------------
      // Step 7: Duplicate / Suppression check
      // ---------------------------------------------------------
      log(
        `[Step 7] Copy check: No previous record found. Suppressions: CLEAN - No duplicate content`,
      );

      // ---------------------------------------------------------
      // Step 8: AI Extraction (GPT-4o-mini / fallback)
      // ---------------------------------------------------------
      log(
        `[Step 8] AI Extraction: Identifying sentiment, topics, and service mentions...`,
      );
      let extraction: any = null;
      const apiKey = process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY;

      if (apiKey && payload.comment.length > 0) {
        try {
          const openai = new OpenAI({ apiKey });
          const systemPrompt = `You are a semantic parser for a home services business. Your job is to extract raw facts from customer messages (SMS, reviews, voicemails). Do NOT make decisions. Return JSON containing:
{
  "contains_problem": boolean,
  "contains_quote_request": boolean,
  "contains_callback_request": boolean,
  "contains_emergency_keywords": boolean,
  "requested_contact_method": "phone"|"email"|"text"|"none",
  "requested_action": string,
  "detected_keywords": string[],
  "service_requested": string,
  "sentiment": string,
  "praise_topics": string[],
  "complaint_topics": string[],
  "summary": string,
  "confidence_score": number,
  "urgency_level": "low"|"medium"|"high",
  "customer_name": "string (the name of the customer if explicitly mentioned in message, e.g. 'sam' from 'sam here', otherwise null)",
  "has_name": boolean
}`;
          const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: payload.comment },
            ],
            temperature: 0,
            response_format: { type: "json_object" },
          });
          const content = response.choices[0].message.content || "{}";
          extraction = JSON.parse(content);
          log(`[Step 8] AI extraction completed successfully`);
        } catch (e) {
          console.error(
            "OpenAI Extraction failed, falling back to heuristics",
            e,
          );
        }
      }

      if (!extraction) {
        // Heuristic fallback
        const text = payload.comment.toLowerCase();
        const hasProblem =
          text.includes("leak") ||
          text.includes("died") ||
          text.includes("slow") ||
          text.includes("problem") ||
          text.includes("complaint") ||
          text.includes("mess");
        const hasQuote =
          text.includes("quote") ||
          text.includes("price") ||
          text.includes("estimate") ||
          text.includes("new roof") ||
          text.includes("cost");
        const hasCallback =
          text.includes("call me back") ||
          text.includes("callback") ||
          text.includes("phone");
        const hasEmergency =
          text.includes("urgent") ||
          text.includes("asap") ||
          text.includes("emergency") ||
          text.includes("water");

        // Simple helper function to extract name from text in fallback mode
        const extractNameFromText = (content: string): string | null => {
          if (!content) return null;
          const clauses = content.split(/[.,\/#!$%\^&\*;:{}=\-_`~()\n?]/);
          const patterns = [
            /(?:I'm|I am)\s+(?:new\s+customer,\s+)?([A-Za-z]+)/i,
            /this is\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
            /my name is\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
            /([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+here/i,
            /([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+speaking/i
          ];
          const blacklist = ['a', 'the', 'an', 'some', 'someone', 'here', 'speaking', 'there', 'just', 'please', 'we', 'you', 'they', 'our', 'my', 'your', 'about', 'not', 'this', 'is', 'am', 'hello', 'hi', 'good', 'morning', 'afternoon', 'evening'];
          
          for (const clause of clauses) {
            const trimmedClause = clause.trim();
            for (const pattern of patterns) {
              const match = trimmedClause.match(pattern);
              if (match && match[1]) {
                const candidate = match[1].trim();
                const words = candidate.split(/\s+/);
                const validWords = words.filter(w => !blacklist.includes(w.toLowerCase()));
                if (validWords.length > 0) {
                  return validWords.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
                }
              }
            }
          }
          return null;
        };

        const parsedName = extractNameFromText(payload.comment);

        extraction = {
          contains_problem: hasProblem,
          contains_quote_request: hasQuote,
          contains_callback_request: hasCallback,
          contains_emergency_keywords: hasEmergency,
          requested_contact_method: hasCallback ? "phone" : "none",
          requested_action: hasEmergency
            ? "emergency_dispatch"
            : hasQuote
              ? "send_quote"
              : "info_request",
          detected_keywords: hasEmergency ? ["Emergency", "Water"] : ["quote", "call"],
          service_requested: hasEmergency ? "Plumbing" : (hasQuote ? "New Roof Quote" : "Support"),
          sentiment: hasEmergency ? "concerned" : (hasProblem
            ? "negative"
            : text.includes("great") || text.includes("incredible")
              ? "positive"
              : "neutral"),
          praise_topics:
            text.includes("great") || text.includes("incredible")
              ? ["service", "quality"]
              : [],
          complaint_topics: hasProblem ? ["communication"] : [],
          summary: payload.comment.slice(0, 100),
          confidence_score: 0.95,
          urgency_level: hasEmergency ? "high" : hasQuote ? "medium" : "low",
          customer_name: parsedName,
          has_name: parsedName !== null
        };
        log(`[Step 8] Heuristic extraction completed successfully`);
      }

      // ---------------------------------------------------------
      // Step 9: Storage & Handoff
      // ---------------------------------------------------------
      const eventInternalId = uuidv4();
      const event_id = `evt_${Math.floor(Math.random() * 90000) + 10000}`;
      log(
        `[Step 9] Writing to log: Saving to database and marking as "Handoff Eligible". Event ID: ${event_id}`,
      );

      // ---------------------------------------------------------
      // PHASE 2: SIGNAL DETECTION (Steps 10–12)
      // ---------------------------------------------------------
      log(
        `[Step 10] Signal Detection: Loading the Signal Rule book specific to "${eventType}" events for ${provider}`,
      );

      const context: Record<string, any> = {
        review_rating: payload.rating,
        business_reply_completed: false,
        elapsed_hours: 0.002, // Just received
        "ai_context.complaint_topics": extraction.complaint_topics || [],
        "ai_context.praise_topics": extraction.praise_topics || [],
        "ai_context.confidence_score": extraction.confidence_score || 0,
        "ai_context.service_mentioned": extraction.service_requested || null,
        "ai_context.urgency_level": extraction.urgency_level || null,
        "ai_context.contains_problem": extraction.contains_problem || false,
        "ai_context.contains_quote_request":
          extraction.contains_quote_request || false,
        "ai_context.contains_callback_request":
          extraction.contains_callback_request || false,
        "ai_context.contains_emergency_keywords":
          extraction.contains_emergency_keywords || false,
        "ai_context.requested_contact_method":
          extraction.requested_contact_method || "none",
        "ai_context.requested_action": extraction.requested_action || null,
        "ai_context.sentiment": extraction.sentiment || null,
        // Mock aggregates
        count_reviews_with_communication_complaints_last_30_days: 0,
        rating_drop_detected: false,
        momentum_increasing: false,
        review_velocity_lagging: false,
        reputation_advantage_detected: false,
      };

      const rulesToEvaluate =
        payload.mode === "review" ? GBP_REVIEW_RULES : TELNYX_SIGNAL_RULES;
      log(
        `[Step 11] Signal Evaluation: Testing event against ${rulesToEvaluate.length} total rules...`,
      );

      const signalsCreated: any[] = [];
      let ruleIdx = 1;

      // Group into families for logging
      const families =
        payload.mode === "review"
          ? [
              { name: "Rating Rules", emoji: "⭐", start: 1, end: 3 },
              { name: "Comment Rules", emoji: "💬", start: 4, end: 6 },
              { name: "Response Status Rules", emoji: "📬", start: 7, end: 9 },
              { name: "Pattern Rules", emoji: "📈", start: 10, end: 12 },
              { name: "Competitive Rules", emoji: "⚔️", start: 13, end: 14 },
              { name: "Marketing Rules", emoji: "📣", start: 15, end: 16 },
              {
                name: "Liability & Safety Rules",
                emoji: "⚖️",
                start: 17,
                end: 17,
              },
            ]
          : [
              {
                name: "Communication Priority Rules",
                emoji: "📞",
                start: 1,
                end: rulesToEvaluate.length,
              },
            ];

      for (const family of families) {
        log(`--- ${family.emoji} Family Group: ${family.name} ---`);
        const familyRules = rulesToEvaluate.slice(family.start - 1, family.end);

        for (const rule of familyRules) {
          let isMatch = true;
          let reasons: string[] = [];

          for (const [field, cond] of Object.entries(rule.conditions)) {
            const { pass, detail } = checkCondition(
              field,
              cond,
              context[field],
            );
            if (!pass) {
              isMatch = false;
              reasons.push(detail);
              break;
            } else {
              reasons.push(detail);
            }
          }

          const statusText = isMatch ? "✅ MATCHED" : "⚪ SKIPPED";
          log(
            `Rule ${ruleIdx} {${rule.signal_rule_id}}: ${rule.signal_name} -> ${statusText}\n      → ${isMatch ? reasons.join(", ") : reasons[0]}`,
          );

          if (isMatch) {
            signalsCreated.push({
              id: `sig_${uuidv4().substring(0, 8)}`,
              event_id: eventInternalId,
              signal_rule_id: rule.signal_rule_id,
              name: rule.signal_name,
              bucket: rule.signal_bucket,
              priority: rule.default_priority,
              confidence: rule.default_confidence,
              status: "candidate",
              created_at: new Date().toISOString(),
            });
          }
          ruleIdx++;
        }
      }

      log(
        `[Step 12] Final Count: Created ${signalsCreated.length} Signal candidates.`,
      );

      // ---------------------------------------------------------
      // PHASE 3: ORCHESTRATOR DECISION (Steps 13–15)
      // ---------------------------------------------------------
      log(
        `[Step 13] Orchestrator Decision: Selecting the best actions for this review...`,
      );
      log(
        `Section 3 - ORCHESTRATOR_STARTED : ${signalsCreated.length} Signal candidate(s) received`,
      );
      log(`Section 3 - EVENT_LOADED : business_id=${business.business_id}`);
      log(`Section 3 - CLIENT_PROFILE_LOADED : automation_level=standard`);
      log(`Section 3 - SAFETY_RULES_LOADED : 2 safety rules loaded.`);
      log(
        `Section 3 - CONSULTANT_OWNERSHIP_LOADED : Consultant: Sarah Jenkins`,
      );
      log(`Section 3 - ORCHESTRATOR_RULES_LOADED : 1 rule(s) loaded...`);
      log(
        `Section 3 - ACTION_MAPPINGS_LOADED : 1 Signal-to-Action mapping groups loaded`,
      );

      if (signalsCreated.length === 0) {
        log(`Section 3 - NO_DECISION : No signals matched. Strategy stopped.`);
        return { success: false, error: "No signals matched review comments.", logs: pipelineSteps };
      }

      const dominant = [...signalsCreated].sort(
        (a, b) => a.priority - b.priority,
      )[0]; // Sort/rank dominant signal by priority
      log(
        `Section 3 - DOMINANT_SIGNAL_IDENTIFIED : Dominant: ${dominant.name} [${dominant.signal_rule_id}]`,
      );

      // Override urgency_level based on the dominant signal's evaluated bucket/priority
      // The signal engine is the authoritative source — not the raw AI extraction
      if (dominant.bucket === "Risk" || dominant.priority === 1) {
        extraction.urgency_level = "high";
        log(
          `Section 3 - URGENCY_OVERRIDE : urgency_level escalated to "high" (dominant signal: ${dominant.name}, bucket: ${dominant.bucket}, priority: ${dominant.priority})`,
        );
      } else if (dominant.bucket === "Opportunity" && dominant.priority <= 2) {
        if (extraction.urgency_level === "low") {
          extraction.urgency_level = "medium";
        }
      }

      // Determine appropriate actions
      let actionId = "ACT-REV-001";
      let actionTitle = "Draft Review Response";
      let executionMode = "approval_required";
      let actionDomain = "REV";

      // P21 — Thread 14 requirement: A2P must NEVER fire for Tier 2A or Tier 2B.
      // Only Tier 1 contacts (verified email, phone, or cs_token) may receive automated outreach.
      const contactTier = customerProfile.tier || "Tier 2B"; // resolved from Q2; default anonymous
      const isA2PEligible = contactTier === "Tier 1";

      // General A2P Tier Safety Guard: if execution is automatic and action is A2P but contact is not Tier 1, force to approval_required
      if (
        executionMode === "automatic" &&
        (actionId.startsWith("ACT-A2P") || actionId === "ACT-A2P-002") &&
        !isA2PEligible
      ) {
        log(
          `Section 3 - A2P_TIER_GUARD_BLOCKED : A2P action suppressed. Contact tier is "${contactTier}". Tier 1 required for automated outreach. Routing to approval_required.`,
        );
        executionMode = "approval_required";
        actionId = "ACT-A2P-005";
        actionTitle = "Draft Callback Script";
        actionDomain = "TASK";
      }

      if (payload.mode === "call" || payload.mode === "sms") {
        if (!isA2PEligible) {
          // Explicit tier guard — block A2P for non-Tier-1 contacts
          log(
            `Section 3 - A2P_TIER_GUARD_BLOCKED : A2P action suppressed. Contact tier is "${contactTier}". Tier 1 required for automated outreach. Routing to approval_required.`,
          );
          actionId = "ACT-A2P-005";
          actionTitle = "Draft Callback Script";
          executionMode = "approval_required";
          actionDomain = "TASK";
        } else if (extraction.contains_emergency_keywords) {
          actionId = "ACT-A2P-002";
          actionTitle = "Urgent Owner Notification";
          executionMode = "automatic";
          actionDomain = "TASK";
        } else {
          actionId = "ACT-A2P-005";
          actionTitle = "Draft Callback Script";
          executionMode = "approval_required";
          actionDomain = "TASK";
        }
      }

      // Check safety rules
      let safetyBlocked = false;
      let safetyBlockReason = "";

      const safetyCheckData = {
        rating: payload.rating,
        action_is_public_facing: actionId === "ACT-REV-001",
        execution_mode: executionMode,
        signal_rule_id: dominant.signal_rule_id,
      };

      for (const rule of SAFETY_COMPLIANCE_RULES) {
        if (evaluateConditions(rule.conditions, safetyCheckData)) {
          safetyBlocked = true;
          safetyBlockReason = rule.block_reason;
          break;
        }
      }

      const decisionId = `dec_${uuidv4().substring(0, 10)}`;

      if (safetyBlocked) {
        log(
          `Section 3 - ACTION_BLOCKED : ${actionId} blocked by safety compliance: ${safetyBlockReason}`,
        );
        executionMode = "blocked";
      }

      log(
        `Section 3 - ACTION_SELECTED : ${actionId} (${actionTitle}) -> mode=${executionMode}, owner=consultant`,
      );
      log(
        `Section 3 - DECISION_STORED : Decision ${decisionId} saved. Actions: 1 ready, ${safetyBlocked ? 1 : 0} blocked.`,
      );

      // ---------------------------------------------------------
      // PHASE 4: ACTION QUEUE & PARAMETERS (Step 16)
      // ---------------------------------------------------------
      log(
        `[Step 16] Action Queue: Parameterizing actions for decision ${decisionId}...`,
      );
      log(`Section 4 - STARTED : Processing Decision...`);
      log(
        `Section 4 - ACTIONS_RECEIVED : Received 1 action(s) from Orchestrator`,
      );

      if (actionId === "ACT-REV-001") {
        log(
          `Section 4 - LANE_ASSIGNMENT : Action ACT-REV-001 is public-facing. Forced to APPROVAL_REQUIRED.`,
        );
      }

      const resolvedParams: Record<string, any> = {
        customer_name: customerProfile.display_name,
        rating: payload.rating,
        brand_tone: "professional",
        review_text: payload.comment,
        ai_summary: extraction.summary,
      };

      for (const [k, v] of Object.entries(resolvedParams)) {
        log(`Section 4 - PARAM_RESOLVED : Resolved {${k}} -> ${v}`);
      }

      const queueItemStatus =
        executionMode === "approval_required"
          ? "pending_approval"
          : "ready_for_execution";
      log(
        `Section 4 - ITEM_QUEUED : 🎯 Queued: ${actionId} in lane [${executionMode.toUpperCase()}] with status ${queueItemStatus}`,
      );

      // ---------------------------------------------------------
      // PHASE 5: EXECUTION (Step 17)
      // ---------------------------------------------------------
      log(
        `[Step 17] Execution: Starting Section 5 for decision ${decisionId}...`,
      );
      let draftReplyText = "";

      if (executionMode !== "blocked") {
        if (actionId === "ACT-REV-001" && apiKey) {
          // Review reply draft via OpenAI
          try {
            const openai = new OpenAI({ apiKey });
            const response = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "system",
                  content:
                    "You are a helpful assistant that writes concise, professional business review replies.",
                },
                {
                  role: "user",
                  content: `Write a reply to a customer review. Do not mention any company name.\nCustomer Name: ${customerProfile.display_name}\nRating: ${payload.rating}\nTone: professional.\nMax length: 150 words.\nReview comment: ${payload.comment}`,
                },
              ],
              temperature: 0.3,
            });
            draftReplyText = (response.choices[0].message.content || "").trim();
          } catch (e) {
            console.error("AI review draft failed", e);
          }

          if (!draftReplyText) {
            const tone =
              payload.rating >= 4
                ? "Thank you so much for the kind words"
                : payload.rating === 3
                  ? "Thank you for your feedback"
                  : "We sincerely apologize for your experience";
            draftReplyText = `Dear ${customerProfile.display_name},\n\n${tone}. Your feedback means a great deal to us${payload.rating <= 2 ? " and we take your concerns seriously. Please reach out to us directly so we can make things right." : " and motivates our team to keep delivering great work."}\n\nBest regards,\nCustomer Support Team`;
          }
        } else if (
          (actionId === "ACT-A2P-005" || actionId === "ACT-A2P-002") &&
          apiKey
        ) {
          // Callback script or SMS dispatch draft
          try {
            const openai = new OpenAI({ apiKey });
            const isEmergency = actionId === "ACT-A2P-002";
            const prompt = isEmergency
              ? `Write a very short, urgent SMS reply to the customer named "${customerProfile.display_name || "Marie"}". They left a critical voicemail about: "${payload.comment}". Let them know we received their urgent message and are calling or heading over immediately to help. Do not mention any company name. Max 160 characters.`
              : `Write a professional callback script for a company employee calling back a customer. Use "[Your Name]" as a placeholder. Customer message: "${payload.comment}". Include: greeting, reason for calling, offer to help with their ${extraction.service_requested || "request"}. Do not mention any company name in the script. Max 100 words.`;
            const response = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "system",
                  content:
                    "You are a helpful assistant for a home services business.",
                },
                { role: "user", content: prompt },
              ],
              temperature: 0.4,
            });
            draftReplyText = (response.choices[0].message.content || "").trim();
          } catch (e) {
            console.error("AI callback draft failed", e);
          }

          if (!draftReplyText) {
            const isEmergency = actionId === "ACT-A2P-002";
            draftReplyText = isEmergency
              ? `Hi ${customerProfile.display_name || "Marie"}, we received your urgent message about the burst pipe/leak and are calling you right back to help! - [Your Name]`
              : `Hi ${customerProfile.display_name}, this is [Your Name] calling you back. I'm reaching out about your recent inquiry regarding ${extraction.service_requested || "our services"}. I'd love to help you. When is a good time to chat?`;
          }
        }

        // Final fallback for any unhandled action types
        if (!draftReplyText) {
          draftReplyText = `Hi ${customerProfile.display_name}, thanks for reaching out. We've received your message and will be in touch shortly.`;
        }
      }

      const draftType =
        actionId === "ACT-REV-001"
          ? "Review Reply"
          : actionId === "ACT-A2P-002"
            ? "Urgent SMS Alert"
            : "Callback Script";
      log(
        `Section 5 - DRAFT_CREATED : ${actionId} ${draftType} draft created successfully. Pending approval.`,
      );

      // ---------------------------------------------------------
      // PHASE 6: OUTCOME RECORDING (Step 18)
      // ---------------------------------------------------------
      log(
        `[Step 18] Outcome: Starting Section 6 for decision ${decisionId}...`,
      );
      log(`Section 6 - PASS : Outcome stage initialized.`);
      log(`Section 6 - PASS : Timing metrics verified.`);
      log(`Section 6 - PASS : Execution and queue references updated.`);

      // ---------------------------------------------------------
      // PHASE 7: FEEDBACK LEARNING (Step 19)
      // ---------------------------------------------------------
      log(
        `[Step 19] Feedback: Starting Section 7 for decision ${decisionId}...`,
      );
      log(`Section 7 - PASS : Feedback intake opened.`);
      log(`Section 7 - PASS : Signal validity evaluated -> likely_valid`);
      log(`Section 7 - PASS : Decision quality evaluated -> reasonable_so_far`);
      log(`Section 7 - PASS : Closed-loop feedback recorded.`);

      log(`--- [UNIFIED PIPELINE END] Trace: ${traceId} ---`);

      // ─── Construct structured output packages ──────────────────────────────
      const returnedSignals = signalsCreated;
      const returnedEnrichments = [
        {
          id: `enr_${event_id}`,
          ai_urgency_level: extraction.urgency_level,
          ai_complaint_detected: extraction.contains_problem,
          ai_contains_problem: extraction.contains_problem,
          ai_contains_quote_request: extraction.contains_quote_request,
          ai_contains_callback_request: extraction.contains_callback_request,
          ai_contains_emergency_keywords:
            extraction.contains_emergency_keywords,
          ai_requested_contact_method: extraction.requested_contact_method,
          ai_requested_action: extraction.requested_action,
          ai_detected_keywords: extraction.detected_keywords,
          ai_summary: extraction.summary,
          ai_sentiment: extraction.sentiment,
          ai_praise_topics: extraction.praise_topics,
          ai_complaint_topics: extraction.complaint_topics,
          ai_service_mentioned: extraction.service_requested,
          ai_confidence_score: extraction.confidence_score,
          confidence_score: extraction.confidence_score,
        },
      ];

      const executions = [
        {
          id: `exec_${event_id}`,
          execution_status:
            executionMode === "automatic" ? "success" : "pending",
          generated_output: JSON.stringify({
            draft_reply: draftReplyText,
            draft_type: draftType,
            sms_text:
              actionId === "ACT-A2P-002"
                ? draftReplyText
                : `Alert: ${dominant.name} signal detected. Customer requires follow-up.`,
            message: `Pipeline execution complete. Action: ${actionTitle}. Mode: ${executionMode}.`,
          }),
        },
      ];

      const returnedDecision = {
        decision_id: decisionId,
        dominant_signal_id: dominant.id,
        dominant_signal: {
          id: dominant.id,
          name: dominant.name,
          bucket: dominant.bucket,
          priority: dominant.priority,
          signal_rule_id: dominant.signal_rule_id,
        },
        execution_mode: executionMode,
        priority: dominant.priority,
        action_queue: [
          {
            id: `act_${event_id}`,
            action_id: actionId,
            action_library_id: actionId,
            title: actionTitle,
            status: executionMode === "automatic" ? "completed" : "queued",
            executions: executions,
          },
        ],
      };

      const outcome = {
        id: `out_${event_id}`,
        decision_id: decisionId,
        dominant_signal: returnedDecision.dominant_signal,
        handoff_status: executionMode === "blocked" ? "blocked" : "handed_off",
        outcome_status:
          executionMode === "automatic" ? "completed" : "pending_approval",
        out_pkg: {
          section_6_status: "success",
          section_6_completion_result: {
            status: "success",
            time: new Date().toISOString(),
          },
          handoff_status:
            executionMode === "blocked" ? "blocked" : "handed_off",
          outcome_records: [
            {
              id: `outr_${event_id}`,
              status: executionMode === "automatic" ? "completed" : "pending",
            },
          ],
          blocked_no_external_action_context: safetyBlocked
            ? [{ reason: safetyBlockReason }]
            : [],
        },
        details: {
          status: executionMode === "automatic" ? "completed" : "pending",
        },
      };

      const feedback = {
        id: `fb_${event_id}`,
        handoff_status: "complete",
        fb_pkg: {
          quality_score: 5,
          tuning_action: "none",
          production_changes_applied: false,
          summary_states: {
            signal_validity: "likely_valid",
            decision_quality: "reasonable_so_far",
            action_execution_quality:
              executionMode === "automatic" ? "executed" : "pending_approval",
            outcome_result: executionMode === "blocked" ? "blocked" : "success",
            human_review_state:
              executionMode === "approval_required"
                ? "awaiting_approval"
                : "not_required",
          },
        },
      };

      return {
        success: true,
        event_id,
        logs: pipelineSteps,
        decision: returnedDecision,
        enrichments: returnedEnrichments,
        signals: returnedSignals,
        execution: {
          execution_output_package: {
            execution_records: executions,
          },
        },
        outcome,
        feedback,
        ai_protocol: {
          message: payload.comment,
          fields_to_extract: {
            contains_problem: "boolean (True if issue/complaint mentioned)",
            contains_quote_request:
              "boolean (True if asking for price/estimate)",
            contains_callback_request:
              "boolean (True if explicitly asking for a phone call back)",
            contains_emergency_keywords:
              "boolean (True if words like leak, flood, dangerous present)",
            requested_contact_method: "string (phone, email, text, or none)",
            service_requested: "string (specific service mentioned)",
            sentiment: "string (positive, neutral, negative)",
            praise_topics: "array (concise praise phrases)",
            complaint_topics: "array (concise complaint phrases)",
            summary: "string (one-sentence summary)",
            confidence_score: "number (0 to 1)",
            customer_name: "string (the name of the customer if explicitly mentioned, otherwise null)",
            has_name: "boolean (true if customer name is explicitly mentioned, otherwise false)"
          },
          raw_response: extraction,
        },
      };
    } catch (e: any) {
      log(`[Unified Pipeline Error] ${e.message}`);
      return {
        success: false,
        error: e.message,
        logs: pipelineSteps,
      };
    }
  }
}
