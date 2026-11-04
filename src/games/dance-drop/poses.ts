/**
 * Dance Pose Drop pose definitions.
 *
 * Each pose is a full 33-landmark template in normalized video space,
 * built procedurally from a standing base pose by `buildPoseTemplate()`.
 * The target angles a pose is scored on come from `jointAngles()` run
 * over its own template — never hand-written numbers — so the drawing
 * and the scoring can never disagree.
 *
 * Torso geometry: the shoulders sit directly above the hips (same x),
 * so the scored joint angles come out exact: arms straight up read 180
 * at the shoulder, horizontal arms read 90, straight legs read 180 at
 * the hip. That keeps the numbers below auditable by hand.
 *
 * HOW THE TARGETS STAY DISTINGUISHABLE
 * --------------------------------------
 * `poseMatchScore()` averages over the joints the target specifies, so a
 * target must list ONLY the joints that define the pose. Every joint a
 * target lists that two poses share pulls their cross-score toward 1.0.
 * That is why the targets are restricted (per the core-testing
 * correction) instead of using all eight joints:
 *
 * - Arms Up / T-pose / One Arm Up: shoulders + ONE hip (leftHip).
 * - Hands on Hips: shoulders + elbows.
 * - Star Jump: shoulders + BOTH hips.
 *
 * Two deliberate deviations from the correction, both forced by the
 * arithmetic — see `danceDrop.test.ts`, which asserts the full 20-pair
 * cross-score matrix stays below `DANCE.matchThreshold`:
 *
 * 1. The star target drops the knees. Knees are straight (180) in every
 *    pose, including the star's, so they carry no signal: with knees in
 *    the star target, a plain Arms Up scores ~0.81 against it.
 * 2. The straight-arm poses score one hip in addition to the shoulders.
 *    Shoulders-only lets a star jump false-match both Arms Up and
 *    T-pose: the star's shoulders (135) sit midway between straight up
 *    (180) and horizontal (90), so it scores ~0.75 against either
 *    shoulders-only target, and no star arm angle can fix that — it is
 *    sandwiched in shoulder space. The hip catches the star's spread
 *    legs (hip 105 vs 180 straight). Only ONE hip is scored: the poses
 *    are left-right symmetric, so one hip carries the same information
 *    as two, and scoring both would dilute Arms Up vs T-pose to ~0.78
 *    (shared straight legs) — above the threshold.
 *
 * Hands on Hips geometry also differs from the first sketch (upper arms
 * ~140 down-out, elbows ~90): that puts its shoulders only ~50 from
 * T-pose's 90, which fails once T-pose's target carries a hip. Real
 * hands-on-hips hangs the upper arms at your sides with the elbows
 * bent and the hands on the hips, so the template does that instead:
 * upper arms 172 from straight up, elbows 142, wrists landing on the
 * hips by construction. Shoulders read 8, far from every other pose.
 */

import { jointAngles, type PoseJoint, type PoseTarget } from '../../core/bodyState';
import { clamp } from '../../render/stage';
import {
  PoseLandmark,
  POSE_LANDMARK_COUNT,
  type NormalizedLandmark,
} from '../../tracking/poseTypes';

/** One arm: direction from straight up + elbow bend. */
export interface ArmSpec {
  /**
   * Direction of the upper arm from straight up, in degrees. Same
   * convention as `BodyState`: 0 = straight up, positive = video-right.
   * 180 = hanging straight down.
   */
  angleDeg: number;
  /** Elbow joint angle, in degrees. 180 = straight arm. */
  elbowDeg: number;
}

/** One leg: how far it spreads from straight down, in degrees. */
export interface LegSpec {
  /**
   * Spread from straight down, in degrees. Positive = video-right, so
   * the left leg spreads negative (out to video-left) and the right leg
   * spreads positive. 0 = standing straight.
   */
  spreadDeg: number;
}

/** Everything needed to build one dance pose (before its template). */
export interface DancePoseDefinition {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  readonly leftArm: ArmSpec;
  readonly rightArm: ArmSpec;
  readonly leftLeg: LegSpec;
  readonly rightLeg: LegSpec;
  /** Joints this pose is scored on — see the header note. */
  readonly scoredJoints: readonly PoseJoint[];
}

/** A built dance pose: template + the angles it is scored against. */
export interface DancePose {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  readonly template: readonly NormalizedLandmark[];
  readonly targetAngles: PoseTarget;
}

