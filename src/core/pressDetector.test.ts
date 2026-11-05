import { describe, expect, it } from 'vitest';
import { PressDetector, pressButtonZones, type PressWrist } from './pressDetector';

/**
 * Synthetic stance for the detector: hip-mid (0.5, 0.55), torso
 * 0.3. The zones land at left centre x 0.335 / right centre x
 * 0.665, top y 0.532, bottom y 0.628 — so a wrist at the zone
 * centres (0.335, 0.58) / (0.665, 0.58) is dead centre in each
 * button.
 *
 * Resting-wrist measurement (v3.5): the sim body's hanging wrists
 * (`sim/mouseSource.ts`, arms at ±π·0.94 from straight up, arm
 * length 0.32, shoulders (0.39 / 0.61, 0.25)) rest at
 * (0.330, 0.564) / (0.670, 0.564) — hip-mid ±0.567 torso
 * horizontally, hip + 0.048 torso vertically. The v3.6 zones are
 * built around that rest position with room on both ends: the
 * resting wrist sits ~0.108 torso below the zone top (0.532) and
 * a 0.1-torso push ends at 0.594, ~0.112 torso above the zone
 * bottom (0.628).
 */
const HIP_MID_X = 0.5;
const HIP_MID_Y = 0.55;
const TORSO = 0.3;
/** Zone centres for the stance above (hip-mid ± 0.55 torso). */
const LEFT_CENTRE_X = 0.335;
const RIGHT_CENTRE_X = 0.665;
/** Sim resting-wrist position (see the header comment). */
const REST_LEFT_X = 0.33;
const REST_RIGHT_X = 0.67;
const REST_Y = 0.564;
/** Press travel: ~0.1 torso downward from rest (0.03 normalized). */
const PRESS_TRAVEL = 0.1 * TORSO;

