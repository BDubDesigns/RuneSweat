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
   * Usable pose: present AND in frame AND shoulders + hips each
   * individually at or above `GATE.minVisibility` (the mean
   * `visibilityScore` can hide one bad landmark). Knees are NOT
   * part of this (v3.7, Nov 5, 2026): reaching up takes the knees
   * out of frame and the gate must not trip on that — the swing
   * only needs arms + head + chest. `kneesVisible` is still
   * tracked below, as data; it no longer feeds this flag. This is
   * what the body-visible gate runs on when the caller passes no
   * per-activity requirements.
   */
  bodyUsable: boolean;
  /** Per-landmark visibility for shoulders / hips / knees. */
  landmarkVisibility: LandmarkVisibility;
  /** Both knees confidently visible — data only since v3.7 (HUD, duck detection); no longer feeds `bodyUsable`. */
  kneesVisible: boolean;
  /** Smoothed shoulder-midpoint y, video space [0,1]. Windup / strike
   *  lines are measured from here (wrist height above/below the shoulders).
   */
  shoulderY: number;
  /**
   * Shoulder-midpoint x, video space [0,1] (raw landmark midpoint, not
   * smoothed). YouVille's door gestures measure wrists relative to the
   * body midline with it, so they are side- and mirror-agnostic.
   */
  shoulderMidX: number;
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
  /**
   * Shoulder-to-shoulder distance as a fraction of torso length
   * (One-Euro-smoothed like the other tracker fields, 0 when no body).
   * Front-facing shoulders read ~0.7-1.0; a side profile collapses
   * toward ~0.3-0.4. Feeds the face-the-camera HINT only
   * (`FACING.minShoulderWidthTorsoFrac`) — never the body gate.
   */
  shoulderWidthTorsoFrac: number;
  /**
   * The nose's horizontal offset from the shoulder midpoint, in torso
   * lengths (0 when the nose is centred over the shoulders, larger as
   * the face turns away). `null` when the nose is not confidently
   * visible, so there is no second opinion to offer. Second signal
   * for the face-the-camera HINT (v3): a front-facing player whose
   * shoulder reading dips narrow still has a centred nose.
   */
  noseOffsetTorsoFrac: number | null;
  /**
   * The wrist handedness latch is currently inverted relative to the
   * model's labels: the latched left wrist is coming from the model's
   * RIGHT_WRIST landmark (and vice versa). True after the model swapped
   * its left/right labels mid-pose and the latch held the physical
   * hands steady — the avatar did NOT flip. Debug HUD shows this so
   * a flip (or a latch) is visible in the next playtest. False on a
   * fresh body and whenever the labels agree with the latch.
   */
  wristLatchSwapped: boolean;
  /** Mean visibility of shoulders + hips (0..1). */
  visibilityScore: number;
  leftArm: ArmState;
  rightArm: ArmState;
  /** Hip-mid rose above its standing baseline: a jump. */
  jumping: boolean;
  /** Hip-mid dropped + knees bent: a duck / squat. */
  ducking: boolean;
  /**
   * Ankle-to-ankle distance as a fraction of torso length (raw, not
   * smoothed — ankles are stable when standing and the spread in a
   * jumping jack is large, so no filter lag is wanted). Standing reads
   * ~0.59 (hip width); a jumping jack lands ~1.0-1.4. No detector
   * reads it since v3.4 (the star-jump detector was replaced by the
   * pedestal press, which needs wrists, not ankles); kept as tracker
   * output for the debug HUD. 0 when no body.
   */
  ankleSpreadTorsoFrac?: number;
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
    minCutoff: BODY.wristOneEuroMinCutoff,
    beta: BODY.wristOneEuroBeta,
    dCutoff: BODY.wristOneEuroDCutoff,
  });
  private readonly rightWristFilter = new OneEuroFilter2D({
    minCutoff: BODY.wristOneEuroMinCutoff,
    beta: BODY.wristOneEuroBeta,
    dCutoff: BODY.wristOneEuroDCutoff,
  });
  /** Shoulder-width ratio smoothing (standard BODY params, not wrist). */
  private readonly shoulderWidthFilter = new OneEuroFilter({
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
  /**
   * Handedness latch (v3): the previous frame's LATCHED wrist positions
   * (raw video space, before smoothing). Each new frame assigns the two
   * detected wrist landmarks to left/right by nearest neighbour to
   * these, not by the model's labels — see `latchWrists()`.
   */
  private prevLatchedLeftWrist: { x: number; y: number } | null = null;
  private prevLatchedRightWrist: { x: number; y: number } | null = null;
  /** Latched left currently comes from the model's RIGHT_WRIST label. */
  private wristLatchSwapped = false;
  /**
   * Timestamp (ms) the alternative wrist assignment started winning
   * continuously, or null when the current mapping is winning. The
   * re-latch streak — see `latchWrists()`.
   */
  private swapStreakSinceMs: number | null = null;

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
    this.shoulderWidthFilter.reset();
    this.prevLeftWristY = null;
    this.prevRightWristY = null;
    this.prevWristTSeconds = null;
    this.leftWristVelY = 0;
    this.rightWristVelY = 0;
    // A vanished body unseeds the latch: a reappearing body is trusted
    // on its labels for one frame, then latched from there.
    this.prevLatchedLeftWrist = null;
    this.prevLatchedRightWrist = null;
    this.wristLatchSwapped = false;
    this.swapStreakSinceMs = null;
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
   * Handedness latch (v3): assign the two detected wrist landmarks to
   * the tracker's left/right identities by continuity, not by the
   * model's labels.
   *
   * The problem: when the hands meet overhead or cross, MediaPipe's
   * left/right wrist labels can swap, and following the labels would
   * flip the avatar horizontally mid-swing ("which hand is which").
   * The fix: keep the previous frame's latched wrist positions and
   * pick the assignment (labels as-is, or swapped) whose wrists land
   * closest to them. A label swap moves each wrist by the inter-wrist
   * distance while the physical hands barely moved, so the swapped
   * assignment wins and the avatar's hands stay put.
   *
   * The latched mapping is sticky — it flips only when the alternative
   * is clearly better, so one noisy frame cannot flip the avatar:
   * - Overwhelming: the alternative beats the current mapping by more
   *   than `BODY.wristLatchOverwhelmTorsoFrac` in one frame — flip at
   *   once. This is the common case: wrists apart, labels plainly
   *   swapped, or a genuine side-switch after the person turned.
   * - Sustained: the alternative beats the current mapping by at least
   *   `BODY.wristLatchMarginTorsoFrac`, continuously, for
   *   `BODY.wristLatchRelatchMs` — flip then. This is the close-hands
   *   case: the evidence per frame is small (the wrists are nearly
   *   coincident, so either assignment looks the same), and the avatar
   *   shows the swapped hands for at most the relatch window while the
   *   streak runs — a tiny visual error, since the hands are together.
   *   A genuine side-switch (person actually turns around, model
   *   re-acquires with the labels the other way) re-latches this way.
   *   Anything less than the margin resets the streak.
   *
   * A slow turn needs no re-latch at all: the model's labels track the
   * physical hands continuously through it, so the current mapping
   * keeps winning every frame and the avatar's left hand follows the
   * physical left hand around.
   *
   * Returns the latched wrists (raw video space) plus whether the
   * latched left currently comes from the model's RIGHT_WRIST label.
   */
  private latchWrists(
    modelLeft: NormalizedLandmark,
    modelRight: NormalizedLandmark,
    torsoLength: number,
    timestampMs: number,
  ): {
    left: NormalizedLandmark;
    right: NormalizedLandmark;
    swapped: boolean;
  } {
    const prevLeft = this.prevLatchedLeftWrist;
    const prevRight = this.prevLatchedRightWrist;
    if (prevLeft === null || prevRight === null) {
      // First frame with a body: trust the labels, seed the latch.
      this.prevLatchedLeftWrist = { x: modelLeft.x, y: modelLeft.y };
      this.prevLatchedRightWrist = { x: modelRight.x, y: modelRight.y };
      this.wristLatchSwapped = false;
      this.swapStreakSinceMs = null;
      return { left: modelLeft, right: modelRight, swapped: false };
    }
    const dist = (
      a: NormalizedLandmark,
      b: { x: number; y: number },
    ): number => Math.hypot(a.x - b.x, a.y - b.y) / torsoLength;
    // Cost of the current mapping vs the alternative, in torso lengths.
    const keepLeft = this.wristLatchSwapped ? modelRight : modelLeft;
    const keepRight = this.wristLatchSwapped ? modelLeft : modelRight;
    const costKeep = dist(keepLeft, prevLeft) + dist(keepRight, prevRight);
    const costFlip = dist(keepRight, prevLeft) + dist(keepLeft, prevRight);
    const flipAdvantage = costKeep - costFlip;
    if (flipAdvantage > BODY.wristLatchOverwhelmTorsoFrac) {
      // Overwhelming evidence: flip at once.
      this.wristLatchSwapped = !this.wristLatchSwapped;
      this.swapStreakSinceMs = null;
    } else if (flipAdvantage > BODY.wristLatchMarginTorsoFrac) {
      // Alternative winning, but not overwhelmingly: start/continue
      // the streak; flip only once it has held for the relatch window.
      if (this.swapStreakSinceMs === null) {
        this.swapStreakSinceMs = timestampMs;
      } else if (
        timestampMs - this.swapStreakSinceMs >=
        BODY.wristLatchRelatchMs
      ) {
        this.wristLatchSwapped = !this.wristLatchSwapped;
        this.swapStreakSinceMs = null;
      }
    } else {
      // Current mapping winning (or tied): clear the streak.
      this.swapStreakSinceMs = null;
    }
    const left = this.wristLatchSwapped ? modelRight : modelLeft;
    const right = this.wristLatchSwapped ? modelLeft : modelRight;
    // Reference advance: while a streak is running, the reference stays
    // frozen at the last trusted positions. If it advanced every frame,
    // the first swapped frame would move it onto the swapped labels and
    // the current mapping would look perfect from then on — the streak
    // could never mature and no re-latch could ever fire. The reference
    // advances on the flip frame and on every frame the current mapping
    // is winning (including the frame a streak clears).
    if (this.swapStreakSinceMs === null) {
      this.prevLatchedLeftWrist = { x: left.x, y: left.y };
      this.prevLatchedRightWrist = { x: right.x, y: right.y };
    }
    return { left, right, swapped: this.wristLatchSwapped };
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
        shoulderMidX: 0.5,
        leftWristX: 0.5,
        rightWristX: 0.5,
        leftWristY: 0.5,
        rightWristY: 0.5,
        leftWristVelY: 0,
        rightWristVelY: 0,
        torsoX: 0.5,
        torsoY: 0.5,
        torsoLength: 0,
        shoulderWidthTorsoFrac: 0,
        ankleSpreadTorsoFrac: 0,
        noseOffsetTorsoFrac: null,
        wristLatchSwapped: false,
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
    const nose = lm[PoseLandmark.NOSE];
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
        shoulderMidX: 0.5,
        leftWristX: 0.5,
        rightWristX: 0.5,
        leftWristY: 0.5,
        rightWristY: 0.5,
        leftWristVelY: 0,
        rightWristVelY: 0,
        torsoX: 0.5,
        torsoY: 0.5,
        torsoLength: 0,
        shoulderWidthTorsoFrac: 0,
        ankleSpreadTorsoFrac: 0,
        noseOffsetTorsoFrac: null,
        wristLatchSwapped: false,
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
    const ankleSpreadTorsoFrac = landmarkDistance(la, ra) / torsoLength;
    // Nose offset from the shoulder midpoint (facing second signal):
    // null when the nose is not confidently visible, so callers fall
    // back to the shoulder-width ratio alone.
    const noseOffsetTorsoFrac =
      nose !== undefined && (nose.visibility ?? 0) >= GATE.minVisibility
        ? Math.abs(nose.x - shoulderMid.x) / torsoLength
        : null;
    const visibilityScore =
      ((ls.visibility ?? 0) +
        (rs.visibility ?? 0) +
        (lh.visibility ?? 0) +
        (rh.visibility ?? 0)) /
      4;

    const tSeconds = timestampMs / 1000;
    const torso = this.torsoFilter.filter(hipMid.x, hipMid.y, tSeconds);
    const shoulderY = this.shoulderYFilter.filter(shoulderMid.y, tSeconds);
    // Shoulder-width ratio: raw shoulder distance over torso length,
    // One-Euro-smoothed. The filter's first sample passes through raw,
    // so a fresh body reads its true ratio immediately.
    const shoulderWidthTorsoFrac = this.shoulderWidthFilter.filter(
      landmarkDistance(ls, rs) / torsoLength,
      tSeconds,
    );

    // Wrist positions: latched FIRST (continuity, not model labels —
    // see latchWrists), then smoothed. The filters track the physical
    // hands, so a label swap cannot jump them across the body.
    const latched = this.latchWrists(lw, rw, torsoLength, timestampMs);
    const leftWristSm = this.leftWristFilter.filter(
      latched.left.x,
      latched.left.y,
      tSeconds,
    );
    const rightWristSm = this.rightWristFilter.filter(
      latched.right.x,
      latched.right.y,
      tSeconds,
    );
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
      'left', ls, latched.left, torsoLength, tSeconds, this.leftAngleFilter,
    );
    const rightArm = this.deriveArm(
      'right', rs, latched.right, torsoLength, tSeconds, this.rightAngleFilter,
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

    // Each of the four torso landmarks must be individually confident —
    // a mean can hide one shoulder/hip the model barely sees. Knees
    // are NOT gated (v3.7): `kneesVisible` stays as data below, but
    // a body whose knees leave the frame mid-reach is still usable.
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
      landmarkVisibility.rightHip >= GATE.minVisibility;

    return {
      present: true,
      inFrame,
      bodyUsable,
      landmarkVisibility,
      kneesVisible,
      shoulderY,
      shoulderMidX: shoulderMid.x,
      leftWristX: leftWristSm.x,
      rightWristX: rightWristSm.x,
      leftWristY: leftWristSm.y,
      rightWristY: rightWristSm.y,
      leftWristVelY: this.leftWristVelY,
      rightWristVelY: this.rightWristVelY,
      torsoX: torso.x,
      torsoY: torso.y,
      torsoLength,
      shoulderWidthTorsoFrac,
      ankleSpreadTorsoFrac,
      noseOffsetTorsoFrac,
      wristLatchSwapped: latched.swapped,
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