/** Standing base pose, normalized video space (torso centred x = 0.5). */
const SHOULDER_Y = 0.3;
const HIP_Y = 0.55;
/** Shoulders directly above hips: half-width 0.10 on both. */
const HALF_WIDTH = 0.1;
/** Segment lengths, normalized units (torso is 0.25). */
const UPPER_ARM = 0.16;
const FOREARM = 0.14;
const THIGH = 0.2;
const SHIN = 0.17;

interface Vec {
  x: number;
  y: number;
}

function point(x: number, y: number): NormalizedLandmark {
  return { x, y, z: 0, visibility: 1 };
}

/**
 * Unit direction for an angle from straight up, in degrees.
 * 0 = straight up, positive = video-right (y grows downward).
 */
function dirFromUp(angleDeg: number): Vec {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad) };
}

/** Unit direction for a leg spread from straight down, in degrees. */
function dirFromDown(spreadDeg: number): Vec {
  const rad = (spreadDeg * Math.PI) / 180;
  return { x: Math.sin(rad), y: Math.cos(rad) };
}

interface PlacedArm {
  elbow: Vec;
  wrist: Vec;
  /** Forearm direction (shoulder -> wrist through the elbow). */
  forearmDir: Vec;
}

/**
 * Place an arm from its shoulder. The elbow sits one upper-arm along the
 * arm direction; the wrist continues from the elbow, folded toward the
 * body midline (x = 0.5) by `180 - elbowDeg`. A straight arm
 * (`elbowDeg` 180) has no fold, so both candidates agree.
 */
function placeArm(shoulder: Vec, spec: ArmSpec): PlacedArm {
  const upper = dirFromUp(spec.angleDeg);
  const elbow: Vec = {
    x: shoulder.x + UPPER_ARM * upper.x,
    y: shoulder.y + UPPER_ARM * upper.y,
  };
  const bend = 180 - spec.elbowDeg;
  const dirA = dirFromUp(spec.angleDeg + bend);
  const dirB = dirFromUp(spec.angleDeg - bend);
  const wristA: Vec = {
    x: elbow.x + FOREARM * dirA.x,
    y: elbow.y + FOREARM * dirA.y,
  };
  const wristB: Vec = {
    x: elbow.x + FOREARM * dirB.x,
    y: elbow.y + FOREARM * dirB.y,
  };
  const pickA = Math.abs(wristA.x - 0.5) <= Math.abs(wristB.x - 0.5);
  return {
    elbow,
    wrist: pickA ? wristA : wristB,
    forearmDir: pickA ? dirA : dirB,
  };
}

interface PlacedLeg {
  knee: Vec;
  ankle: Vec;
  heel: Vec;
  footIndex: Vec;
}

/** Place a leg from its hip: knee and ankle along the spread direction. */
function placeLeg(hip: Vec, spec: LegSpec): PlacedLeg {
  const dir = dirFromDown(spec.spreadDeg);
  const knee: Vec = {
    x: hip.x + THIGH * dir.x,
    y: hip.y + THIGH * dir.y,
  };
  const ankle: Vec = {
    x: knee.x + SHIN * dir.x,
    y: knee.y + SHIN * dir.y,
  };
  return {
    knee,
    ankle,
    heel: { x: ankle.x - dir.x * 0.02, y: ankle.y - dir.y * 0.02 },
    footIndex: { x: ankle.x + dir.x * 0.035, y: ankle.y + dir.y * 0.035 },
  };
}

/**
 * Build a full 33-landmark template for a pose definition: standing base
 * body, then arms and legs placed from the definition's angles.
 */
