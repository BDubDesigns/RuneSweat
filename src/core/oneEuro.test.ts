import { describe, expect, it } from 'vitest';
import { OneEuroFilter } from './oneEuro';

describe('OneEuroFilter', () => {
  it('passes the first sample through unchanged', () => {
    const f = new OneEuroFilter({ minCutoff: 1, beta: 0.02, dCutoff: 1 });
    expect(f.filter(5, 0)).toBe(5);
  });

  it('smooths small jitter around a still value', () => {
    const f = new OneEuroFilter({ minCutoff: 1, beta: 0.02, dCutoff: 1 });
    f.filter(0.5, 0);
    // A stream of tiny jitter should stay close to 0.5, not follow each blip.
    let out = 0.5;
    for (let i = 1; i <= 30; i += 1) {
      out = f.filter(0.5 + (i % 2 === 0 ? 0.02 : -0.02), i / 60);
    }
    expect(Math.abs(out - 0.5)).toBeLessThan(0.01);
  });

  it('tracks a genuine fast move with little lag', () => {
    const f = new OneEuroFilter({ minCutoff: 1, beta: 0.5, dCutoff: 1 });
    f.filter(0, 0);
    let out = 0;
    for (let i = 1; i <= 30; i += 1) {
      out = f.filter(1, i / 60);
    }
    expect(out).toBeGreaterThan(0.9);
  });

  it('reset restores first-sample passthrough', () => {
    const f = new OneEuroFilter({ minCutoff: 1, beta: 0.02, dCutoff: 1 });
    f.filter(0.5, 0);
    f.filter(0.6, 1 / 60);
    f.reset();
    expect(f.filter(9, 1)).toBe(9);
  });
});
