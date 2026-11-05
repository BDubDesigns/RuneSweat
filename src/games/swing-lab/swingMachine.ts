/**
 * Swing Lab — pickaxe swing state machine (Active RuneSpace Mining, Slice 1).
 *
 * Pure: no canvas, no DOM, no landmarks. It reads only `BodyState` fields
 * (wrist X/Y + wrist vertical velocity + shoulder Y + torso length +
 * shoulder width) and a clock, so it is unit-testable with synthetic bodies
 * and runs unchanged on the real tracker, the mouse simulator, and replay
 * fixtures.
 *
 * THE SWING (all thresholds in `SWING` / `FACING`, `core/config.ts`):
 * - Two-handed ONLY. BOTH wrists rise above the shoulders together
 *   (windup), hands clasped on one handle, then chop straight down in
 *   front of the body through waist level (strike). A single arm doing
 *   the same does NOT count: it is a weak swing, "Both hands together!".
 * - One swing = one hit: after a hit the machine ignores input for the
 *   cooldown, so holding the arms up or waving them cannot double-count.
 *
 * Phases: Ready -> Windup -> Strike -> Recover -> Ready.
 *
 * - Ready: arms at rest. BOTH wrists rising above the windup line at the
 *   same time arms the swing (Windup). One wrist crossing early while the
 *   other is still low is not a windup yet — the machine waits, and does
 *   not punish it. A partway raise of BOTH hands (above the shoulders
 *   but below the windup line) starts a *partial attempt*: if both drop
 *   back to rest FAST, that is a weak swing, "Swing bigger!" — the arc
 *   was never completed. Dropping slowly from partway is just putting
 *   your arms down: no feedback, no penalty. A single arm that rises
 *   overhead and completes a full fast drop while the other never wound
 *   is a weak swing, "Both hands together!" — same for a slow solo
 *   lower, which is just putting one arm down (no feedback).
 * - Windup: the pair is wound. The drop is judged at the strike line
 *   (waist level): both wrists crossing it with a fast drop is a HIT;
 *   crossing it slowly is a weak swing, "Swing faster!". The drop is
 *   judged on the PAIR: the velocity that counts is the MINIMUM of the
 *   two arms' peak downward velocities, so one arm cannot carry the
 *   swing. If the wound pair separates mid-drop (hands come apart
 *   while chopping fast) that is a weak swing, "Both hands together!",
 *   fired at once. If one wrist crosses the line while the other is
 *   still up overhead, the pair has split: "Both hands together!".
 *   A wound pair cannot leave Windup without crossing the strike line
 *   — rest is below the line — so every windup ends in a hit or a weak
 *   swing, never in silence.
 * - Strike: entered the moment the pair's drop goes fast while still
 *   above the strike line. This phase is mostly presentational (the
 *   meter flashes, the whoosh plays); the hit itself is decided at the
 *   line. If the pair is pulled back up above the windup line AFTER
 *   having dropped below it, it was a flick, not a follow-through:
 *   weak swing, "Swing bigger!". The "after having dropped below it"
 *   matters: a freshly wound pair whose drop is just starting still
 *   has its wrists above the windup line, and that is not a flick
 *   (v1 misread a settled ~0.5 s hold this way — the drop's first fast
 *   frames still read above the line — and swallowed the swing).
 * - Recover: after a hit, all input is ignored for the cooldown.
 *
 * HIT VELOCITY — PEAK, NOT INSTANTANEOUS, AND THE PAIR'S MINIMUM. The
 * hit decision uses the PEAK downward velocity seen during the drop
 * (from leaving the windup line to crossing the strike line), not the
 * instantaneous velocity at the line, and the pair's velocity is the
 * MINIMUM of the two arms' peaks. Three reasons: the camera runs at
 * ~9 Hz on the Pixel, so the frame where the wrists are first seen
 * below the line may already be past the fastest moment; a real
 * pickaxe swing decelerates AT contact, so velocity at the line is the
 * wrong thing to measure; and with hands clasped both wrists move
 * identically, so min ≈ mean in the real motion while a one-armed
 * carry fails. A slow drop never reaches the threshold, so it still
 * reads "too slow".
 *
 * FACING (hint only, never a gate): `snapshot().facingOk` is false when
 * a body is present and its shoulder-width ratio is below
 * `FACING.minShoulderWidthTorsoFrac` — the player is turned sideways.
 * The render code shows "Face the camera — I can't see you from the
 * side" and nothing else changes: the machine keeps judging swings.
 *
 * Weak swings cost nothing (no XP, no ore) and re-arm quickly
 * (`SWING.weakRearmMs`, shorter than the hit cooldown) so a kid can
 * immediately try again.
 */

