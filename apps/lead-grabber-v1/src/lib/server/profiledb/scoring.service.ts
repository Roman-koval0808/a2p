export interface DecayConfig {
  grace: number;
  halfLife: number;
}

export const DECAY_CONFIGS: Record<string, DecayConfig> = {
  emergency: { grace: 1, halfLife: 2 },
  active: { grace: 3, halfLife: 14 },
  comparison: { grace: 7, halfLife: 30 },
  research: { grace: 14, halfLife: 60 },
  unclassified: { grace: 0, halfLife: 365 },
};

const BUCKET_ORDER = ['unclassified', 'research', 'comparison', 'active', 'emergency'];

/**
 * Canonical bucket score bands (Four Intent Buckets report §3.5).
 * Research 9–34 · Comparison 35–49 · Active Project 50–74 · Emergency = signal override, any score.
 */
export const RESEARCH_MIN_SCORE = 9;
export const COMPARISON_MIN_SCORE = 35;
export const ACTIVE_MIN_SCORE = 50;

/**
 * Locked, page-independent score deltas (Comprehensive Platform Report scoring table, mirrored in
 * the reference prototype's scoring/config.ts). Used to sanity-bound client-supplied deltas.
 */
export const LOCKED_DELTAS: Record<string, number> = {
	call_click: 15,
	booking: 20,
	email_capture: 0
};

/** IVR selection deltas (reference prototype IVR_DELTAS). Digit 3 = emergency override. */
export const IVR_DELTAS: Record<string, { delta: number; bucket: string }> = {
	'1': { delta: 6, bucket: 'active' }, // Service / repairs
	'2': { delta: 10, bucket: 'active' }, // Estimates / quotes
	'3': { delta: 20, bucket: 'emergency' }, // Emergency
	'4': { delta: 2, bucket: 'unclassified' }, // Billing / admin
	'0': { delta: 0, bucket: 'unclassified' } // Operator / no input
};

/** Flat bonus for a recognised return within this many days (reference RECENCY_BONUS). */
export const RECENCY_BONUS = { points: 10, withinDays: 3 };

/** Score at/above which on-page Site Personalization unlocks (reference SITE_PERSONALIZATION_THRESHOLD). */
export const SITE_PERSONALIZATION_THRESHOLD = 35;

/**
 * Deltas arrive from the client pixel payload, which is untrusted and unbounded — a single
 * voicemail was observed sending +95, saturating the 0–100 scale in one event and making every
 * subsequent band meaningless. Clamp to the largest legitimate single-event delta.
 */
export const MAX_SINGLE_EVENT_DELTA = 25;

/** Bound an incoming score delta to a sane single-event range. */
export function clampScoreDelta(delta: number): number {
	if (!Number.isFinite(delta)) return 0;
	return Math.max(-MAX_SINGLE_EVENT_DELTA, Math.min(MAX_SINGLE_EVENT_DELTA, Math.round(delta)));
}

/**
 * Calculates the live decayed score based on raw score, time elapsed, and bucket configurations.
 */
export function calculateDecayedScore(
  scoreRaw: number,
  lastEventAt: Date,
  intentBucket: string,
  now: Date = new Date()
): number {
  const config = DECAY_CONFIGS[intentBucket] || DECAY_CONFIGS.unclassified;
  const diffMs = now.getTime() - lastEventAt.getTime();
  const daysSinceLastEvent = Math.max(0, diffMs / (1000 * 60 * 60 * 24));

  if (daysSinceLastEvent <= config.grace) {
    return scoreRaw;
  }

  const decayed = scoreRaw * Math.pow(0.5, (daysSinceLastEvent - config.grace) / config.halfLife);
  return Math.max(0, Math.round(decayed));
}

/**
 * Evaluates target intent bucket based on live score and event type, enforcing the no-downgrade rule.
 */
