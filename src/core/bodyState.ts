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

import { BODY, GATE, POSE, SWING } from './config';
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

/** Per-landmark visibility (0..1) for the joints the gate + HUD care about. */
export interface LandmarkVisibility {
  leftShoulder: number;
  rightShoulder: number;
  leftHip: number;
  rightHip: number;
  leftKnee: number;
  rightKnee: number;
}

/** A body state with no person detected (all visibilities zero). */
function absentVisibility(): LandmarkVisibility {
  return {
    leftShoulder: 0,
    rightShoulder: 0,
    leftHip: 0,
    rightHip: 0,
    leftKnee: 0,
    rightKnee: 0,
  };
}

/** The game's view of the body in one frame. */
export interface BodyState {
  /** A person was detected in this frame. */
  present: boolean;
  /** Torso is confidently seen and inside the frame margins. */
  inFrame: boolean;
  /**
   * Usable full-body pose: present AND in frame AND shoulders + hips +
   * knees each individually at or above `GATE.minVisibility` (the mean
   * `visibilityScore` can hide one bad landmark). Knees are required
   * because the swing games need the whole body — the Nov 4, 2026
   * playtest showed "Body found" with the knees hidden. This is what the
   * body-visible gate runs on.
   */
  bodyUsable: boolean;
  /** Per-landmark visibility for shoulders / hips / knees. */
  landmarkVisibility: LandmarkVisibility;
  /** Both knees confidently visible — feeds `bodyUsable` (see below). */
  kneesVisible: boolean;
  /** Smoothed shoulder-midpoint y, video space [0,1]. Windup / strike
   *  lines are measured from here (wrist height above/below the shoulders).
   */
  shoulderY: number;
  /** Smoothed wrist positions, video space [0,1]. */
  leftWristX: number;
  rightWristX: number;
  leftWristY: number;
  rightWristY: number;
  /**
   * Smoothed vertical wrist velocity, normalized units/sec. Positive =
   * moving DOWN in video space (y grows downward). Derived from the
   * frame-to-frame change of the smoothed wrist Y over timestamp deltas,
   * lightly smoothed with an EMA (`SWING.wristVelEmaAlpha`). Games read
   * this (divided by `torsoLength`) for swing detection — never raw
   * landmarks.
   */
  leftWristVelY: number;
  rightWristVelY: number;
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
  private readonly shoulderYFilter = new OneEuroFilter({
    minCutoff: BODY.oneEuroMinCutoff,
    beta: BODY.oneEuroBeta,
    dCutoff: BODY.oneEuroDCutoff,
  });
  private readonly leftWristFilter = new OneEuroFilter2D({
    minCutoff: BODY.oneEuroMinCutoff,
    beta: BODY.oneEuroBeta,
    dCutoff: BODY.oneEuroDCutoff,
  });
  private readonly rightWristFilter = new OneEuroFilter2D({
    minCutoff: BODY.oneEuroMinCutoff,
    beta: BODY.oneEuroBeta,
    dCutoff: BODY.oneEuroDCutoff,
  });
  private hipBaselineY: number | null = null;
  /** Previous smoothed wrist Y + shared timestamp, for velocity. */
  private prevLeftWristY: number | null = null;
  private prevRightWristY: number | null = null;
  private prevWristTSeconds: number | null = null;
  /** Current EMA-smoothed wrist velocities (normalized units/sec). */
  private leftWristVelY = 0;
  private rightWristVelY = 0;

  public reset(): void {
    this.torsoFilter.reset();
    this.leftAngleFilter.reset();
    this.rightAngleFilter.reset();
    this.hipBaselineY = null;
    this.resetWristTracking();
  }

  /**
   * Clear all wrist-tracking state. Called on reset() and whenever a frame
   * has no usable pose, so a reappearing body cannot compute a giant
   * velocity from a stale previous wrist position.
   */
  private resetWristTracking(): void {
    this.shoulderYFilter.reset();
    this.leftWristFilter.reset();
    this.rightWristFilter.reset();
    this.prevLeftWristY = null;
    this.prevRightWristY = null;
    this.prevWristTSeconds = null;
    this.leftWristVelY = 0;
    this.rightWristVelY = 0;
  }