import { FACING, SWING } from '../../core/config';
import type { BodyState } from '../../core/bodyState';

/** The only body fields the machine reads. `BodyState` satisfies this. */
export type SwingBodyInput = Pick<
  BodyState,
  | 'present'
  | 'torsoLength'
  | 'shoulderY'
  | 'leftWristX'
  | 'rightWristX'
  | 'leftWristY'
  | 'rightWristY'
  | 'leftWristVelY'
  | 'rightWristVelY'
  | 'shoulderWidthTorsoFrac'
>;

export type SwingPhase = 'ready' | 'windup' | 'strike' | 'recover';

/**
 * Kept as-is for the event shape: every hit is `'two-handed'` now (the
 * single-arm paths are gone), but render code reads `handedness`, so the
 * type and the field stay.
 */
export type SwingHandedness = 'two-handed' | 'left' | 'right';

export type WeakReason = 'too-small' | 'too-slow' | 'hands-apart';

export interface SwingHitEvent {
  kind: 'hit';
  handedness: SwingHandedness;
  message: 'HIT!';
}

export interface SwingWeakEvent {
  kind: 'weak';
  reason: WeakReason;
  message: 'Swing bigger!' | 'Swing faster!' | 'Both hands together!';
}

export type SwingEvent = SwingHitEvent | SwingWeakEvent;

/** Read-only diagnostic snapshot, for the HUD and the swing meter. */
export interface SwingSnapshot {
  phase: SwingPhase;
  /**
   * 0..1: how far the LOWER wrist has risen toward the windup line.
   * The pair is only as wound as its lower hand.
   */
  windupProgress: number;
  /** Wrist height above the shoulder, in torso lengths (negative = below). */
  leftHeight: number;
  rightHeight: number;
  /** Downward wrist velocity, torso lengths/sec (positive = moving down). */
  leftVel: number;
  rightVel: number;
  /**
   * Face-the-camera hint: true when there is no body (nothing to warn
   * about) or the shoulder-width ratio is at/above
   * `FACING.minShoulderWidthTorsoFrac`. Advisory only, never a gate.
   */
  facingOk: boolean;
  /** Last hit / weak-swing event (null until the first swing attempt). */
  lastEvent: SwingEvent | null;
}

/**
 * Is this shoulder-width ratio facing the camera? Pure helper for the
 * facing check: `null` means no body, so there is nothing to warn about.
 * Unit-tested; the machine calls it on every snapshot.
 */
export function facingOkFor(
  shoulderWidthTorsoFrac: number | null,
): boolean {
  return (
    shoulderWidthTorsoFrac === null ||
    shoulderWidthTorsoFrac >= FACING.minShoulderWidthTorsoFrac
  );
}

export class SwingMachine {
  private phase: SwingPhase = 'ready';
  private recoverUntilMs = 0;
  private rearmUntilMs = 0;
  /** Both wrists raised partway (above the partial line, below windup). */
  private pairPartial = false;
  /** Peak downward velocity per arm during the live pair attempt. */
  private pairPeakLeft = 0;
  private pairPeakRight = 0;
  /**
   * The pair has dropped below the windup line since winding. Guards the
   * flick rule: a drop that is just starting still reads above the line.
   */
  private droppedBelowWindup = false;
  /** Solo attempt: one wrist overhead, the other never wound. */
  private soloSide: 'left' | 'right' | null = null;
  private soloPeakVel = 0;
  private soloDroppedBelowWindup = false;
  private lastEvent: SwingEvent | null = null;
  private lastHeights = { left: 0, right: 0 };
  private lastVels = { left: 0, right: 0 };
  private lastShoulderWidth: number | null = null;

