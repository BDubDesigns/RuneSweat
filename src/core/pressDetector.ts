/**
 * Pedestal-press detector (Refiner v3.4): the two-button press that
 * powers a refining batch — both wrists inside their button zones,
 * moving downward, held for `PRESS.holdMs`.
 *
 * Replaces the star jump (v3.1-3.3). The Nov 4 playtest proved the
 * jump unplayable for Brandon: he is too tall for his room, so he
 * cannot jump without his head/hands leaving the frame — a textbook
 * star shape (hopper 2/2, 13 s clip) counted 0/3. The press needs
 * arms only: no vertical space, no legs, hands stay separated (which
 * also dodges the handedness-latch flip that meeting hands overhead
 * used to trigger).
 *
 * The buttons live in **normalized video space** (the same space as
 * `BodyState` wrist X/Y, 0..1), placed relative to the body's stance
 * so they follow the player: centre at hip-mid ± 0.8 torso lengths
 * horizontally, top at the hip line − 0.15 torso, 0.5 wide × 0.4
 * tall (torso lengths). See `PRESS` in `core/config.ts` for the
 * numbers and why. `pressButtonZones` is pure so the game renders
 * the same zones it detects against.
 *
 * Pure + stateful, modelled on the deleted StarJumpDetector: one
 * event per hold — after firing it re-arms only once a wrist leaves
 * its zone or rises above the zone top — plus a 500 ms minimum
 * interval as a backstop against a noisy frame double-counting.
 *
 * Downward means wrist Y increasing (video space y is down). The
 * wrists must move downward at any point during the hold: parking
 * the hands in the zones without pressing does not count.
 */

import { PRESS } from './config';

/** A button zone in normalized video space (0..1, origin top-left). */
export interface PressRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A wrist position in normalized video space. */
export interface PressWrist {
  x: number;
  y: number;
}

/**
 * Pure zone placement: the two button zones for a body standing at
 * (`hipMidX`, `hipMidY`) with torso length `torsoLength` (all
 * normalized video space). Left centre at hip-mid − 0.8 torso,
 * right centre at hip-mid + 0.8 torso, tops at the hip line −
 * 0.15 torso, each zone 0.5 wide × 0.4 tall in torso lengths.
 */
export function pressButtonZones(
  hipMidX: number,
  hipMidY: number,
  torsoLength: number,
): { left: PressRect; right: PressRect } {
  const w = PRESS.buttonZoneWTorsoFrac * torsoLength;
  const h = PRESS.buttonZoneHTorsoFrac * torsoLength;
  const y = hipMidY + PRESS.buttonZoneTopOffsetTorsoFrac * torsoLength;
  const offset = PRESS.buttonOffsetTorsoFrac * torsoLength;
  return {
    left: { x: hipMidX - offset - w / 2, y, w, h },
    right: { x: hipMidX + offset - w / 2, y, w, h },
  };
}

/** A wrist inside its zone (inclusive edges). */
function inZone(wrist: PressWrist, zone: PressRect): boolean {
  return (
    wrist.x >= zone.x &&
    wrist.x <= zone.x + zone.w &&
    wrist.y >= zone.y &&
    wrist.y <= zone.y + zone.h
  );
}

/** One counted pedestal press. */
export interface PressEvent {
  kind: 'press';
  /** ms clock reading when it fired. */
  atMs: number;
}

/** Stateful detector: edge-triggers one event per hold. */
export class PressDetector {
  /** ms the last press fired at (0 = never). */
  private lastFiredMs = 0;
  /** True while a new press may fire (false after firing, until re-arm). */
  private armed = true;
  /** ms the current hold started (null = no hold in progress). */
  private holdStartMs: number | null = null;
  /** A wrist moved downward at some point during the current hold. */
  private movedDown = false;
  /** Previous frame's wrist Y, for downward-motion detection. */
  private prevLeftY: number | null = null;
  private prevRightY: number | null = null;

  public reset(): void {
    this.lastFiredMs = 0;
    this.armed = true;
    this.holdStartMs = null;
    this.movedDown = false;
    this.prevLeftY = null;
    this.prevRightY = null;
  }

  /**
   * One step. Returns a `press` event the first frame the hold
   * completes — both wrists continuously inside their zones for
   * `PRESS.holdMs` with downward motion at some point in the hold —
   * or null. Re-arms once a wrist leaves its zone (or rises above
   * the zone top, which is leaving the zone upward), so one hold
   * counts once however many frames it spans. Returns null and
   * resets the hold when the body is absent (`torsoLength <= 0`).
   */
  public update(
    leftWrist: PressWrist,
    rightWrist: PressWrist,
    hipMidX: number,
    hipMidY: number,
    torsoLength: number,
    nowMs: number,
  ): PressEvent | null {
    if (torsoLength <= 0) {
      this.holdStartMs = null;
      this.movedDown = false;
      this.armed = true;
      this.prevLeftY = null;
      this.prevRightY = null;
      return null;
    }
    const zones = pressButtonZones(hipMidX, hipMidY, torsoLength);
    const leftIn = inZone(leftWrist, zones.left);
    const rightIn = inZone(rightWrist, zones.right);
    if (!leftIn || !rightIn) {
      // A wrist left its zone: the hold restarts, and a fired
      // detector re-arms (rising above the zone top is leaving the
      // zone upward, so it re-arms here too).
      this.holdStartMs = null;
      this.movedDown = false;
      this.armed = true;
      this.prevLeftY = leftWrist.y;
      this.prevRightY = rightWrist.y;
      return null;
    }
    // Both wrists in their zones: downward motion this frame?
    // Video space y is down, so a larger Y is a downward move.
    if (
      (this.prevLeftY !== null && leftWrist.y > this.prevLeftY) ||
      (this.prevRightY !== null && rightWrist.y > this.prevRightY)
    ) {
      this.movedDown = true;
    }
    this.prevLeftY = leftWrist.y;
    this.prevRightY = rightWrist.y;
    if (this.holdStartMs === null) this.holdStartMs = nowMs;
    if (!this.armed) return null;
    if (!this.movedDown) return null;
    if (nowMs - this.holdStartMs < PRESS.holdMs) return null;
    if (nowMs - this.lastFiredMs < PRESS.minIntervalMs) return null;
    this.armed = false;
    this.lastFiredMs = nowMs;
    return { kind: 'press', atMs: nowMs };
  }

  /**
   * Current press progress 0..1, for on-screen feedback: the mean
   * of (left wrist in its zone, right wrist in its zone, hold
   * elapsed / `PRESS.holdMs`). A pure read — it does not advance
   * the hold or the downward-motion tracking; call `update` first
   * for the frame, then this.
   */
  public progress(
    leftWrist: PressWrist,
    rightWrist: PressWrist,
    hipMidX: number,
    hipMidY: number,
    torsoLength: number,
    nowMs: number,
  ): number {
    if (torsoLength <= 0) return 0;
    const zones = pressButtonZones(hipMidX, hipMidY, torsoLength);
    const leftIn = inZone(leftWrist, zones.left) ? 1 : 0;
    const rightIn = inZone(rightWrist, zones.right) ? 1 : 0;
    const holdFrac =
      this.holdStartMs === null || leftIn === 0 || rightIn === 0
        ? 0
        : Math.min(1, (nowMs - this.holdStartMs) / PRESS.holdMs);
    return (leftIn + rightIn + holdFrac) / 3;
  }
}