export function buildPoseTemplate(def: DancePoseDefinition): NormalizedLandmark[] {
  const template: NormalizedLandmark[] = Array.from(
    { length: POSE_LANDMARK_COUNT },
    () => point(0.5, 0.5),
  );

  // Face.
  template[PoseLandmark.NOSE] = point(0.5, 0.1);
  template[PoseLandmark.LEFT_EYE_INNER] = point(0.475, 0.085);
  template[PoseLandmark.LEFT_EYE] = point(0.46, 0.085);
  template[PoseLandmark.LEFT_EYE_OUTER] = point(0.445, 0.085);
  template[PoseLandmark.RIGHT_EYE_INNER] = point(0.525, 0.085);
  template[PoseLandmark.RIGHT_EYE] = point(0.54, 0.085);
  template[PoseLandmark.RIGHT_EYE_OUTER] = point(0.555, 0.085);
  template[PoseLandmark.LEFT_EAR] = point(0.435, 0.105);
  template[PoseLandmark.RIGHT_EAR] = point(0.565, 0.105);
  template[PoseLandmark.MOUTH_LEFT] = point(0.48, 0.125);
  template[PoseLandmark.MOUTH_RIGHT] = point(0.52, 0.125);

  // Torso: shoulders directly above hips.
  const leftShoulder: Vec = { x: 0.5 - HALF_WIDTH, y: SHOULDER_Y };
  const rightShoulder: Vec = { x: 0.5 + HALF_WIDTH, y: SHOULDER_Y };
  const leftHip: Vec = { x: 0.5 - HALF_WIDTH, y: HIP_Y };
  const rightHip: Vec = { x: 0.5 + HALF_WIDTH, y: HIP_Y };
  template[PoseLandmark.LEFT_SHOULDER] = point(leftShoulder.x, leftShoulder.y);
  template[PoseLandmark.RIGHT_SHOULDER] = point(rightShoulder.x, rightShoulder.y);
  template[PoseLandmark.LEFT_HIP] = point(leftHip.x, leftHip.y);
  template[PoseLandmark.RIGHT_HIP] = point(rightHip.x, rightHip.y);

  // Arms (+ fingers clustered at the wrist — unscored, just for drawing).
  for (const [side, shoulder, spec] of [
    ['left', leftShoulder, def.leftArm],
    ['right', rightShoulder, def.rightArm],
  ] as const) {
    const arm = placeArm(shoulder, spec);
    const perp: Vec = { x: -arm.forearmDir.y, y: arm.forearmDir.x };
    const isLeft = side === 'left';
    const elbowIdx = isLeft ? PoseLandmark.LEFT_ELBOW : PoseLandmark.RIGHT_ELBOW;
    const wristIdx = isLeft ? PoseLandmark.LEFT_WRIST : PoseLandmark.RIGHT_WRIST;
    const pinkyIdx = isLeft ? PoseLandmark.LEFT_PINKY : PoseLandmark.RIGHT_PINKY;
    const indexIdx = isLeft ? PoseLandmark.LEFT_INDEX : PoseLandmark.RIGHT_INDEX;
    const thumbIdx = isLeft ? PoseLandmark.LEFT_THUMB : PoseLandmark.RIGHT_THUMB;
    template[elbowIdx] = point(arm.elbow.x, arm.elbow.y);
    template[wristIdx] = point(arm.wrist.x, arm.wrist.y);
    template[indexIdx] = point(
      arm.wrist.x + arm.forearmDir.x * 0.03,
      arm.wrist.y + arm.forearmDir.y * 0.03,
    );
    template[pinkyIdx] = point(
      arm.wrist.x + arm.forearmDir.x * 0.02 + perp.x * 0.012,
      arm.wrist.y + arm.forearmDir.y * 0.02 + perp.y * 0.012,
    );
    template[thumbIdx] = point(
      arm.wrist.x - perp.x * 0.015,
      arm.wrist.y - perp.y * 0.015,
    );
  }

  // Legs.
  for (const [side, hip, spec] of [
    ['left', leftHip, def.leftLeg],
    ['right', rightHip, def.rightLeg],
  ] as const) {
    const leg = placeLeg(hip, spec);
    const isLeft = side === 'left';
    const kneeIdx = isLeft ? PoseLandmark.LEFT_KNEE : PoseLandmark.RIGHT_KNEE;
    const ankleIdx = isLeft ? PoseLandmark.LEFT_ANKLE : PoseLandmark.RIGHT_ANKLE;
    const heelIdx = isLeft ? PoseLandmark.LEFT_HEEL : PoseLandmark.RIGHT_HEEL;
    const footIdx = isLeft ? PoseLandmark.LEFT_FOOT_INDEX : PoseLandmark.RIGHT_FOOT_INDEX;
    template[kneeIdx] = point(leg.knee.x, leg.knee.y);
    template[ankleIdx] = point(leg.ankle.x, leg.ankle.y);
    template[heelIdx] = point(leg.heel.x, leg.heel.y);
    template[footIdx] = point(leg.footIndex.x, leg.footIndex.y);
  }

  // Keep every landmark inside normalized space: straight-up arms put the
  // wrist at y = 0 and the fingertips just past it, which floating point
  // rounds to a hair below zero. The clamp moves them by < 0.03 and does
  // not change any scored joint angle.
  for (const lm of template) {
    lm.x = clamp(lm.x, 0, 1);
    lm.y = clamp(lm.y, 0, 1);
  }

  return template;
}

/**
 * The target angles for a pose definition: `jointAngles()` over its own
 * template, restricted to the definition's scored joints.
 */
