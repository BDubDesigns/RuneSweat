/**
 * Synthetic pose builder for tests.
 *
 * Builds a complete 33-landmark pose from a few human parameters (torso
 * position, per-arm angle from straight up, bent vs straight). The geometry
 * mirrors `src/sim/mouseSource.ts` so tests, the simulator and the replay
 * fixture all agree about what a pose looks like.
 *
 * Test-only: imported by `*.test.ts` files, never by game code.
 */

import { SIM } from './config';
import {
  PoseLandmark,
  type NormalizedLandmark,
  type RawPoseFrame,
} from '../tracking/poseTypes';

export interface SyntheticPoseOptions {
  torsoX?: number;
  hipY?: number;
  /** Left arm direction, degrees from straight up (+ = video-right). */
  leftArmDeg?: number;
  /** Right arm direction, degrees from straight up. */
  rightArmDeg?: number;
  /** Left arm bent at the elbow (wrist folds inward) instead of straight. */
  leftArmBent?: boolean;
  rightArmBent?: boolean;
  /** Hip rise (jump) or drop (duck), in normalized units. */
  hipDY?: number;
  /** Knee bend for duck detection: 0 = straight legs, 1 = deep squat. */
  kneeBend?: number;
  visibility?: number;
}

function lm(x: number, y: number, visibility: number): NormalizedLandmark {
  return { x, y, visibility };
}

