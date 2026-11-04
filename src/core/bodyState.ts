/**
 * BodyState: the game's view of the player's body, derived from one pose.
 *
 * This is the ONLY module that reads raw landmarks for gameplay. Games never
 * touch landmark indices — they read `BodyState.torsoX`, `arm.raised`,
 * `arm.angleDeg`, `jumping`, `ducking`, and `poseMatchScore()`. That is what
 * makes the games reusable across the real tracker, the mouse simulator and
 * replay fixtures with zero changes.
 *
 * Geometry rules:
 * - All angles are computed in **video space** (unmirrored). Games that need
 *   a canvas-space direction use {@link armDirectionCanvas}, which applies
 *   the mirror exactly once.
 * - `z` is never read.
 * - Torso length (shoulder-mid to hip-mid) is the body-relative unit: every
 *   threshold is a fraction of it, so the same numbers work for a 5-year-old
 *   and an adult, near and far from the camera.
 */

import { BODY, POSE } from './config';
import { OneEuroFilter, OneEuroFilter2D } from './oneEuro';
import {
  PoseLandmark,
  type NormalizedLandmark,
  type RawPoseFrame,
} from '../tracking/poseTypes';
import { clamp } from '../render/stage';

export type ArmSide = 'left' | 'right';

/** Per-arm derived state. */
export interface ArmState {
  side: ArmSide;
  /** Wrist is above the shoulder by more than the raise threshold. */
  raised: boolean;
  /** Shoulder->wrist distance exceeds the extend threshold (arm straight). */
  extended: boolean;
  /**
   * Angle of the shoulder->wrist vector from straight up, in degrees.
   * 0 = straight up, positive = pointing to video-right, negative = to
   * video-left. Smoothed by a One Euro filter.
   */
  angleDeg: number;
  /** Raw (unsmoothed) angle, for the debug HUD. */
  angleDegRaw: number;
  /** Shoulder->wrist distance, as a fraction of torso length. */
  lengthTorsoFrac: number;
}

/** The game's view of the body in one frame. */
export interface BodyState {
  /** A person was detected in this frame. */
  present: boolean;
  /** Torso is confidently seen and inside the frame margins. */
  inFrame: boolean;
  /** Smoothed hip-midpoint x, video space [0,1]. Drives the ship. */
  torsoX: number;
  /** Smoothed hip-midpoint y, video space [0,1]. */
  torsoY: number;
  /** Shoulder-mid to hip-mid distance, video-space units. */
  torsoLength: number;
  /** Mean visibility of shoulders + hips (0..1). */
  visibilityScore: number;
  leftArm: ArmState;
  rightArm: ArmState;
  /** Hip-mid rose above its standing baseline: a jump. */
  jumping: boolean;
  /** Hip-mid dropped + knees bent: a duck / squat. */
  ducking: boolean;
  /** The standing hip-mid y this frame's jump/duck is measured against. */
  hipBaselineY: number;
  /** Frame timestamp this state was derived from, in ms. */
  timestampMs: number;
}

/** A joint whose angle we can score, for pose matching. */
export type PoseJoint =
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftElbow'
  | 'rightElbow'
  | 'leftHip'
  | 'rightHip'
  | 'leftKnee'
  | 'rightKnee';

/** Target joint angles (degrees) for one dance pose. 180 = straight. */
export type PoseTarget = Partial<Record<PoseJoint, number>>;

/** The three landmarks that define each scored joint: [a, vertex, c]. */
const JOINT_LANDMARKS: Record<PoseJoint, readonly [number, number, number]> = {
  leftShoulder: [
    PoseLandmark.LEFT_ELBOW,
    PoseLandmark.LEFT_SHOULDER,
    PoseLandmark.LEFT_HIP,
  ],
  rightShoulder: [
    PoseLandmark.RIGHT_ELBOW,
    PoseLandmark.RIGHT_SHOULDER,
    PoseLandmark.RIGHT_HIP,
  ],
  leftElbow: [
    PoseLandmark.LEFT_SHOULDER,
    PoseLandmark.LEFT_ELBOW,
    PoseLandmark.LEFT_WRIST,
  ],
  rightElbow: [
    PoseLandmark.RIGHT_SHOULDER,
    PoseLandmark.RIGHT_ELBOW,
    PoseLandmark.RIGHT_WRIST,
  ],
  leftHip: [
    PoseLandmark.LEFT_SHOULDER,
    PoseLandmark.LEFT_HIP,
    PoseLandmark.LEFT_KNEE,
  ],
  rightHip: [
    PoseLandmark.RIGHT_SHOULDER,
    PoseLandmark.RIGHT_HIP,
    PoseLandmark.RIGHT_KNEE,
  ],
  leftKnee: [
    PoseLandmark.LEFT_HIP,
    PoseLandmark.LEFT_KNEE,
    PoseLandmark.LEFT_ANKLE,
  ],
  rightKnee: [
    PoseLandmark.RIGHT_HIP,
    PoseLandmark.RIGHT_KNEE,
    PoseLandmark.RIGHT_ANKLE,
  ],
};

