/**
 * Star-jump detector (Refiner v3.1): the jumping-jack shape that powers
 * a refining batch — jump + arms out wide + legs apart.
 *
 * Forgiving on purpose: Brandon is not a gymnast, and the detector
 * judges the SHAPE, not perfection. Each of the three conditions is a
 * generous line with margin on both sides (see `STAR_JUMP` in
 * `core/config.ts` for the numbers and why):
 * - jumping: `BodyState.jumping` — the hips rose above the standing
 *   baseline (`BODY.jumpThresholdTorsoFrac`, 0.18 torso lengths).
 * - arms wide: wrist-to-wrist spread >= 1.2 torso lengths (arms
 *   straight up read ~0.73, arms out ±35° read ~1.9) AND both wrists
 *   at least 0.1 torso above the shoulder line (arms up/out, not
 *   hanging wide at the sides).
 * - legs apart: ankle spread >= 0.85 torso lengths (standing reads
 *   ~0.59, a jack's feet land ~1.0-1.4).
 *
 * Pure: reads only `BodyState` fields, so it is unit-testable with
 * synthetic bodies and runs unchanged on the real tracker, the mouse
 * simulator, and replay fixtures. One event per jump: after firing it
 * re-arms only once the player has landed (`jumping` false) or the
 * shape is lost, plus a 500 ms minimum interval as a backstop against
 * a noisy frame double-counting at ~9 Hz inference.
 *
 * Mouse-sim note: the current sim CANNOT express legs-apart — its
 * ankles are fixed at hip width (~0.59 torso) and no key spreads
 * them, so a sim star jump can never satisfy the legs condition.
 * The coordinator needs to add a sim leg-spread input (e.g. a key
 * that spreads the sim ankles while jumping); until then the
 * refiner's star-jump step is verifiable in unit tests and on a real
 * body only. Arms + jump ARE expressible in the sim today: hold `W`
 * (jump, after Worker A's Space -> W rebind) + `Q`+`E` (arms angled
 * out ±35°, spread ~1.9 torso, wrists ~0.87 torso above the
 * shoulders).
 */

import { STAR_JUMP } from './config';
import type { BodyState } from './bodyState';

/** The only body fields the detector reads. `BodyState` satisfies this. */
export type StarJumpBodyInput = Pick<
  BodyState,
  | 'present'
  | 'torsoLength'
  | 'shoulderY'
  | 'leftWristX'
  | 'rightWristX'
  | 'leftWristY'
  | 'rightWristY'
  | 'jumping'
  | 'ankleSpreadTorsoFrac'
>;

/** Which of the three star-jump conditions hold right now. */
export interface StarJumpShape {
  /** Hips rose above the standing baseline. */
  jumping: boolean;
  /** Arms out wide AND up (spread + height). */
  armsWide: boolean;
  /** Ankles apart. */
  legsApart: boolean;
  /** Fraction of the three conditions met (0, 1/3, 2/3, 1). */
  progress: number;
  /** All three: this frame IS a star jump. */
  isStarJump: boolean;
}

/**
 * Pure shape check for one body: which conditions hold. No state, no
 * clock — the detector class below adds the one-event-per-jump logic.
 */
export function starJumpShape(
  body: StarJumpBodyInput | null,
): StarJumpShape {
  const none: StarJumpShape = {
    jumping: false,
    armsWide: false,
    legsApart: false,
    progress: 0,
    isStarJump: false,
  };
  if (body === null || !body.present || body.torsoLength <= 0) return none;
  const spread =
    Math.abs(body.rightWristX - body.leftWristX) / body.torsoLength;
  const leftHeight =
    (body.shoulderY - body.leftWristY) / body.torsoLength;
  const rightHeight =
    (body.shoulderY - body.rightWristY) / body.torsoLength;
  const armsWide =
    spread >= STAR_JUMP.minWristSpreadTorsoFrac &&
    leftHeight >= STAR_JUMP.minWristHeightTorsoFrac &&
    rightHeight >= STAR_JUMP.minWristHeightTorsoFrac;
  const legsApart =
    (body.ankleSpreadTorsoFrac ?? 0) >= STAR_JUMP.minAnkleSpreadTorsoFrac;
  const jumping = body.jumping;
  const met = (jumping ? 1 : 0) + (armsWide ? 1 : 0) + (legsApart ? 1 : 0);
  return {
    jumping,
    armsWide,
    legsApart,
    progress: met / 3,
    isStarJump: met === 3,
  };
}

/** One counted star jump. */
export interface StarJumpEvent {
  kind: 'star-jump';
  /** ms clock reading when it fired. */
  atMs: number;
}

/** Stateful detector: edge-triggers one event per jump. */
export class StarJumpDetector {
  /** ms the last jump fired at (0 = never). */
  private lastFiredMs = 0;
  /** True while the player is mid-air in a counted jump. */
  private armed = true;

  public reset(): void {
    this.lastFiredMs = 0;
    this.armed = true;
  }

  /**
   * One step. Returns a `star-jump` event the first frame the full
   * shape is seen while jumping, or null. Re-arms when the player
   * lands (`jumping` false) or the shape is lost, so one jack counts
   * once however many frames it spans.
   */
  public update(
    body: StarJumpBodyInput | null,
    nowMs: number,
  ): StarJumpEvent | null {
    const shape = starJumpShape(body);
    if (!shape.isStarJump) {
      // Shape lost (landed, arms came in, feet together): re-arm.
      if (!shape.jumping) this.armed = true;
      else if (!shape.armsWide || !shape.legsApart) this.armed = true;
      return null;
    }
    if (!this.armed) return null;
    if (nowMs - this.lastFiredMs < STAR_JUMP.minIntervalMs) return null;
    this.armed = false;
    this.lastFiredMs = nowMs;
    return { kind: 'star-jump', atMs: nowMs };
  }

  /** Current shape, for on-screen progress (1/3, 2/3, 3/3). */
  public shape(body: StarJumpBodyInput | null): StarJumpShape {
    return starJumpShape(body);
  }
}
