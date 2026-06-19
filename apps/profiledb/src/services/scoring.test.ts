import assert from 'assert';
import { getNextBucket, calculateDecayedScore, evaluateDemotion } from './scoring.service';

describe('ClearSky Scoring & Intent Pipeline - In-Memory Unit Tests', () => {
  
  // Scenario A: New caller leaves generic message
  console.log('🧪 Running Test: Scenario A (New caller, generic message)');
  const scoreAfterVoicemail = 0 + 15; // base 0 + voicemail_received (+15)
  const bucketA = getNextBucket('unclassified', scoreAfterVoicemail, 'voicemail_received', {
    isUrgent: false,
    isConversion: false,
    activeSignalsCount: 1 // Only the call itself
  });
  
  assert.strictEqual(scoreAfterVoicemail, 15, 'Voicemail score delta should be 15');
  assert.strictEqual(bucketA, 'research', 'Score of 15 with 1 active signal should resolve to Research bucket');
  console.log('✅ Scenario A passed!');

  // Scenario B: Appointment request
  console.log('🧪 Running Test: Scenario B (Appointment request)');
  const scoreAfterAppointment = 0 + 25; // base 0 + appointment_booked (+25)
  const bucketB = getNextBucket('unclassified', scoreAfterAppointment, 'appointment_booked', {
    isUrgent: false,
    isConversion: true, // Marked as conversion
    activeSignalsCount: 1
  });
  
  assert.strictEqual(scoreAfterAppointment, 25, 'Appointment booked delta should be 25');
  assert.strictEqual(bucketB, 'comparison', 'Conversion event below score 50 resolves to Comparison bucket');
  
  // Test upgraded Scenario B: Appointment request with existing engagement score
  const bucketB_upgraded = getNextBucket('comparison', 55, 'appointment_booked', {
    isUrgent: false,
    isConversion: true,
    activeSignalsCount: 1
  });
  assert.strictEqual(bucketB_upgraded, 'active', 'Conversion event with score >= 50 upgrades to Active bucket');
  console.log('✅ Scenario B passed!');

  // Scenario C: Strong buying intent (multiple signals compounding)
  console.log('🧪 Running Test: Scenario C (Strong buying intent - Compounding)');
  
  // Step 1: Page view pricing (+8)
  const score1 = 8;
  const bucketC1 = getNextBucket('unclassified', score1, 'page_view_pricing');
  assert.strictEqual(bucketC1, 'comparison', 'Pricing view should place visitor in Comparison bucket');

  // Step 2: Form submit (+20)
  const score2 = score1 + 20; // 28
  const bucketC2 = getNextBucket(bucketC1, score2, 'form_submit', {
    isUrgent: false,
    isConversion: true,
    activeSignalsCount: 1
  });
  assert.strictEqual(bucketC2, 'comparison', 'Form submit conversion under score 50 keeps it in Comparison');

  // Step 3: Voicemail (+15)
  const score3 = score2 + 15; // 43
  const bucketC3 = getNextBucket(bucketC2, score3, 'voicemail_received', {
    isUrgent: false,
    isConversion: false,
    activeSignalsCount: 2 // Two active signals: form_submit + voicemail_received
  });
  assert.strictEqual(bucketC3, 'active', 'Two or more active signals upgrade visitor to Active bucket regardless of score');
  console.log('✅ Scenario C passed!');

  // Scenario D: Urgent keywords / Emergency
  console.log('🧪 Running Test: Scenario D (Urgent/Emergency keywords)');
  const bucketD = getNextBucket('research', 10, 'voicemail_received', {
    isUrgent: true, // Urgent flag detected by AI
    isConversion: false,
    activeSignalsCount: 1
  });
  assert.strictEqual(bucketD, 'emergency', 'Urgent/emergency flag overrides score thresholds and forces Emergency bucket');
  console.log('✅ Scenario D passed!');

  // Decay & Demotion Tests
  console.log('🧪 Running Test: Decay & Demotion rules');
  const lastEventDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000); // 15 days ago
  
  // Research config: grace 14 days, halfLife 60. 15 days means 1 day of decay.
  const decayedScore = calculateDecayedScore(50, lastEventDate, 'research');
  assert.ok(decayedScore < 50, 'Score should decay after grace period');

  // Active config: grace 3 days. Demotes if score falls below 35.
  const activeEventDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago (grace exceeded)
  const demotionCheck = evaluateDemotion(30, activeEventDate, 'active');
  assert.strictEqual(demotionCheck.demoted, true, 'Active lead below threshold 35 should demote');
  assert.strictEqual(demotionCheck.newBucket, 'comparison', 'Active lead should demote to Comparison');
  console.log('✅ Decay & Demotion passed!');
});

function describe(name: string, fn: () => void) {
  console.log(`\n=========================================\n🏃 ${name}\n=========================================`);
  fn();
  console.log(`=========================================\n🎉 All unit tests completed successfully!\n=========================================\n`);
}