  public reset(): void {
    this.phase = 'ready';
    this.recoverUntilMs = 0;
    this.rearmUntilMs = 0;
    this.clearAttempt();
    this.lastEvent = null;
    this.lastHeights = { left: 0, right: 0 };
    this.lastVels = { left: 0, right: 0 };
    this.lastShoulderWidth = null;
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
                Math.min(this.lastHeights.left, this.lastHeights.right) /
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
      facingOk: facingOkFor(this.lastShoulderWidth),
      lastEvent: this.lastEvent,
    };
  }

  /**
   * One step. Returns a hit or weak-swing event, or null when nothing
   * happened this frame. At most one event per step.
   */
  public update(body: SwingBodyInput | null, nowMs: number): SwingEvent | null {
    if (body === null || !body.present || body.torsoLength <= 0) {
      this.clearAttempt();
      this.phase = 'ready';
      this.lastHeights = { left: 0, right: 0 };
      this.lastVels = { left: 0, right: 0 };
      this.lastShoulderWidth = null;
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
    this.lastShoulderWidth = body.shoulderWidthTorsoFrac;

    // Wrist-to-wrist distance, in torso lengths: the "gripping one
    // handle" signal. Clasped hands read ~0.05-0.15 apart.
    const handsDistance =
      Math.hypot(
        body.leftWristX - body.rightWristX,
        body.leftWristY - body.rightWristY,
      ) / body.torsoLength;
    const handsTogether =
      handsDistance <= SWING.handsTogetherTorsoFrac;

    if (this.phase === 'recover') {
      if (nowMs >= this.recoverUntilMs) {
        this.phase = 'ready';
        this.clearAttempt();
      }
      return null;
    }
    // Weak-swing re-arm: brief input blackout so one bad swing cannot
    // emit twice (the arms are still falling when the event fires).
    if (this.phase === 'ready' && nowMs < this.rearmUntilMs) return null;

    if (this.phase === 'ready') {
      return this.stepReady(
        leftHeight, rightHeight, leftVel, rightVel, handsTogether, nowMs,
      );
    }
    if (this.phase === 'windup') {
      return this.stepDrop(
        leftHeight, rightHeight, leftVel, rightVel, handsTogether, nowMs, true,
      );
    }
    // Strike phase: same drop judging, plus the flick rule.
    if (
      this.droppedBelowWindup &&
      leftHeight >= SWING.windupHeightTorsoFrac &&
      rightHeight >= SWING.windupHeightTorsoFrac
    ) {
      // Both wrists pulled back overhead after dropping below the line:
      // a flick, not a follow-through.
      return this.emitWeak('too-small', 'Swing bigger!', nowMs);
    }
    return this.stepDrop(
      leftHeight, rightHeight, leftVel, rightVel, handsTogether, nowMs, false,
    );
  }

  /** Clear every live attempt (pair partial / solo). */
  private clearAttempt(): void {
    this.pairPartial = false;
    this.pairPeakLeft = 0;
    this.pairPeakRight = 0;
    this.droppedBelowWindup = false;
    this.soloSide = null;
    this.soloPeakVel = 0;
    this.soloDroppedBelowWindup = false;
  }

  private stepReady(
    leftHeight: number,
    rightHeight: number,
    leftVel: number,
    rightVel: number,
    _handsTogether: boolean,
    nowMs: number,
  ): SwingEvent | null {
    const heights = { left: leftHeight, right: rightHeight };
    const vels = { left: leftVel, right: rightVel };

    const leftWound = leftHeight >= SWING.windupHeightTorsoFrac;
    const rightWound = rightHeight >= SWING.windupHeightTorsoFrac;

    if (leftWound && rightWound) {
      // Both wrists overhead at the same time: the pair is wound.
      this.pairPartial = false;
      this.pairPeakLeft = 0;
      this.pairPeakRight = 0;
      this.droppedBelowWindup = false;
      this.soloSide = null;
      this.soloPeakVel = 0;
      this.soloDroppedBelowWindup = false;
      this.phase = 'windup';
      return null;
    }

    if (leftWound || rightWound) {
      // Exactly one wrist overhead: not a windup yet — wait, do not
      // punish it. Track the solo arm so a completed solo drop can be
      // answered with "Both hands together!" instead of a hit.
      const side = leftWound ? 'left' : 'right';
      if (this.soloSide !== side) {
        this.soloSide = side;
        this.soloPeakVel = 0;
        this.soloDroppedBelowWindup = false;
        this.pairPartial = false;
      }
      return this.stepSolo(heights, vels, nowMs);
    }

    // No wrist overhead: a live solo attempt is still falling.
    if (this.soloSide !== null) {
      return this.stepSolo(heights, vels, nowMs);
    }

    // Pair partial attempt: BOTH wrists above the partial line.
    const leftPartial = leftHeight >= SWING.partialHeightTorsoFrac;
    const rightPartial = rightHeight >= SWING.partialHeightTorsoFrac;
    if (leftPartial && rightPartial) {
      this.pairPartial = true;
      this.pairPeakLeft = Math.max(this.pairPeakLeft, leftVel);
      this.pairPeakRight = Math.max(this.pairPeakRight, rightVel);
      return null;
    }
    if (this.pairPartial) {
      // Still falling through the attempt zone: keep tracking the peaks.
      this.pairPeakLeft = Math.max(this.pairPeakLeft, leftVel);
      this.pairPeakRight = Math.max(this.pairPeakRight, rightVel);
    }
    if (this.pairPartial && leftHeight <= 0 && rightHeight <= 0) {
      // Both wrists back at rest: judge the partway pair attempt now.
      const weak = this.judgePartial(nowMs);
      this.pairPartial = false;
      this.pairPeakLeft = 0;
      this.pairPeakRight = 0;
      return weak;
    }
    return null;
  }

  /**
   * One wrist overhead, the other never wound. A full fast drop through
   * the strike line is a weak swing, "Both hands together!" — the
   * player chopped with one arm. A slow drop is just putting the arm
   * down: no event. Rising back overhead without crossing is a flick
   * that never completed: silence, the attempt just ends.
   */
  private stepSolo(
    heights: { left: number; right: number },
    vels: { left: number; right: number },
    nowMs: number,
  ): SwingEvent | null {
    const side = this.soloSide;
    if (side === null) return null;
    const height = heights[side];
    const vel = vels[side];
    this.soloPeakVel = Math.max(this.soloPeakVel, vel);
    if (height < SWING.windupHeightTorsoFrac) {
      this.soloDroppedBelowWindup = true;
    }
    if (height <= -SWING.strikeLineTorsoFrac) {
      // Completed a full solo drop: judge it on the tracked peak
      // (already includes this frame's velocity — see above).
      const peak = this.soloPeakVel;
      this.soloSide = null;
      this.soloPeakVel = 0;
      this.soloDroppedBelowWindup = false;
      if (peak < SWING.strikeVelocityTorsoFracPerSec) {
        return null;
      }
      return this.emitWeak('hands-apart', 'Both hands together!', nowMs);
    }
    if (this.soloDroppedBelowWindup && height >= SWING.windupHeightTorsoFrac) {
      // Pulled back up without crossing: a flick, not a swing.
      this.soloSide = null;
      this.soloPeakVel = 0;
      this.soloDroppedBelowWindup = false;
    }
    return null;
  }

  /**
   * A partway pair raise that dropped back to rest. Fast drop = the
   * player swung but never got the wrists overhead: "Swing bigger!".
   * Slow drop = just putting the arms down: no event. The pair's peak
   * is the MINIMUM of the two arms' peaks: both hands must have
   * chopped, not one carrying the swing.
   */
  private judgePartial(nowMs: number): SwingEvent | null {
    const pairPeak = Math.min(this.pairPeakLeft, this.pairPeakRight);
    if (pairPeak < SWING.strikeVelocityTorsoFracPerSec) return null;
    return this.emitWeak('too-small', 'Swing bigger!', nowMs);
  }

  /**
   * The pair is wound and dropping (windup or strike phase — the only
   * difference is whether a fast drop above the line moves the machine
   * into the strike phase). Tracks the pair's peak velocities, fires
   * 'hands-apart' the moment the wound pair separates during a fast
   * drop, and judges the strike-line crossing.
   */
  private stepDrop(
    leftHeight: number,
    rightHeight: number,
    leftVel: number,
    rightVel: number,
    handsTogether: boolean,
    nowMs: number,
    allowStrikeTransition: boolean,
  ): SwingEvent | null {
    this.pairPeakLeft = Math.max(this.pairPeakLeft, leftVel);
    this.pairPeakRight = Math.max(this.pairPeakRight, rightVel);
    if (
      leftHeight < SWING.windupHeightTorsoFrac ||
      rightHeight < SWING.windupHeightTorsoFrac
    ) {
      this.droppedBelowWindup = true;
    }

    // The wound pair separated during a fast drop: the hands came apart
    // mid-chop. Fire at once — do not wait for the line.
    const droppingFast =
      leftVel >= SWING.strikeVelocityTorsoFracPerSec ||
      rightVel >= SWING.strikeVelocityTorsoFracPerSec;
    if (!handsTogether && droppingFast) {
      return this.emitWeak('hands-apart', 'Both hands together!', nowMs);
    }

    const strikeLine = -SWING.strikeLineTorsoFrac;
    const leftCrossed = leftHeight <= strikeLine;
    const rightCrossed = rightHeight <= strikeLine;
    const leftStillUp = leftHeight >= SWING.windupHeightTorsoFrac;
    const rightStillUp = rightHeight >= SWING.windupHeightTorsoFrac;
    // Judged when both wrists have crossed, or when one has crossed
    // while the other is still up overhead — the pair has split, and
    // waiting for the held arm would leave the machine stuck.
    const crossed =
      (leftCrossed && rightCrossed) ||
      (leftCrossed && rightStillUp) ||
      (rightCrossed && leftStillUp);
    if (crossed) {
      return this.judgeStrikeCrossing(handsTogether, nowMs);
    }

    if (
      allowStrikeTransition &&
      droppingFast &&
      leftHeight > strikeLine &&
      rightHeight > strikeLine
    ) {
      // Fast drop, still above the line: the swing is in flight.
      this.phase = 'strike';
    }
    return null;
  }

  /**
   * The pair crossed the strike line. Hit when the hands are together
   * and the drop was fast — the pair's velocity is the MINIMUM of the
   * two arms' peaks, so both hands must have chopped. Hands apart at
   * the line is "Both hands together!"; together but slow is
   * "Swing faster!".
   */
  private judgeStrikeCrossing(
    handsTogether: boolean,
    nowMs: number,
  ): SwingEvent | null {
    if (!handsTogether) {
      return this.emitWeak('hands-apart', 'Both hands together!', nowMs);
    }
    const pairPeak = Math.min(this.pairPeakLeft, this.pairPeakRight);
    if (pairPeak < SWING.strikeVelocityTorsoFracPerSec) {
      return this.emitWeak('too-slow', 'Swing faster!', nowMs);
    }
    const event: SwingHitEvent = {
      kind: 'hit',
      handedness: 'two-handed',
      message: 'HIT!',
    };
    this.lastEvent = event;
    this.phase = 'recover';
    this.recoverUntilMs = nowMs + SWING.cooldownMs;
    this.clearAttempt();
    return event;
  }

  private emitWeak(
    reason: WeakReason,
    message: 'Swing bigger!' | 'Swing faster!' | 'Both hands together!',
    nowMs: number,
  ): SwingEvent {
    const event: SwingWeakEvent = { kind: 'weak', reason, message };
    this.lastEvent = event;
    this.phase = 'ready';
    this.rearmUntilMs = nowMs + SWING.weakRearmMs;
    this.clearAttempt();
    return event;
  }
}
