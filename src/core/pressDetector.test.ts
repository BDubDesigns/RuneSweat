import { describe, expect, it } from 'vitest';
import { PressDetector, pressButtonZones, type PressWrist } from './pressDetector';

/**
 * Synthetic stance for the detector: hip-mid (0.5, 0.55), torso
 * 0.3. The zones land at left centre x 0.26 / right centre x 0.74,
 * top y 0.505, bottom y 0.625 — so a wrist at the zone centres
 * (0.26, 0.56) / (0.74, 0.56) is dead centre in each button.
 */
const HIP_MID_X = 0.5;
const HIP_MID_Y = 0.55;
const TORSO = 0.3;

function wrists(y: number, leftX = 0.26, rightX = 0.74): [PressWrist, PressWrist] {
  return [
    { x: leftX, y },
    { x: rightX, y },
  ];
}

function step(
  detector: PressDetector,
  y: number,
  nowMs: number,
  leftX?: number,
  rightX?: number,
): ReturnType<PressDetector['update']> {
  const [left, right] = wrists(y, leftX, rightX);
  return detector.update(left, right, HIP_MID_X, HIP_MID_Y, TORSO, nowMs);
}

/**
 * A full press: both wrists in the zones, moving downward, held
 * 300 ms. Frames at 100 ms: y 0.52 -> 0.55 -> 0.58 -> 0.60, all
 * inside the zones (top 0.505, bottom 0.625).
 */
function fullPress(detector: PressDetector, t0: number): void {
  expect(step(detector, 0.52, t0)).toBeNull();
  expect(step(detector, 0.55, t0 + 100)).toBeNull();
  expect(step(detector, 0.58, t0 + 200)).toBeNull();
  expect(step(detector, 0.6, t0 + 300)?.kind).toBe('press');
}

describe('pressButtonZones', () => {
  it('places the zones at ±0.8 torso from hip-mid, at hip-line height', () => {
    const zones = pressButtonZones(HIP_MID_X, HIP_MID_Y, TORSO);
    // Centres: 0.5 ± 0.8 * 0.3 = 0.26 / 0.74.
    expect(zones.left.x + zones.left.w / 2).toBeCloseTo(0.26);
    expect(zones.right.x + zones.right.w / 2).toBeCloseTo(0.74);
    // Top: hip line − 0.15 torso = 0.55 − 0.045 = 0.505.
    expect(zones.left.y).toBeCloseTo(0.505);
    expect(zones.right.y).toBeCloseTo(0.505);
    // Size: 0.5 wide × 0.4 tall, in torso lengths.
    expect(zones.left.w).toBeCloseTo(0.15);
    expect(zones.left.h).toBeCloseTo(0.12);
    expect(zones.right.w).toBeCloseTo(0.15);
    expect(zones.right.h).toBeCloseTo(0.12);
  });

  it('both zones are reachable from a centred stance', () => {
    const zones = pressButtonZones(HIP_MID_X, HIP_MID_Y, TORSO);
    for (const zone of [zones.left, zones.right]) {
      const centreX = zone.x + zone.w / 2;
      const distanceTorso = Math.abs(centreX - HIP_MID_X) / TORSO;
      expect(distanceTorso).toBeLessThanOrEqual(1.0);
    }
  });
});

