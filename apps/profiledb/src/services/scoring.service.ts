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
    const hasTwoActiveSignals = (options?.activeSignalsCount ?? 0) >= 2;
    const isConversionEvent = options?.isConversion || eventLower.includes('booking') || eventLower.includes('submit');
    const hasConversionAndScore = scoreLive >= 50 && isConversionEvent;

    if (hasConversionAndScore || hasTwoActiveSignals) {
      targetBucket = 'active';
    } else if (scoreLive >= 35 || eventLower.includes('pricing')) {
      targetBucket = 'comparison';
    } else if (scoreLive >= 9 || eventLower.includes('view') || eventLower.includes('click')) {
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

  const rule = DEMOTION_RULES[intentBucket];
  if (!rule || scoreLive >= rule.threshold) {
    return { demoted: false, newBucket: intentBucket, scoreLive, decayPct, inGrace };
  }

  return { demoted: true, newBucket: rule.demotesTo, scoreLive, decayPct, inGrace };
}