function wrists(y: number, leftX = LEFT_CENTRE_X, rightX = RIGHT_CENTRE_X): [PressWrist, PressWrist] {
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
 * A full press: both wrists in the zones, moving downward from the
 * resting position, held 300 ms. Frames at 100 ms: y 0.564 -> 0.574
 * -> 0.584 -> 0.594, all inside the zones (top 0.532, bottom
 * 0.628) — a 0.1-torso push from rest, not a reach.
 */
function fullPress(detector: PressDetector, t0: number): void {
  expect(step(detector, REST_Y, t0)).toBeNull();
  expect(step(detector, REST_Y + 0.01, t0 + 100)).toBeNull();
  expect(step(detector, REST_Y + 0.02, t0 + 200)).toBeNull();
  expect(step(detector, REST_Y + PRESS_TRAVEL, t0 + 300)?.kind).toBe('press');
}

describe('pressButtonZones', () => {
  it('places the zones at ±0.55 torso from hip-mid, at waist/hip height', () => {
    const zones = pressButtonZones(HIP_MID_X, HIP_MID_Y, TORSO);
    // Centres: 0.5 ± 0.55 * 0.3 = 0.335 / 0.665.
    expect(zones.left.x + zones.left.w / 2).toBeCloseTo(0.335);
    expect(zones.right.x + zones.right.w / 2).toBeCloseTo(0.665);
    // Top: hip line − 0.06 torso = 0.55 − 0.018 = 0.532.
    expect(zones.left.y).toBeCloseTo(0.532);
    expect(zones.right.y).toBeCloseTo(0.532);
    // Size: 0.25 wide × 0.32 tall, in torso lengths.
    expect(zones.left.w).toBeCloseTo(0.075);
    expect(zones.left.h).toBeCloseTo(0.096);
    expect(zones.right.w).toBeCloseTo(0.075);
    expect(zones.right.h).toBeCloseTo(0.096);
  });

  it('v3.6: zones are HIGHER and TALLER than v3.5 (the playtest fix)', () => {
    const zones = pressButtonZones(HIP_MID_X, HIP_MID_Y, TORSO);
    // v3.5 top was hip + 0.02 torso = 0.556; v3.6 top is 0.532 —
    // above it (smaller y = higher on screen).
    expect(zones.left.y).toBeLessThan(0.556);
    expect(zones.right.y).toBeLessThan(0.556);
    // v3.5 height was 0.2 torso = 0.06; v3.6 is 0.32 torso = 0.096.
    expect(zones.left.h / TORSO).toBeGreaterThan(0.2);
    expect(zones.left.h).toBeCloseTo(0.096);
    // Width and offset unchanged from v3.5: still fist-wide pads
    // close to the body, not a reach.
    expect(zones.left.w / TORSO).toBeCloseTo(0.25);
    const centreX = zones.left.x + zones.left.w / 2;
    expect(Math.abs(centreX - HIP_MID_X) / TORSO).toBeCloseTo(0.55);
  });

  it('zones are fist-wide and close to the body (v3.6 bounds)', () => {
    const zones = pressButtonZones(HIP_MID_X, HIP_MID_Y, TORSO);
    for (const zone of [zones.left, zones.right]) {
      // Width ≤ 0.25 torso: a button, not a slab. Height 0.32
      // torso: tall enough for the push, still narrower than the
      // v3.4 slab (0.4) — a tall button, not a wall.
      expect(zone.w / TORSO).toBeLessThanOrEqual(0.25);
      expect(zone.h / TORSO).toBeGreaterThan(0.2);
      expect(zone.h / TORSO).toBeLessThanOrEqual(0.35);
      // Centre offset ≤ 0.55 torso from hip-mid: a push, not a reach.
      // (+1e-9: 0.55 * 0.3 / 0.3 reads 0.5500000000000002 in float.)
      const centreX = zone.x + zone.w / 2;
      expect(Math.abs(centreX - HIP_MID_X) / TORSO).toBeLessThanOrEqual(0.55 + 1e-9);
    }
  });

  it('both zones are reachable from a centred stance', () => {
    const zones = pressButtonZones(HIP_MID_X, HIP_MID_Y, TORSO);
    for (const zone of [zones.left, zones.right]) {
      const centreX = zone.x + zone.w / 2;
      const distanceTorso = Math.abs(centreX - HIP_MID_X) / TORSO;
      // +1e-9: 0.55 * 0.3 / 0.3 reads 0.5500000000000002 in float.
      expect(distanceTorso).toBeLessThanOrEqual(0.55 + 1e-9);
    }
  });

  it('zones sit at resting-wrist height: rest inside with slack both ends', () => {
    const zones = pressButtonZones(HIP_MID_X, HIP_MID_Y, TORSO);
    for (const [zone, restX] of [
      [zones.left, REST_LEFT_X],
      [zones.right, REST_RIGHT_X],
    ] as const) {
      // The resting wrist is inside its zone horizontally.
      expect(restX).toBeGreaterThanOrEqual(zone.x);
      expect(restX).toBeLessThanOrEqual(zone.x + zone.w);
      // The zone top sits ABOVE the resting wrist (video space y
      // is down, so "above" is a smaller y) — the wrist enters the
      // pad from above, ~0.108 torso below the top, not perched on
      // the top edge the way v3.5's 0.028-torso margin did.
      expect(zone.y).toBeLessThan(REST_Y);
      expect((REST_Y - zone.y) / TORSO).toBeCloseTo(0.107, 1);
      // Resting wrist + the full ~0.1-torso downward press travel
      // stays inside the zone with ~0.112 torso of slack below it.
      expect(REST_Y + PRESS_TRAVEL).toBeLessThanOrEqual(zone.y + zone.h);
      expect((zone.y + zone.h - (REST_Y + PRESS_TRAVEL)) / TORSO).toBeGreaterThan(0.1);
    }
  });
});

describe('PressDetector', () => {
  it('counts both wrists in zones + downward + 300 ms hold', () => {
    const detector = new PressDetector();
    fullPress(detector, 1000);
  });

  it('counts a press with the wrists at the zone centres', () => {
    const detector = new PressDetector();
    // Dead centre in each button, pressing down from rest.
    expect(step(detector, REST_Y, 1000, LEFT_CENTRE_X, RIGHT_CENTRE_X)).toBeNull();
    expect(step(detector, REST_Y + 0.01, 1100, LEFT_CENTRE_X, RIGHT_CENTRE_X)).toBeNull();
    expect(step(detector, REST_Y + 0.02, 1200, LEFT_CENTRE_X, RIGHT_CENTRE_X)).toBeNull();
    expect(step(detector, REST_Y + PRESS_TRAVEL, 1300, LEFT_CENTRE_X, RIGHT_CENTRE_X)?.kind).toBe(
      'press',
    );
  });

  it('does NOT count with one wrist only', () => {
    const detector = new PressDetector();
    // Right wrist parked outside its zone (x 0.5, dead centre).
    expect(step(detector, REST_Y, 1000, LEFT_CENTRE_X, 0.5)).toBeNull();
    expect(step(detector, REST_Y + 0.01, 1100, LEFT_CENTRE_X, 0.5)).toBeNull();
    expect(step(detector, REST_Y + 0.02, 1200, LEFT_CENTRE_X, 0.5)).toBeNull();
    expect(step(detector, REST_Y + PRESS_TRAVEL, 1300, LEFT_CENTRE_X, 0.5)).toBeNull();
    expect(step(detector, REST_Y + PRESS_TRAVEL, 1500, LEFT_CENTRE_X, 0.5)).toBeNull();
  });

  it('does NOT count with wrists at the old ±0.8 reach positions', () => {
    const detector = new PressDetector();
    // v3.4 centres (0.26 / 0.74) with the same downward push and
    // hold: the old reach must no longer count.
    expect(step(detector, REST_Y, 1000, 0.26, 0.74)).toBeNull();
    expect(step(detector, REST_Y + 0.01, 1100, 0.26, 0.74)).toBeNull();
    expect(step(detector, REST_Y + 0.02, 1200, 0.26, 0.74)).toBeNull();
    expect(step(detector, REST_Y + PRESS_TRAVEL, 1300, 0.26, 0.74)).toBeNull();
    expect(step(detector, REST_Y + PRESS_TRAVEL, 2000, 0.26, 0.74)).toBeNull();
  });

  it('does NOT count with no downward motion, however long the hold', () => {
    const detector = new PressDetector();
    // Wrists parked dead centre in the zones, never moving down.
    expect(step(detector, 0.586, 1000)).toBeNull();
    expect(step(detector, 0.586, 1200)).toBeNull();
    expect(step(detector, 0.586, 1400)).toBeNull();
    expect(step(detector, 0.586, 2000)).toBeNull();
  });

  it('does NOT count before the 300 ms hold completes', () => {
    const detector = new PressDetector();
    expect(step(detector, REST_Y, 1000)).toBeNull();
    expect(step(detector, REST_Y + 0.01, 1100)).toBeNull();
    expect(step(detector, REST_Y + 0.02, 1200)).toBeNull();
    // 200 ms in: still holding, not fired.
    expect(step(detector, REST_Y + PRESS_TRAVEL, 1200)).toBeNull();
    // 300 ms in: fires.
    expect(step(detector, REST_Y + PRESS_TRAVEL, 1300)?.kind).toBe('press');
  });

  it('does NOT count wrists above the buttons', () => {
    const detector = new PressDetector();
    // y 0.46-0.51 is above the zone tops (0.532) — hands raised, not pressing.
    expect(step(detector, 0.46, 1000)).toBeNull();
    expect(step(detector, 0.48, 1100)).toBeNull();
    expect(step(detector, 0.5, 1200)).toBeNull();
    expect(step(detector, 0.51, 1300)).toBeNull();
    expect(step(detector, 0.51, 2000)).toBeNull();
  });

  it('fires once per hold: a second press needs a re-arm (wrists leave, then return)', () => {
    const detector = new PressDetector();
    fullPress(detector, 1000);
    // Still holding in the zones: no second event.
    expect(step(detector, REST_Y + PRESS_TRAVEL, 1400)).toBeNull();
    expect(step(detector, REST_Y + PRESS_TRAVEL, 1800)).toBeNull();
    // Wrists leave the zones (hands to centre): re-arm.
    expect(step(detector, 0.586, 2000, 0.5, 0.5)).toBeNull();
    // Return and hold again: second press fires.
    fullPress(detector, 2100);
  });

  it('does NOT count a hold interrupted at 200 ms, and the hold restarts', () => {
    const detector = new PressDetector();
    expect(step(detector, REST_Y, 1000)).toBeNull();
    expect(step(detector, REST_Y + 0.01, 1100)).toBeNull();
    // Left wrist leaves its zone at 200 ms in.
    expect(step(detector, REST_Y + 0.02, 1200, 0.5, RIGHT_CENTRE_X)).toBeNull();
    // Back in the zones at 1300: the hold restarts here, so 1300 + 300
    // is the earliest fire — not 1000 + 300.
    expect(step(detector, REST_Y + 0.02, 1300)).toBeNull();
    expect(step(detector, REST_Y + PRESS_TRAVEL, 1400)).toBeNull();
    expect(step(detector, REST_Y + PRESS_TRAVEL, 1500)).toBeNull();
    expect(step(detector, REST_Y + PRESS_TRAVEL, 1600)?.kind).toBe('press');
  });

  it('does not double-count inside the 500 ms minimum interval', () => {
    const detector = new PressDetector();
    fullPress(detector, 1000);
    // Leave (re-arm) and return fast: the new hold starts at 1450 and
    // completes at 1750, inside the 500 ms interval from the 1300
    // fire — silent even though the hold is done.
    expect(step(detector, 0.586, 1400, 0.5, 0.5)).toBeNull();
    expect(step(detector, REST_Y, 1450)).toBeNull();
    expect(step(detector, REST_Y + 0.01, 1550)).toBeNull();
    expect(step(detector, REST_Y + 0.02, 1650)).toBeNull();
    expect(step(detector, REST_Y + PRESS_TRAVEL, 1750)).toBeNull();
    // Still holding past the interval: fires on the next frame.
    expect(step(detector, REST_Y + PRESS_TRAVEL, 1850)?.kind).toBe('press');
  });

  it('returns null and resets the hold when the body is absent', () => {
    const detector = new PressDetector();
    expect(step(detector, REST_Y, 1000)).toBeNull();
    expect(step(detector, REST_Y + 0.01, 1100)).toBeNull();
    const [left, right] = wrists(REST_Y + 0.02);
    expect(detector.update(left, right, HIP_MID_X, HIP_MID_Y, 0, 1200)).toBeNull();
    // Back at 1300: the hold restarts from here, not from 1000.
    expect(step(detector, REST_Y + 0.02, 1300)).toBeNull();
    expect(step(detector, REST_Y + PRESS_TRAVEL, 1500)).toBeNull();
    expect(step(detector, REST_Y + PRESS_TRAVEL, 1600)?.kind).toBe('press');
  });

  it('reset clears the hold, the re-arm, and the interval', () => {
    const detector = new PressDetector();
    fullPress(detector, 1000);
    detector.reset();
    fullPress(detector, 1100);
  });

  it('progress is 0 with no wrist in a zone, partial with one, and grows with the hold', () => {
    const detector = new PressDetector();
    const [left, right] = wrists(0.586);
    // Wrists at centre (x 0.5), outside both zones: progress 0.
    const [centreLeft, centreRight] = wrists(0.586, 0.5, 0.5);
    expect(
      detector.progress(centreLeft, centreRight, HIP_MID_X, HIP_MID_Y, TORSO, 1000),
    ).toBe(0);
    // Both wrists enter the zones at 1000.
    expect(step(detector, 0.586, 1000)).toBeNull();
    // Hold 0/300: (1 + 1 + 0) / 3.
    expect(detector.progress(left, right, HIP_MID_X, HIP_MID_Y, TORSO, 1000)).toBeCloseTo(2 / 3);
    // One wrist leaves at 1100 (a real update, so the hold resets):
    // (1 + 0 + 0) / 3.
    expect(step(detector, 0.586, 1100, LEFT_CENTRE_X, 0.5)).toBeNull();
    expect(
      detector.progress(
        { x: LEFT_CENTRE_X, y: 0.586 },
        { x: 0.5, y: 0.586 },
        HIP_MID_X,
        HIP_MID_Y,
        TORSO,
        1100,
      ),
    ).toBeCloseTo(1 / 3);
    // Back in at 1200, hold 150/300 by 1350: (1 + 1 + 0.5) / 3.
    expect(step(detector, 0.586, 1200)).toBeNull();
    expect(detector.progress(left, right, HIP_MID_X, HIP_MID_Y, TORSO, 1350)).toBeCloseTo(2.5 / 3);
  });
});