/** Midpoint of two landmarks, in video space. */
export function midpoint(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Euclidean distance between two landmarks, in video-space units. */
export function landmarkDistance(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Angle at vertex `b` between segments b->a and b->c, in degrees (0..180).
 * 180 means the three points are in a straight line.
 */
export function jointAngle(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  c: NormalizedLandmark,
): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const mag1 = Math.hypot(v1x, v1y);
  const mag2 = Math.hypot(v2x, v2y);
  if (mag1 < 1e-9 || mag2 < 1e-9) return 180;
  const cos = clamp(dot / (mag1 * mag2), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

/** All eight scored joint angles for a pose, in degrees. */
export function jointAngles(
  landmarks: readonly NormalizedLandmark[],
): Record<PoseJoint, number> {
  const out = {} as Record<PoseJoint, number>;
  for (const joint of Object.keys(JOINT_LANDMARKS) as PoseJoint[]) {
    const [a, b, c] = JOINT_LANDMARKS[joint];
    const la = landmarks[a];
    const lb = landmarks[b];
    const lc = landmarks[c];
    out[joint] =
      la !== undefined && lb !== undefined && lc !== undefined
        ? jointAngle(la, lb, lc)
        : 180;
  }
  return out;
}

/**
 * Pose-match score (0..1) between live landmarks and a target pose.
 * 1 = exact match on every joint the target specifies. Each joint
 * contributes `1 - |actual - target| / 180`. Joints the target does not
 * specify are ignored, so a pose can be loose about the legs while strict
 * about the arms.
 */
export function poseMatchScore(
  landmarks: readonly NormalizedLandmark[],
  target: PoseTarget,
): number {
  const actual = jointAngles(landmarks);
  const joints = Object.keys(target) as PoseJoint[];
  if (joints.length === 0) return 0;
  let sum = 0;
  for (const joint of joints) {
    const wanted = target[joint];
    if (wanted === undefined) continue;
    sum += 1 - Math.abs(actual[joint] - wanted) / 180;
  }
  return clamp(sum / joints.length, 0, 1);
}

/**
 * Raw arm angle: shoulder->wrist vector from straight up, in degrees.
 * 0 = straight up, positive = pointing to video-right. `y` grows downward
 * in video space, so "up" is the negative-y direction.
 */
export function armAngleDegRaw(
  shoulder: NormalizedLandmark,
  wrist: NormalizedLandmark,
): number {
  const dx = wrist.x - shoulder.x;
  const dy = shoulder.y - wrist.y; // positive when the wrist is above the shoulder
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/**
 * Canvas-space unit direction a missile should travel for an arm at
 * `angleDeg` (video space). The mirror flips the x component: an arm
 * pointing to video-right points to canvas-left. Straight up stays up.
 */
export function armDirectionCanvas(angleDeg: number): { x: number; y: number } {
  const clamped = clamp(angleDeg, -BODY.maxFireAngleDeg, BODY.maxFireAngleDeg);
  const rad = (clamped * Math.PI) / 180;
  return { x: -Math.sin(rad), y: -Math.cos(rad) };
}

/** Is this arm raised AND extended, i.e. ready to fire? */
export function armCanFire(arm: ArmState): boolean {
  return arm.raised && arm.extended;
}

/** A neutral arm state (no person, or arm not visible). */
function neutralArm(side: ArmSide): ArmState {
  return {
    side,
    raised: false,
    extended: false,
    angleDeg: 0,
    angleDegRaw: 0,
    lengthTorsoFrac: 0,
  };
}

/**
 * Stateful tracker: smooths torso + arm angles across frames and maintains
 * the standing hip baseline for jump/duck. One instance per game session;
 * call `reset()` when switching games or sources.
 */
export class BodyStateTracker {
  private readonly torsoFilter = new OneEuroFilter2D({
    minCutoff: BODY.oneEuroMinCutoff,
    beta: BODY.oneEuroBeta,
    dCutoff: BODY.oneEuroDCutoff,
  });
  private readonly leftAngleFilter = new OneEuroFilter({
    minCutoff: BODY.oneEuroMinCutoff,
    beta: BODY.oneEuroBeta,
    dCutoff: BODY.oneEuroDCutoff,
  });
  private readonly rightAngleFilter = new OneEuroFilter({
    minCutoff: BODY.oneEuroMinCutoff,
    beta: BODY.oneEuroBeta,
    dCutoff: BODY.oneEuroDCutoff,
  });
  private hipBaselineY: number | null = null;

  public reset(): void {
    this.torsoFilter.reset();
    this.leftAngleFilter.reset();
    this.rightAngleFilter.reset();
    this.hipBaselineY = null;
  }

  /**
   * Derive the body state for one frame. Returns a `present: false` state
   * (never `null`) when no person is detected, so games can show the
   * out-of-frame warning from one code path.
   */
  public update(frame: RawPoseFrame | null): BodyState {
    const timestampMs = frame?.timestampMs ?? 0;
    if (frame === null || frame.landmarks === null) {
      return {
        present: false,
        inFrame: false,
        torsoX: 0.5,
        torsoY: 0.5,
        torsoLength: 0,
        visibilityScore: 0,
        leftArm: neutralArm('left'),
        rightArm: neutralArm('right'),
        jumping: false,
        ducking: false,
        hipBaselineY: this.hipBaselineY ?? 0.5,
        timestampMs,
      };
    }

    const lm = frame.landmarks;
    const ls = lm[PoseLandmark.LEFT_SHOULDER];
    const rs = lm[PoseLandmark.RIGHT_SHOULDER];
    const lh = lm[PoseLandmark.LEFT_HIP];
    const rh = lm[PoseLandmark.RIGHT_HIP];
    const lw = lm[PoseLandmark.LEFT_WRIST];
    const rw = lm[PoseLandmark.RIGHT_WRIST];
    const lk = lm[PoseLandmark.LEFT_KNEE];
    const rk = lm[PoseLandmark.RIGHT_KNEE];
    const la = lm[PoseLandmark.LEFT_ANKLE];
    const ra = lm[PoseLandmark.RIGHT_ANKLE];
    if (
      ls === undefined || rs === undefined || lh === undefined || rh === undefined ||
      lw === undefined || rw === undefined || lk === undefined || rk === undefined ||
      la === undefined || ra === undefined
    ) {
      return {
        present: false,
        inFrame: false,
        torsoX: 0.5,
        torsoY: 0.5,
        torsoLength: 0,
        visibilityScore: 0,
        leftArm: neutralArm('left'),
        rightArm: neutralArm('right'),
        jumping: false,
        ducking: false,
        hipBaselineY: this.hipBaselineY ?? 0.5,
        timestampMs,
      };
    }

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const torsoLength = Math.max(
      landmarkDistance(shoulderMid, hipMid),
      1e-6,
    );
    const visibilityScore =
      ((ls.visibility ?? 0) +
        (rs.visibility ?? 0) +
        (lh.visibility ?? 0) +
        (rh.visibility ?? 0)) /
      4;

    const tSeconds = timestampMs / 1000;
    const torso = this.torsoFilter.filter(hipMid.x, hipMid.y, tSeconds);

    // Standing baseline: slow EMA, updated only while the hips are near it
    // and both ankles are visible — a jump or duck must not drag it along.
    if (this.hipBaselineY === null) {
      this.hipBaselineY = hipMid.y;
    } else if (Math.abs(hipMid.y - this.hipBaselineY) < 0.05 * torsoLength + 0.01) {
      this.hipBaselineY += (hipMid.y - this.hipBaselineY) * 0.02;
    }
    const baselineY = this.hipBaselineY;

    const leftArm = this.deriveArm(
      'left', ls, lw, torsoLength, tSeconds, this.leftAngleFilter,
    );
    const rightArm = this.deriveArm(
      'right', rs, rw, torsoLength, tSeconds, this.rightAngleFilter,
    );

    const hipRise = baselineY - hipMid.y;
    const jumping = hipRise > BODY.jumpThresholdTorsoFrac * torsoLength;
    const angles = jointAngles(lm);
    const kneesBent =
      angles.leftKnee < BODY.duckKneeAngleDeg ||
      angles.rightKnee < BODY.duckKneeAngleDeg;
    const ducking =
      hipMid.y - baselineY > BODY.duckThresholdTorsoFrac * torsoLength && kneesBent;

    const inFrame =
      visibilityScore >= 0.4 &&
      torso.x > POSE.inFrameMarginX &&
      torso.x < 1 - POSE.inFrameMarginX;

    return {
      present: true,
      inFrame,
      torsoX: torso.x,
      torsoY: torso.y,
      torsoLength,
      visibilityScore,
      leftArm,
      rightArm,
      jumping,
      ducking,
      hipBaselineY: baselineY,
      timestampMs,
    };
  }

  private deriveArm(
    side: ArmSide,
    shoulder: NormalizedLandmark,
    wrist: NormalizedLandmark,
    torsoLength: number,
    tSeconds: number,
    angleFilter: OneEuroFilter,
  ): ArmState {
    const length = landmarkDistance(shoulder, wrist);
    const lengthTorsoFrac = length / torsoLength;
    const raised =
      shoulder.y - wrist.y > BODY.raiseThresholdTorsoFrac * torsoLength;
    const extended = lengthTorsoFrac > BODY.extendThresholdTorsoFrac;
    const angleDegRaw = armAngleDegRaw(shoulder, wrist);
    const angleDeg = angleFilter.filter(angleDegRaw, tSeconds);
    return { side, raised, extended, angleDeg, angleDegRaw, lengthTorsoFrac };
  }
}