describe('PressDetector', () => {
  it('counts both wrists in zones + downward + 300 ms hold', () => {
    const detector = new PressDetector();
    fullPress(detector, 1000);
  });

  it('does NOT count with one wrist only', () => {
    const detector = new PressDetector();
    // Right wrist parked outside its zone (x 0.5, dead centre).
    expect(step(detector, 0.52, 1000, 0.26, 0.5)).toBeNull();
    expect(step(detector, 0.55, 1100, 0.26, 0.5)).toBeNull();
    expect(step(detector, 0.58, 1200, 0.26, 0.5)).toBeNull();
    expect(step(detector, 0.6, 1300, 0.26, 0.5)).toBeNull();
    expect(step(detector, 0.6, 1500, 0.26, 0.5)).toBeNull();
  });

  it('does NOT count with no downward motion, however long the hold', () => {
    const detector = new PressDetector();
    // Wrists parked dead centre in the zones, never moving down.
    expect(step(detector, 0.56, 1000)).toBeNull();
    expect(step(detector, 0.56, 1200)).toBeNull();
    expect(step(detector, 0.56, 1400)).toBeNull();
    expect(step(detector, 0.56, 2000)).toBeNull();
  });

  it('does NOT count before the 300 ms hold completes', () => {
    const detector = new PressDetector();
    expect(step(detector, 0.52, 1000)).toBeNull();
    expect(step(detector, 0.55, 1100)).toBeNull();
    expect(step(detector, 0.58, 1200)).toBeNull();
    // 200 ms in: still holding, not fired.
    expect(step(detector, 0.6, 1200)).toBeNull();
    // 300 ms in: fires.
    expect(step(detector, 0.6, 1300)?.kind).toBe('press');
  });

  it('does NOT count wrists above the buttons', () => {
    const detector = new PressDetector();
    // y 0.45 is above the zone tops (0.505) — hands raised, not pressing.
    expect(step(detector, 0.45, 1000)).toBeNull();
    expect(step(detector, 0.46, 1100)).toBeNull();
    expect(step(detector, 0.48, 1200)).toBeNull();
    expect(step(detector, 0.5, 1300)).toBeNull();
    expect(step(detector, 0.5, 2000)).toBeNull();
  });

  it('fires once per hold: a second press needs a re-arm (wrists leave, then return)', () => {
    const detector = new PressDetector();
    fullPress(detector, 1000);
    // Still holding in the zones: no second event.
    expect(step(detector, 0.6, 1400)).toBeNull();
    expect(step(detector, 0.6, 1800)).toBeNull();
    // Wrists leave the zones (hands to centre): re-arm.
    expect(step(detector, 0.56, 2000, 0.5, 0.5)).toBeNull();
    // Return and hold again: second press fires.
    fullPress(detector, 2100);
  });

  it('does NOT count a hold interrupted at 200 ms, and the hold restarts', () => {
    const detector = new PressDetector();
    expect(step(detector, 0.52, 1000)).toBeNull();
    expect(step(detector, 0.55, 1100)).toBeNull();
    // Left wrist leaves its zone at 200 ms in.
    expect(step(detector, 0.58, 1200, 0.5, 0.74)).toBeNull();
    // Back in the zones at 1300: the hold restarts here, so 1300 + 300
    // is the earliest fire — not 1000 + 300.
    expect(step(detector, 0.58, 1300)).toBeNull();
    expect(step(detector, 0.59, 1400)).toBeNull();
    expect(step(detector, 0.6, 1500)).toBeNull();
    expect(step(detector, 0.6, 1600)?.kind).toBe('press');
  });

  it('does not double-count inside the 500 ms minimum interval', () => {
    const detector = new PressDetector();
    fullPress(detector, 1000);
    // Leave (re-arm) and return fast: the new hold starts at 1450 and
    // completes at 1750, inside the 500 ms interval from the 1300
    // fire — silent even though the hold is done.
    expect(step(detector, 0.56, 1400, 0.5, 0.5)).toBeNull();
    expect(step(detector, 0.52, 1450)).toBeNull();
    expect(step(detector, 0.55, 1550)).toBeNull();
    expect(step(detector, 0.58, 1650)).toBeNull();
    expect(step(detector, 0.6, 1750)).toBeNull();
    // Still holding past the interval: fires on the next frame.
    expect(step(detector, 0.6, 1850)?.kind).toBe('press');
  });

  it('returns null and resets the hold when the body is absent', () => {
    const detector = new PressDetector();
    expect(step(detector, 0.52, 1000)).toBeNull();
    expect(step(detector, 0.55, 1100)).toBeNull();
    const [left, right] = wrists(0.58);
    expect(detector.update(left, right, HIP_MID_X, HIP_MID_Y, 0, 1200)).toBeNull();
    // Back at 1300: the hold restarts from here, not from 1000.
    expect(step(detector, 0.58, 1300)).toBeNull();
    expect(step(detector, 0.6, 1500)).toBeNull();
    expect(step(detector, 0.6, 1600)?.kind).toBe('press');
  });

  it('reset clears the hold, the re-arm, and the interval', () => {
    const detector = new PressDetector();
    fullPress(detector, 1000);
    detector.reset();
    fullPress(detector, 1100);
  });

  it('progress is 0 with no wrist in a zone, partial with one, and grows with the hold', () => {
    const detector = new PressDetector();
    const [left, right] = wrists(0.56);
    // Wrists at centre (x 0.5), outside both zones: progress 0.
    const [centreLeft, centreRight] = wrists(0.56, 0.5, 0.5);
    expect(
      detector.progress(centreLeft, centreRight, HIP_MID_X, HIP_MID_Y, TORSO, 1000),
    ).toBe(0);
    // Both wrists enter the zones at 1000.
    expect(step(detector, 0.56, 1000)).toBeNull();
    // Hold 0/300: (1 + 1 + 0) / 3.
    expect(detector.progress(left, right, HIP_MID_X, HIP_MID_Y, TORSO, 1000)).toBeCloseTo(2 / 3);
    // One wrist leaves at 1100 (a real update, so the hold resets):
    // (1 + 0 + 0) / 3.
    expect(step(detector, 0.56, 1100, 0.26, 0.5)).toBeNull();
    expect(
      detector.progress(
        { x: 0.26, y: 0.56 },
        { x: 0.5, y: 0.56 },
        HIP_MID_X,
        HIP_MID_Y,
        TORSO,
        1100,
      ),
    ).toBeCloseTo(1 / 3);
    // Back in at 1200, hold 150/300 by 1350: (1 + 1 + 0.5) / 3.
    expect(step(detector, 0.56, 1200)).toBeNull();
    expect(detector.progress(left, right, HIP_MID_X, HIP_MID_Y, TORSO, 1350)).toBeCloseTo(2.5 / 3);
  });
});