export function getNextBucket(
  currentBucket: string,
  scoreLive: number,
  eventType: string,
  options?: {
    isUrgent?: boolean;
    isConversion?: boolean;
    activeSignalsCount?: number;
  }
): string {
  let targetBucket = 'unclassified';
  const eventLower = eventType.toLowerCase();

  // Emergency rule: Any single urgency signal, score irrelevant. Check first!
  if (options?.isUrgent || eventLower.includes('emergency') || eventLower.includes('urgent')) {
    targetBucket = 'emergency';
  } else {
    // Canonical bands — Four Intent Buckets report §3.5:
    //   Research 9–34 · Comparison 35–49 · Active Project 50–74 · Emergency = signal override.
    //
    // Previously Comparison started at 25 and Active required a conversion event (or an
    // undocumented "2+ active signals" rule) rather than a score band, so score alone could never
    // reach Active: a profile on 100/100 was evaluated research → COMPARISON, two bands too low.
    //
    // The spec defines no band above 74 while the scale caps at 100, so Active is treated as 50+
    // (open-topped) rather than leaving 75–100 unbucketed.
    const isConversionEvent =
      options?.isConversion || eventLower.includes('booking') || eventLower.includes('submit');

    if (scoreLive >= ACTIVE_MIN_SCORE) {
      targetBucket = 'active';
    } else if (isConversionEvent && scoreLive >= COMPARISON_MIN_SCORE) {
      // A conversion action from an already-engaged visitor is an Active-Project behaviour even
      // if the accumulated score has not yet crossed 50.
      targetBucket = 'active';
    } else if (
      scoreLive >= COMPARISON_MIN_SCORE ||
      eventLower.includes('pricing') ||
      eventLower.includes('review')
    ) {
      targetBucket = 'comparison';
    } else if (
      scoreLive >= RESEARCH_MIN_SCORE ||
      eventLower.includes('view') ||
      eventLower.includes('click') ||
      eventLower.includes('scroll')
    ) {
      targetBucket = 'research';
    }
  }

  const currentIndex = BUCKET_ORDER.indexOf(currentBucket);
  const targetIndex = BUCKET_ORDER.indexOf(targetBucket);

  // If the target bucket is higher in hierarchy, upgrade. Otherwise, keep current bucket.
  return targetIndex > currentIndex ? targetBucket : currentBucket;
}

export const DEMOTION_RULES: Record<string, { threshold: number; demotesTo: string }> = {
  active:     { threshold: 35, demotesTo: 'comparison' },
  comparison: { threshold: 20, demotesTo: 'research'   },
  research:   { threshold: 8,  demotesTo: 'unclassified' },
};

export interface DemotionResult {
  demoted: boolean;
  newBucket: string;
  scoreLive: number;
  decayPct: number;
  inGrace: boolean;
}

/**
 * Calculates decay status and evaluates if the profile bucket demotes cross-session.
 */
export function evaluateDemotion(
  scoreRaw: number,
  lastEventAt: Date,
  intentBucket: string,
  now: Date = new Date()
): DemotionResult {
  const scoreLive = calculateDecayedScore(scoreRaw, lastEventAt, intentBucket, now);
  const config = DECAY_CONFIGS[intentBucket] || DECAY_CONFIGS.unclassified;
  const diffMs = now.getTime() - lastEventAt.getTime();
  const daysSinceLastEvent = Math.max(0, diffMs / (1000 * 60 * 60 * 24));
  const inGrace = daysSinceLastEvent <= config.grace;
  const decayPct = scoreRaw > 0 ? Math.round((1 - scoreLive / scoreRaw) * 100) : 0;

  if (intentBucket === 'emergency') {
    return { demoted: false, newBucket: 'emergency', scoreLive, decayPct, inGrace };
  }

  if (inGrace) {
    return { demoted: false, newBucket: intentBucket, scoreLive, decayPct, inGrace };
  }

  let currentBucket = intentBucket;
  let demoted = false;

  while (true) {
    const rule = DEMOTION_RULES[currentBucket];
    if (!rule || scoreLive >= rule.threshold) {
      break;
    }
    currentBucket = rule.demotesTo;
    demoted = true;
  }

  return { demoted, newBucket: currentBucket, scoreLive, decayPct, inGrace };
}
