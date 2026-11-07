/**
 * YouVille: gesture confirmation without an on-screen confirm button.
 *
 * One hand points at a selectable UI target. The OTHER arm acts like a
 * lever: briefly hold it straight to the side, then deliberately lower
 * it toward the hip. The hovered target is frozen as the lever pull
 * starts, so cursor jitter during the pull cannot change the selection.
 *
 * This detector consumes an ArmState rather than raw pose landmarks.
 * The caller chooses which arm confirms, checks body/gate liveness,
 * and handles pointing / display / touch alternatives. No camera data
 * needs to leave the device.
 */
import type { ArmState } from './bodyState';
import { LEVER_CONFIRM } from './config';

export type LeverPhase = 'idle' | 'arming' | 'armed' | 'pulling' | 'latched';

export interface LeverSnapshot {
  phase: LeverPhase;
  capturedId: string | null;
  /** Ready to pull (the lever arm is extended sideways). */
  armed: boolean;
}

export class LeverConfirmDetector {
  private phase: LeverPhase = 'idle';
  private horizontalSinceMs: number | null = null;
  private pullSinceMs: number | null = null;
  private downSinceMs: number | null = null;
  private lastConfirmedMs: number | null = null;
  private lastStepMs: number | null = null;
  private direction: 1 | -1 | null = null;
  private capturedId: string | null = null;

  public reset(): void {
    this.phase = 'idle';
    this.horizontalSinceMs = null;
    this.pullSinceMs = null;
    this.downSinceMs = null;
    this.lastConfirmedMs = null;
    this.lastStepMs = null;
    this.direction = null;
    this.capturedId = null;
  }

  public snapshot(): LeverSnapshot {
    return {
      phase: this.phase,
      capturedId: this.capturedId,
      armed: this.phase === 'armed',
    };
  }

  /**
   * Advance one input frame. Returns the one confirmed target ID, or
   * null. A new selection requires lifting the lever arm sideways again.
   *
   * Invalid/lost tracking resets the gesture: never confirm from a stale
   * pose. The caller should pass null when body/gate is unusable.
   */
  public update(
    arm: ArmState | null,
    hoveredId: string | null,
    nowMs: number,
  ): string | null {
    if (
      arm === null ||
      !arm.extended ||
      !Number.isFinite(arm.angleDeg) ||
      !Number.isFinite(nowMs)
    ) {
      this.reset();
      return null;
    }
    if (this.lastStepMs !== null && nowMs <= this.lastStepMs) return null;
    this.lastStepMs = nowMs;

    // ArmState: zero is straight up; +90/-90 is horizontal, and
    // +180/-180 is hanging down. Use absolute angles for either arm.
    const angle = Math.abs(arm.angleDeg);
    const side = arm.angleDeg < 0 ? -1 : 1;
    const horizontal =
      angle >= LEVER_CONFIRM.horizontalMinDeg &&
      angle <= LEVER_CONFIRM.horizontalMaxDeg;
    const movingDown =
      angle >= LEVER_CONFIRM.pullStartDeg &&
      angle < LEVER_CONFIRM.downMinDeg;
    const down = angle >= LEVER_CONFIRM.downMinDeg;

    if (this.phase === 'idle') {
      if (horizontal) {
        this.phase = 'arming';
        this.horizontalSinceMs = nowMs;
        this.direction = side;
      }
      return null;
    }

    if (this.phase === 'arming') {
      if (!horizontal || side !== this.direction) {
        this.phase = 'idle';
        this.horizontalSinceMs = null;
        this.direction = null;
        return null;
      }
      if (
        this.horizontalSinceMs !== null &&
        nowMs - this.horizontalSinceMs >= LEVER_CONFIRM.horizontalHoldMs
      ) {
        this.phase = 'armed';
      }
      return null;
    }

    if (this.phase === 'latched') {
      // A full new horizontal hold is required before another pull.
      if (!horizontal || side !== this.direction) {
        this.horizontalSinceMs = null;
        return null;
      }
      if (this.horizontalSinceMs === null) this.horizontalSinceMs = nowMs;
      if (nowMs - this.horizontalSinceMs >= LEVER_CONFIRM.horizontalHoldMs) {
        this.phase = 'armed';
        this.horizontalSinceMs = null;
      }
      return null;
    }

    if (this.phase === 'armed') {
      if (horizontal && side === this.direction) return null;
      if (movingDown && side === this.direction) {
        this.phase = 'pulling';
        this.pullSinceMs = nowMs;
        this.downSinceMs = null;
        this.capturedId = hoveredId;
        return null;
      }
      // A single-frame jump straight down (or wrist identity flip) is
      // not a deliberate lever pull; demand an intermediate sample.
      this.phase = 'idle';
      this.capturedId = null;
      return null;
    }

    // Pulling: accept a continuous descent on the same side, then
    // briefly hold near vertical. A return to horizontal cancels it.
    if (
      this.pullSinceMs === null ||
      nowMs - this.pullSinceMs > LEVER_CONFIRM.maxPullMs
    ) {
      this.phase = 'idle';
      this.capturedId = null;
      return null;
    }
    if (horizontal && side === this.direction) {
      this.phase = 'armed';
      this.pullSinceMs = null;
      this.downSinceMs = null;
      this.capturedId = null;
      return null;
    }
    if (movingDown && side === this.direction) {
      this.downSinceMs = null;
      return null;
    }
    if (!down) {
      // An unexplained sign flip or arm crossing is not a valid pull.
      this.phase = 'idle';
      this.capturedId = null;
      return null;
    }
    // Around straight down, +/-180 can wrap across the sign boundary.
    if (this.downSinceMs === null) this.downSinceMs = nowMs;
    if (nowMs - this.downSinceMs < LEVER_CONFIRM.downHoldMs) return null;
    const confirmed =
      this.capturedId !== null &&
      (this.lastConfirmedMs === null ||
        nowMs - this.lastConfirmedMs >= LEVER_CONFIRM.minIntervalMs)
        ? this.capturedId
        : null;
    this.phase = 'latched';
    this.horizontalSinceMs = null;
    this.pullSinceMs = null;
    this.downSinceMs = null;
    this.capturedId = null;
    if (confirmed !== null) this.lastConfirmedMs = nowMs;
    return confirmed;
  }
}
