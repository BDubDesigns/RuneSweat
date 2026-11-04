/**
 * Swing Lab — pickaxe swing state machine (Active RuneSpace Mining, Slice 1).
 *
 * Pure: no canvas, no DOM, no landmarks. It reads only `BodyState` fields
 * (wrist Y + wrist vertical velocity + shoulder Y + torso length) and a
 * clock, so it is unit-testable with synthetic bodies and runs unchanged
 * on the real tracker, the mouse simulator, and replay fixtures.
 *
 * THE SWING (all thresholds in `SWING`, `core/config.ts`):
 * - Two-handed overhead is primary: BOTH wrists rise above the shoulders
 *   (windup), then drop fast through chest level (strike). A single arm
 *   doing the same also counts, so a small player / one-handed play works.
 * - One swing = one hit: after a hit the machine ignores input for the
 *   cooldown, so holding the arms up or waving them cannot double-count.
 *
 * Phases: Ready -> Windup -> Strike -> Recover -> Ready.
 *
 * - Ready: arms at rest. A wrist rising above the windup line arms the
 *   swing (Windup). A wrist rising only partway (above the shoulders but
 *   below the windup line) starts a *partial attempt*: if it then drops
 *   back to rest FAST, that is a weak swing, "Swing bigger!" — the arc
 *   was never completed. Dropping slowly from partway is just putting
 *   your arms down: no feedback, no penalty.
 * - Windup: at least one arm is wound. The drop is judged at the strike
 *   line (chest level): crossing it with a fast drop is a HIT; crossing
 *   it slowly is a weak swing, "Swing faster!". A wound arm cannot leave
 *   Windup without crossing the strike line — rest is below the line —
 *   so every windup ends in a hit or a weak swing, never in silence.
 * - Strike: entered the moment a wound arm's downward velocity crosses
 *   the strike threshold while it is still above the strike line. This
 *   phase is mostly presentational (the meter flashes, the whoosh plays);
 *   the hit itself is decided at the line. If the swing is pulled back
 *   up above the windup line before crossing, it was a flick, not a
 *   follow-through: weak swing, "Swing bigger!".
 * - Recover: after a hit, all input is ignored for the cooldown.
 *
 * HIT VELOCITY — PEAK, NOT INSTANTANEOUS. The hit decision uses the
 * PEAK downward velocity seen during the drop (from leaving the windup
 * line to crossing the strike line), not the instantaneous velocity at
 * the line. Two reasons: the camera runs at ~9 Hz on the Pixel, so the
 * frame where the wrist is first seen below the line may already be
 * past the fastest moment; and a real pickaxe swing decelerates AT
 * contact, so velocity at the line is the wrong thing to measure. A
 * slow drop never reaches the threshold, so it still reads "too slow".
 *
 * Weak swings cost nothing (no XP, no ore) and re-arm quickly
 * (`SWING.weakRearmMs`, shorter than the hit cooldown) so a kid can
 * immediately try again.
 */

import { SWING } from '../../core/config';
import type { BodyState } from '../../core/bodyState';

/** The only body fields the machine reads. `BodyState` satisfies this. */
export type SwingBodyInput = Pick<
  BodyState,
  | 'present'
  | 'torsoLength'
  | 'shoulderY'
  | 'leftWristY'
  | 'rightWristY'
  | 'leftWristVelY'
  | 'rightWristVelY'
>;

export type SwingPhase = 'ready' | 'windup' | 'strike' | 'recover';

export type SwingHandedness = 'two-handed' | 'left' | 'right';

export type WeakReason = 'too-small' | 'too-slow';

export interface SwingHitEvent {
  kind: 'hit';
  handedness: SwingHandedness;
  message: 'HIT!';
}

export interface SwingWeakEvent {
  kind: 'weak';
  reason: WeakReason;
  message: 'Swing bigger!' | 'Swing faster!';
}

export type SwingEvent = SwingHitEvent | SwingWeakEvent;

/** Read-only diagnostic snapshot, for the HUD and the swing meter. */
export interface SwingSnapshot {
  phase: SwingPhase;
  /** 0..1: how far the highest wrist has risen toward the windup line. */
  windupProgress: number;
  /** Wrist height above the shoulder, in torso lengths (negative = below). */
  leftHeight: number;
  rightHeight: number;
  /** Downward wrist velocity, torso lengths/sec (positive = moving down). */
  leftVel: number;
  rightVel: number;
  /** Last hit / weak-swing event (null until the first swing attempt). */
  lastEvent: SwingEvent | null;
}

/** Per-arm attempt state. */
interface ArmAttempt {
  /** Rose above the partial line (Ready phase): a partway swing is live. */
  partial: boolean;
  /** Reached the windup line: this arm is armed for a strike. */
  wound: boolean;
  /** Peak downward velocity (torso/s) seen during this attempt/drop. */
  peakVelDown: number;
}