  /**
   * One wrist's vertical velocity for this frame, from the change in its
   * smoothed Y since the previous frame over the timestamp delta, lightly
   * smoothed with an EMA. First frame, a repeated timestamp, or a gap
   * over 0.5 s (tab backgrounded) re-baselines at velocity 0 — there is
   * no trustworthy delta in those cases.
   */
  private wristVelocity(
    prevY: number | null,
    prevVel: number,
    ySm: number,
    tSeconds: number,
  ): number {
    if (prevY === null || this.prevWristTSeconds === null) return 0;
    const dt = tSeconds - this.prevWristTSeconds;
    if (dt <= 0 || dt > 0.5) return 0;
    const raw = (ySm - prevY) / dt;
    const alpha = SWING.wristVelEmaAlpha;
    return alpha * raw + (1 - alpha) * prevVel;
  }

  /**
   * Derive the body state for one frame. Returns a `present: false` state
   * (never `null`) when no person is detected, so games can show the
   * out-of-frame warning from one code path.
   */
  public update(frame: RawPoseFrame | null): BodyState {
    const timestampMs = frame?.timestampMs ?? 0;
    if (frame === null || frame.landmarks === null) {
      this.resetWristTracking();
      return {
        present: false,
        inFrame: false,
        bodyUsable: false,
        landmarkVisibility: absentVisibility(),
        kneesVisible: false,
        shoulderY: 0.5,
        leftWristX: 0.5,
        rightWristX: 0.5,
        leftWristY: 0.5,
        rightWristY: 0.5,
        leftWristVelY: 0,
        rightWristVelY: 0,
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
      this.resetWristTracking();
      return {
        present: false,
        inFrame: false,
        bodyUsable: false,
        landmarkVisibility: absentVisibility(),
        kneesVisible: false,
        shoulderY: 0.5,
        leftWristX: 0.5,
        rightWristX: 0.5,
        leftWristY: 0.5,
        rightWristY: 0.5,
        leftWristVelY: 0,
        rightWristVelY: 0,
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
    const shoulderY = this.shoulderYFilter.filter(shoulderMid.y, tSeconds);

    // Wrist positions (smoothed) + vertical velocities. Velocity is the
    // frame-to-frame change of the SMOOTHED wrist Y over the timestamp
    // delta — raw landmark jitter would spike a velocity taken from raw Y.
    const leftWristSm = this.leftWristFilter.filter(lw.x, lw.y, tSeconds);
    const rightWristSm = this.rightWristFilter.filter(rw.x, rw.y, tSeconds);
    this.leftWristVelY = this.wristVelocity(
      this.prevLeftWristY,
      this.leftWristVelY,
      leftWristSm.y,
      tSeconds,
    );
    this.rightWristVelY = this.wristVelocity(
      this.prevRightWristY,
      this.rightWristVelY,
      rightWristSm.y,
      tSeconds,
    );
    this.prevLeftWristY = leftWristSm.y;
    this.prevRightWristY = rightWristSm.y;
    this.prevWristTSeconds = tSeconds;

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

    // Each of the six torso/leg landmarks must be individually confident —
    // a mean can hide one shoulder/hip/knee the model barely sees. Knees
    // gate when GATE.requireKnees is true (true since the Nov 4 playtest:
    // a full-body swing game cannot trust a body whose knees it can't see).
    const landmarkVisibility: LandmarkVisibility = {
      leftShoulder: ls.visibility ?? 0,
      rightShoulder: rs.visibility ?? 0,
      leftHip: lh.visibility ?? 0,
      rightHip: rh.visibility ?? 0,
      leftKnee: lk.visibility ?? 0,
      rightKnee: rk.visibility ?? 0,
    };
    const kneesVisible =
      landmarkVisibility.leftKnee >= GATE.minVisibility &&
      landmarkVisibility.rightKnee >= GATE.minVisibility;
    const bodyUsable =
      inFrame &&
      landmarkVisibility.leftShoulder >= GATE.minVisibility &&
      landmarkVisibility.rightShoulder >= GATE.minVisibility &&
      landmarkVisibility.leftHip >= GATE.minVisibility &&
      landmarkVisibility.rightHip >= GATE.minVisibility &&
      (!GATE.requireKnees || kneesVisible);

    return {
      present: true,
      inFrame,
      bodyUsable,
      landmarkVisibility,
      kneesVisible,
      shoulderY,
      leftWristX: leftWristSm.x,
      rightWristX: rightWristSm.x,
      leftWristY: leftWristSm.y,
      rightWristY: rightWristSm.y,
      leftWristVelY: this.leftWristVelY,
      rightWristVelY: this.rightWristVelY,
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