export function targetAnglesFor(def: DancePoseDefinition): PoseTarget {
  const all = jointAngles(buildPoseTemplate(def));
  const target: PoseTarget = {};
  for (const joint of def.scoredJoints) {
    target[joint] = all[joint];
  }
  return target;
}

/** Build a playable pose (template + target angles) from a definition. */
export function buildDancePose(def: DancePoseDefinition): DancePose {
  return {
    id: def.id,
    name: def.name,
    emoji: def.emoji,
    template: buildPoseTemplate(def),
    targetAngles: targetAnglesFor(def),
  };
}

const ARMS_UP: DancePoseDefinition = {
  id: 'arms-up',
  name: 'Arms Up',
  emoji: '🙌',
  leftArm: { angleDeg: 0, elbowDeg: 180 },
  rightArm: { angleDeg: 0, elbowDeg: 180 },
  leftLeg: { spreadDeg: 0 },
  rightLeg: { spreadDeg: 0 },
  scoredJoints: ['leftShoulder', 'rightShoulder', 'leftHip'],
};

const T_POSE: DancePoseDefinition = {
  id: 't-pose',
  name: 'T-pose',
  emoji: '✈️',
  leftArm: { angleDeg: -90, elbowDeg: 180 },
  rightArm: { angleDeg: 90, elbowDeg: 180 },
  leftLeg: { spreadDeg: 0 },
  rightLeg: { spreadDeg: 0 },
  scoredJoints: ['leftShoulder', 'rightShoulder', 'leftHip'],
};

const HANDS_ON_HIPS: DancePoseDefinition = {
  id: 'hands-on-hips',
  name: 'Hands on Hips',
  emoji: '💪',
  // Upper arms hang at the sides (172 from straight up, mirrored), elbows
  // bent so the wrists land on the hips. Shoulders read 8, elbows 142.
  leftArm: { angleDeg: -172, elbowDeg: 142 },
  rightArm: { angleDeg: 172, elbowDeg: 142 },
  leftLeg: { spreadDeg: 0 },
  rightLeg: { spreadDeg: 0 },
  scoredJoints: ['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow'],
};

const ONE_ARM_UP: DancePoseDefinition = {
  id: 'one-arm-up',
  name: 'One Arm Up',
  emoji: '☝️',
  leftArm: { angleDeg: 180, elbowDeg: 180 },
  rightArm: { angleDeg: 0, elbowDeg: 180 },
  leftLeg: { spreadDeg: 0 },
  rightLeg: { spreadDeg: 0 },
  scoredJoints: ['leftShoulder', 'rightShoulder', 'leftHip'],
};

const STAR_JUMP: DancePoseDefinition = {
  id: 'star-jump',
  name: 'Star Jump',
  emoji: '⭐',
  leftArm: { angleDeg: -45, elbowDeg: 180 },
  rightArm: { angleDeg: 45, elbowDeg: 180 },
  leftLeg: { spreadDeg: -75 },
  rightLeg: { spreadDeg: 75 },
  // Shoulders + both hips. Knees deliberately NOT scored: they are
  // straight in every pose, so they would only dilute the leg signal.
  scoredJoints: ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'],
};

/** The five pose definitions, in play order (for tests and tooling). */
export const POSE_DEFINITIONS: readonly [
  DancePoseDefinition,
  DancePoseDefinition,
  DancePoseDefinition,
  DancePoseDefinition,
  DancePoseDefinition,
] = [ARMS_UP, T_POSE, HANDS_ON_HIPS, ONE_ARM_UP, STAR_JUMP];

/** All five dance poses, in definition order. */
export const POSES: readonly [
  DancePose,
  DancePose,
  DancePose,
  DancePose,
  DancePose,
] = [
  buildDancePose(POSE_DEFINITIONS[0]),
  buildDancePose(POSE_DEFINITIONS[1]),
  buildDancePose(POSE_DEFINITIONS[2]),
  buildDancePose(POSE_DEFINITIONS[3]),
  buildDancePose(POSE_DEFINITIONS[4]),
];

/**
 * Pick the next round's pose at random, never repeating the pose that
 * just played. `random` is injectable so tests can drive the pick.
 */
export function pickNextPose(
  previous: DancePose | null,
  random: () => number = Math.random,
): DancePose {
  const candidates = POSES.filter((pose) => pose.id !== previous?.id);
  const index = Math.floor(random() * candidates.length);
  const picked = candidates[index % candidates.length];
  // Unreachable: POSES has five entries and at most one is excluded, so
  // `index` is always in range. The fallback keeps the type checker
  // honest (noUncheckedIndexedAccess).
  return picked ?? POSES[0];
}
