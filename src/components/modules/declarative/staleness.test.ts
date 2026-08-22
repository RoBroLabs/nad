import { describe, expect, it } from 'vitest';
import { stalenessAge } from '@/components/modules/declarative/primitives';

const now = 1_700_000_000_000;
const minute = 60_000;

describe('stalenessAge', () => {
  it('reports nothing while data is inside the expected refresh window', () => {
    expect(stalenessAge(now - minute, 60_000, now)).toBeNull();
  });

  it('reports nothing for a plugin that declares no refresh interval', () => {
    expect(stalenessAge(now - 60 * minute, undefined, now)).toBeNull();
  });

  it('reports nothing before data has ever arrived', () => {
    expect(stalenessAge(0, 60_000, now)).toBeNull();
  });

  it('holds a 60s floor so a fast-polling widget does not flicker on one slow round trip', () => {
    // 2.5x a 10s interval is 25s, but the floor keeps it quiet until a minute.
    expect(stalenessAge(now - 30_000, 10_000, now)).toBeNull();
    expect(stalenessAge(now - 61_000, 10_000, now)).toBe('1m ago');
  });

  it('reports once two polls have been missed', () => {
    expect(stalenessAge(now - 5 * minute, 60_000, now)).toBe('5m ago');
  });

  it('scales the unit with age', () => {
    expect(stalenessAge(now - 90 * minute, 60_000, now)).toBe('1h ago');
    expect(stalenessAge(now - 50 * 60 * minute, 60_000, now)).toBe('2d ago');
  });
});