/** Build a 33-landmark pose. All angles in degrees, same convention as BodyState. */
export function makePose(options: SyntheticPoseOptions = {}): NormalizedLandmark[] {
  const torsoX = options.torsoX ?? 0.5;
  const hipY = (options.hipY ?? SIM.standingHipY) + (options.hipDY ?? 0);
  const visibility = options.visibility ?? 0.99;
  const shoulderY = hipY - SIM.torsoLength;
  const halfShoulder = SIM.shoulderWidth / 2;
  const hipHalf = halfShoulder * 0.8;
  const kneeBend = options.kneeBend ?? 0;

  const arm = (
    side: 'left' | 'right',
    angleDeg: number,
    bent: boolean,
  ): { elbow: NormalizedLandmark; wrist: NormalizedLandmark } => {
    const sx = torsoX + (side === 'left' ? -halfShoulder : halfShoulder);
    const rad = (angleDeg * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    const elbow = lm(sx + dx * SIM.armLength * 0.55, shoulderY + dy * SIM.armLength * 0.55, visibility);
    // A bent arm folds the forearm ~115° toward the body's midline, so the
    // wrist ends up well short of full extension (below the fire threshold).
    const bendRad = bent ? (side === 'left' ? 2.0 : -2.0) : 0;
    const wdx = Math.sin(rad + bendRad);
    const wdy = -Math.cos(rad + bendRad);
    const wrist = lm(
      elbow.x + wdx * SIM.armLength * 0.45,
      elbow.y + wdy * SIM.armLength * 0.45,
      visibility,
    );
    return { elbow, wrist };
  };

  const left = arm('left', options.leftArmDeg ?? 170, options.leftArmBent ?? false);
  const right = arm('right', options.rightArmDeg ?? 170, options.rightArmBent ?? false);
  // Default arm angle 170° ≈ hanging down at the side (180 would be straight down).

  const kneeY = hipY + SIM.legLength * 0.5;
  const ankleY = hipY + SIM.legLength;
  const kneeOut = kneeBend * 0.08;

  const landmarks: NormalizedLandmark[] = new Array<NormalizedLandmark>(33);
  const nose = lm(torsoX, shoulderY - 0.09, visibility);
  landmarks[PoseLandmark.NOSE] = nose;
  landmarks[PoseLandmark.LEFT_EYE_INNER] = lm(torsoX - 0.015, nose.y - 0.01, visibility);
  landmarks[PoseLandmark.LEFT_EYE] = lm(torsoX - 0.03, nose.y - 0.01, visibility);
  landmarks[PoseLandmark.LEFT_EYE_OUTER] = lm(torsoX - 0.045, nose.y - 0.01, visibility);
  landmarks[PoseLandmark.RIGHT_EYE_INNER] = lm(torsoX + 0.015, nose.y - 0.01, visibility);
  landmarks[PoseLandmark.RIGHT_EYE] = lm(torsoX + 0.03, nose.y - 0.01, visibility);
  landmarks[PoseLandmark.RIGHT_EYE_OUTER] = lm(torsoX + 0.045, nose.y - 0.01, visibility);
  landmarks[PoseLandmark.LEFT_EAR] = lm(torsoX - 0.06, nose.y, visibility);
  landmarks[PoseLandmark.RIGHT_EAR] = lm(torsoX + 0.06, nose.y, visibility);
  landmarks[PoseLandmark.MOUTH_LEFT] = lm(torsoX - 0.02, nose.y + 0.03, visibility);
  landmarks[PoseLandmark.MOUTH_RIGHT] = lm(torsoX + 0.02, nose.y + 0.03, visibility);
  landmarks[PoseLandmark.LEFT_SHOULDER] = lm(torsoX - halfShoulder, shoulderY, visibility);
  landmarks[PoseLandmark.RIGHT_SHOULDER] = lm(torsoX + halfShoulder, shoulderY, visibility);
  landmarks[PoseLandmark.LEFT_ELBOW] = left.elbow;
  landmarks[PoseLandmark.RIGHT_ELBOW] = right.elbow;
  landmarks[PoseLandmark.LEFT_WRIST] = left.wrist;
  landmarks[PoseLandmark.RIGHT_WRIST] = right.wrist;
  landmarks[PoseLandmark.LEFT_PINKY] = lm(left.wrist.x - 0.01, left.wrist.y + 0.02, visibility);
  landmarks[PoseLandmark.RIGHT_PINKY] = lm(right.wrist.x + 0.01, right.wrist.y + 0.02, visibility);
  landmarks[PoseLandmark.LEFT_INDEX] = lm(left.wrist.x - 0.005, left.wrist.y + 0.025, visibility);
  landmarks[PoseLandmark.RIGHT_INDEX] = lm(right.wrist.x + 0.005, right.wrist.y + 0.025, visibility);
  landmarks[PoseLandmark.LEFT_THUMB] = lm(left.wrist.x + 0.01, left.wrist.y + 0.01, visibility);
  landmarks[PoseLandmark.RIGHT_THUMB] = lm(right.wrist.x - 0.01, right.wrist.y + 0.01, visibility);
  landmarks[PoseLandmark.LEFT_HIP] = lm(torsoX - hipHalf, hipY, visibility);
  landmarks[PoseLandmark.RIGHT_HIP] = lm(torsoX + hipHalf, hipY, visibility);
  landmarks[PoseLandmark.LEFT_KNEE] = lm(torsoX - hipHalf - kneeOut, kneeY, visibility);
  landmarks[PoseLandmark.RIGHT_KNEE] = lm(torsoX + hipHalf + kneeOut, kneeY, visibility);
  landmarks[PoseLandmark.LEFT_ANKLE] = lm(torsoX - hipHalf, ankleY, visibility);
  landmarks[PoseLandmark.RIGHT_ANKLE] = lm(torsoX + hipHalf, ankleY, visibility);
  landmarks[PoseLandmark.LEFT_HEEL] = lm(torsoX - hipHalf - 0.01, ankleY, visibility);
  landmarks[PoseLandmark.RIGHT_HEEL] = lm(torsoX + hipHalf + 0.01, ankleY, visibility);
  landmarks[PoseLandmark.LEFT_FOOT_INDEX] = lm(torsoX - hipHalf + 0.02, ankleY + 0.01, visibility);
  landmarks[PoseLandmark.RIGHT_FOOT_INDEX] = lm(torsoX + hipHalf - 0.02, ankleY + 0.01, visibility);
  return landmarks;
}

/** Wrap landmarks in a RawPoseFrame at `timestampMs`. */
export function makeFrame(
  landmarks: NormalizedLandmark[] | null,
  timestampMs: number,
): RawPoseFrame {
  return {
    timestampMs,
    landmarks,
    sourceId: 'test',
    provenance: 'simulated',
  };
}