function freshAttempt(): ArmAttempt {
  return { partial: false, wound: false, peakVelDown: 0 };
}

export class SwingMachine {
  private phase: SwingPhase = 'ready';
  private recoverUntilMs = 0;
  private rearmUntilMs = 0;
  private left: ArmAttempt = freshAttempt();
  private right: ArmAttempt = freshAttempt();
  private lastEvent: SwingEvent | null = null;
  private lastHeights = { left: 0, right: 0 };
  private lastVels = { left: 0, right: 0 };

  public reset(): void {
    this.phase = 'ready';
    this.recoverUntilMs = 0;
    this.rearmUntilMs = 0;
    this.left = freshAttempt();
    this.right = freshAttempt();
    this.lastEvent = null;
    this.lastHeights = { left: 0, right: 0 };
    this.lastVels = { left: 0, right: 0 };
  }

  /** Current phase, for the game + HUD. */
  public get currentPhase(): SwingPhase {
    return this.phase;
  }

  public snapshot(): SwingSnapshot {
    const progress =
      this.phase === 'windup' || this.phase === 'strike'
        ? 1
        : this.phase === 'recover'
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                Math.max(this.lastHeights.left, this.lastHeights.right) /
                  SWING.windupHeightTorsoFrac,
              ),
            );
    return {
      phase: this.phase,
      windupProgress: progress,
      leftHeight: this.lastHeights.left,
      rightHeight: this.lastHeights.right,
      leftVel: this.lastVels.left,
      rightVel: this.lastVels.right,
      lastEvent: this.lastEvent,
    };
  }

  /**
   * One step. Returns a hit or weak-swing event, or null when nothing
   * happened this frame. At most one event per step: the first arm to
   * complete a swing ends it, so two arms swinging together are one hit.
   */
  public update(body: SwingBodyInput | null, nowMs: number): SwingEvent | null {
    if (body === null || !body.present || body.torsoLength <= 0) {
      this.left = freshAttempt();
      this.right = freshAttempt();
      this.phase = 'ready';
      this.lastHeights = { left: 0, right: 0 };
      this.lastVels = { left: 0, right: 0 };
      return null;
    }

    const leftHeight =
      (body.shoulderY - body.leftWristY) / body.torsoLength;
    const rightHeight =
      (body.shoulderY - body.rightWristY) / body.torsoLength;
    const leftVel = body.leftWristVelY / body.torsoLength;
    const rightVel = body.rightWristVelY / body.torsoLength;
    this.lastHeights = { left: leftHeight, right: rightHeight };
    this.lastVels = { left: leftVel, right: rightVel };

    if (this.phase === 'recover') {
      if (nowMs >= this.recoverUntilMs) {
        this.phase = 'ready';
        this.left = freshAttempt();
        this.right = freshAttempt();
      }
      return null;
    }
    // Weak-swing re-arm: brief input blackout so one bad swing cannot
    // emit twice (the arms are still falling when the event fires).
    if (this.phase === 'ready' && nowMs < this.rearmUntilMs) return null;

    if (this.phase === 'ready') return this.stepReady(leftHeight, rightHeight, leftVel, rightVel, nowMs);
    if (this.phase === 'windup') return this.stepWindup(leftHeight, rightHeight, leftVel, rightVel, nowMs);
    return this.stepStrike(leftHeight, rightHeight, leftVel, rightVel, nowMs);
  }

  private stepReady(
    leftHeight: number,
    rightHeight: number,
    leftVel: number,
    rightVel: number,
    nowMs: number,
  ): SwingEvent | null {
    const heights = { left: leftHeight, right: rightHeight };
    const vels = { left: leftVel, right: rightVel };
    for (const side of ['left', 'right'] as const) {
      const arm = side === 'left' ? this.left : this.right;
      const height = heights[side];
      const vel = vels[side];
      if (height >= SWING.windupHeightTorsoFrac) {
        // Reached the windup line: arm the swing.
        arm.wound = true;
        arm.partial = false;
        arm.peakVelDown = 0;
        this.phase = 'windup';
        continue;
      }
      if (height >= SWING.partialHeightTorsoFrac) {
        arm.partial = true;
        arm.peakVelDown = Math.max(arm.peakVelDown, vel);
        continue;
      }
      if (arm.partial) {
        // Still falling through the attempt zone: keep tracking the peak.
        arm.peakVelDown = Math.max(arm.peakVelDown, vel);
      }
      if (height <= 0 && arm.partial) {
        // Arm is back at rest: judge the partway attempt now.
        const weak = this.judgePartial(arm, nowMs);
        arm.partial = false;
        arm.peakVelDown = 0;
        if (weak !== null) return weak;
      }
    }
    return null;
  }

  /**
   * A partway raise that dropped back to rest. Fast drop = the player
   * swung but never got the wrists overhead: "Swing bigger!". Slow drop
   * = just putting the arms down: no event.
   */
  private judgePartial(arm: ArmAttempt, nowMs: number): SwingEvent | null {
    if (arm.peakVelDown < SWING.strikeVelocityTorsoFracPerSec) return null;
    return this.emitWeak('too-small', 'Swing bigger!', nowMs);
  }

  private stepWindup(
    leftHeight: number,
    rightHeight: number,
    leftVel: number,
    rightVel: number,
    nowMs: number,
  ): SwingEvent | null {
    const heights = { left: leftHeight, right: rightHeight };
    const vels = { left: leftVel, right: rightVel };
    for (const side of ['left', 'right'] as const) {
      const arm = side === 'left' ? this.left : this.right;
      const height = heights[side];
      const vel = vels[side];
      if (!arm.wound) {
        // A second arm can join the windup late.
        if (height >= SWING.windupHeightTorsoFrac) {
          arm.wound = true;
          arm.peakVelDown = 0;
        }
        continue;
      }
      arm.peakVelDown = Math.max(arm.peakVelDown, vel);
      if (height <= -SWING.strikeLineTorsoFrac) {
        // Crossed the strike line on the way down: judge the drop.
        return this.judgeStrikeCrossing(side, nowMs);
      }
      if (
        vel >= SWING.strikeVelocityTorsoFracPerSec &&
        height > -SWING.strikeLineTorsoFrac
      ) {
        // Fast drop, still above the line: the swing is in flight.
        this.phase = 'strike';
      }
    }
    return null;
  }

  private stepStrike(
    leftHeight: number,
    rightHeight: number,
    leftVel: number,
    rightVel: number,
    nowMs: number,
  ): SwingEvent | null {
    const heights = { left: leftHeight, right: rightHeight };
    const vels = { left: leftVel, right: rightVel };
    for (const side of ['left', 'right'] as const) {
      const arm = side === 'left' ? this.left : this.right;
      if (!arm.wound) continue;
      const height = heights[side];
      const vel = vels[side];
      arm.peakVelDown = Math.max(arm.peakVelDown, vel);
      if (height <= -SWING.strikeLineTorsoFrac) {
        return this.judgeStrikeCrossing(side, nowMs);
      }
    }
    // Pulled back up above the windup line before crossing: a flick,
    // not a follow-through.
    const pulledBack =
      (this.left.wound && leftHeight >= SWING.windupHeightTorsoFrac) ||
      (this.right.wound && rightHeight >= SWING.windupHeightTorsoFrac);
    if (pulledBack && !this.anyWoundBelowWindup(leftHeight, rightHeight)) {
      return this.emitWeak('too-small', 'Swing bigger!', nowMs);
    }
    return null;
  }

  /** Both wound arms are back above the windup line (none still dropping). */
  private anyWoundBelowWindup(leftHeight: number, rightHeight: number): boolean {
    return (
      (this.left.wound && leftHeight < SWING.windupHeightTorsoFrac) ||
      (this.right.wound && rightHeight < SWING.windupHeightTorsoFrac)
    );
  }

  /**
   * A wound arm crossed the strike line. Hit when the drop was fast
   * (peak velocity during the drop at/above the threshold); otherwise
   * the player wound up but dropped slowly: "Swing faster!".
   */
  private judgeStrikeCrossing(
    side: 'left' | 'right',
    nowMs: number,
  ): SwingEvent | null {
    const arm = side === 'left' ? this.left : this.right;
    if (arm.peakVelDown < SWING.strikeVelocityTorsoFracPerSec) {
      return this.emitWeak('too-slow', 'Swing faster!', nowMs);
    }
    const handedness: SwingHandedness =
      this.left.wound && this.right.wound
        ? 'two-handed'
        : side;
    const event: SwingHitEvent = {
      kind: 'hit',
      handedness,
      message: 'HIT!',
    };
    this.lastEvent = event;
    this.phase = 'recover';
    this.recoverUntilMs = nowMs + SWING.cooldownMs;
    this.left = freshAttempt();
    this.right = freshAttempt();
    return event;
  }

  private emitWeak(
    reason: WeakReason,
    message: 'Swing bigger!' | 'Swing faster!',
    nowMs: number,
  ): SwingEvent {
    const event: SwingWeakEvent = { kind: 'weak', reason, message };
    this.lastEvent = event;
    this.phase = 'ready';
    this.rearmUntilMs = nowMs + SWING.weakRearmMs;
    this.left = freshAttempt();
    this.right = freshAttempt();
    return event;
  }
}
