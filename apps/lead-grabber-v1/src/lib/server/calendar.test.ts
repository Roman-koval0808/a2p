import { describe, it, expect } from 'vitest';
import { formatDatetime, ensureFutureWallClock, checkCalendarAvailability } from './calendar';

// Regression: the host runs in Europe/Berlin while the business is America/Toronto. Naive stamps
// from the AI extractors used to be read in the SERVER's zone and rendered in the business's,
// shifting every time by 6h — a customer was offered a "Monday at 3:00 AM" furnace slot.
// These assertions only mean something when the server zone differs from BUSINESS_TZ.
describe('wall-clock handling', () => {
  it('renders the naive stamp unchanged (the 3:00 AM bug)', () => {
    expect(formatDatetime('2026-08-10T12:00:00')).toBe('Monday, August 10 at 12:00 PM');
    expect(formatDatetime('2026-08-03T09:00:00')).toBe('Monday, August 3 at 9:00 AM');
  });
  it('rolls a past weekday forward a week', () => {
    const now = new Date('2026-08-03T17:35:00Z');
    expect(ensureFutureWallClock('2026-08-03T09:00:00', now)).toBe('2026-08-10T09:00:00');
  });
  it('leaves a future time alone', () => {
    const now = new Date('2026-08-03T17:35:00Z');
    expect(ensureFutureWallClock('2026-08-10T12:00:00', now)).toBe('2026-08-10T12:00:00');
  });
  it('reads business hours off the wall clock, not the server zone', () => {
    expect(checkCalendarAvailability('2026-08-10T12:00:00', [])).toBe(true);
    expect(checkCalendarAvailability('2026-08-10T03:00:00', [])).toBe(false);
  });
});
