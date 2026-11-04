/**
 * One Euro filter — the smoothing the Spider-Man repo uses for landmark
 * jitter, applied here to torso position and arm angles.
 *
 * One Euro is adaptive: it smooths hard when the signal is still (killing
 * landmark jitter) and lets fast movement through (so a quick dodge still
 * feels instant). That is exactly what a 5-year-old's wobbly, sudden
 * movements need: steady ship, responsive dodge.
 *
 * Reference: Casiez et al., "1€ Filter: A Simple Speed-based Low-pass
 * Filter for Noisy Input in Interactive Systems" (CHI 2012).
 */

export interface OneEuroOptions {
  /** Minimum cutoff frequency (Hz). Lower = smoother at rest. */
  minCutoff: number;
  /** Speed coefficient: how much the cutoff rises with signal speed. */
  beta: number;
  /** Cutoff frequency (Hz) of the derivative low-pass filter. */
  dCutoff: number;
}

/** A scalar One Euro filter. Feed it timestamps in seconds. */
export class OneEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  public constructor(options: OneEuroOptions) {
    this.minCutoff = options.minCutoff;
    this.beta = options.beta;
    this.dCutoff = options.dCutoff;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** Filter one sample. `tSeconds` must be monotonically non-decreasing. */
  public filter(value: number, tSeconds: number): number {
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = value;
      this.tPrev = tSeconds;
      return value;
    }
    const dt = Math.max(tSeconds - this.tPrev, 1e-6);
    const dx = (value - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const xHat = a * value + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = tSeconds;
    return xHat;
  }

  public reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

/** A 2D One Euro filter: one scalar filter per axis, sharing a clock. */
export class OneEuroFilter2D {
  private readonly fx: OneEuroFilter;
  private readonly fy: OneEuroFilter;

  public constructor(options: OneEuroOptions) {
    this.fx = new OneEuroFilter(options);
    this.fy = new OneEuroFilter(options);
  }

  public filter(x: number, y: number, tSeconds: number): { x: number; y: number } {
    return { x: this.fx.filter(x, tSeconds), y: this.fy.filter(y, tSeconds) };
  }

  public reset(): void {
    this.fx.reset();
    this.fy.reset();
  }
}
