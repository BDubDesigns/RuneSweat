/**
 * Test-only builders for YouVille. Never imported by game code.
 *
 * `makeBody` builds a BodyState directly (exact values, no filters)
 * for recognizer unit tests. `PoseDriver` drives the REAL
 * BodyStateTracker with synthetic 33-landmark poses for end-to-end
 * tests, so the integration tests exercise the same smoothing and
 * handedness latch the camera path uses.
 */
import { BodyStateTracker, type ArmState, type BodyState } from '../core/bodyState';
import { makePose } from '../core/poseFixture';
import { TRAVOLTA } from './config';
import type { PoseInput } from './session';

const TORSO = 0.3;
const SHOULDER_Y = 0.3;
const SHOULDER_MID_X = 0.5;

export interface Offset {
  x: number;
  y: number;
}

export interface BodyOptions {
  torsoX?: number;
  /** Arm angles in degrees from straight up (BodyState convention). */
  leftAngle?: number;
  rightAngle?: number;
  /** Wrist positions as torso-length offsets from the shoulder midpoint. */
  leftWrist?: Offset;
  rightWrist?: Offset;
  extended?: boolean;
  usable?: boolean;
  present?: boolean;
  timestampMs?: number;
}

function arm(side: 'left' | 'right', angleDeg: number, extended: boolean): ArmState {
  return {
    side,
    raised: Math.abs(angleDeg) < 90,
    extended,
    angleDeg,
    angleDegRaw: angleDeg,
    lengthTorsoFrac: extended ? 1.07 : 0.4,
  };
}

/** Resting wrists hang beside the hips. */
export const REST_LEFT: Offset = { x: -0.37, y: 1.0 };
export const REST_RIGHT: Offset = { x: 0.37, y: 1.0 };

export function makeBody(o: BodyOptions = {}): BodyState {
  const lw = o.leftWrist ?? REST_LEFT;
  const rw = o.rightWrist ?? REST_RIGHT;
  const extended = o.extended ?? true;
  const usable = o.usable ?? true;
  return {
    present: o.present ?? true,
    inFrame: usable,
    bodyUsable: usable,
    landmarkVisibility: {
      leftShoulder: 0.99,
      rightShoulder: 0.99,
      leftHip: 0.99,
      rightHip: 0.99,
      leftKnee: 0.99,
      rightKnee: 0.99,
    },
    kneesVisible: true,
    shoulderY: SHOULDER_Y,
    shoulderMidX: SHOULDER_MID_X,
    leftWristX: SHOULDER_MID_X + lw.x * TORSO,
    rightWristX: SHOULDER_MID_X + rw.x * TORSO,
    leftWristY: SHOULDER_Y + lw.y * TORSO,
    rightWristY: SHOULDER_Y + rw.y * TORSO,
    leftWristVelY: 0,
    rightWristVelY: 0,
    torsoX: o.torsoX ?? 0.5,
    torsoY: SHOULDER_Y + TORSO,
    torsoLength: TORSO,
    shoulderWidthTorsoFrac: 0.8,
    noseOffsetTorsoFrac: 0,
    wristLatchSwapped: false,
    visibilityScore: 0.99,
    leftArm: arm('left', o.leftAngle ?? 170, extended),
    rightArm: arm('right', o.rightAngle ?? -170, extended),
    jumping: false,
    ducking: false,
    hipBaselineY: SHOULDER_Y + TORSO,
    timestampMs: o.timestampMs ?? 0,
  };
}

/** Arms straight out to the sides (a T). */
export function tPose(): BodyOptions {
  return { leftAngle: 90, rightAngle: -90 };
}

/** Arms hanging beside the body. */
export function armsDown(): BodyOptions {
  return { leftAngle: 170, rightAngle: -170 };
}

/** Travolta zones for the LEFT hand (own side = -x in makeBody's convention). */
export const TRAVOLTA_UP_LEFT: Offset = { x: -1.05, y: -0.82 };
export const TRAVOLTA_LOW_LEFT: Offset = { x: 0.25, y: 0.9 };

/** A configured threshold sanity helper so tests fail loudly if zones drift. */
export function travoltaZonesAreReachable(): boolean {
  return (
    TRAVOLTA_UP_LEFT.y <= TRAVOLTA.upMaxY &&
    Math.abs(TRAVOLTA_UP_LEFT.x) >= TRAVOLTA.upMinAbsX &&
    TRAVOLTA_LOW_LEFT.y >= TRAVOLTA.lowMinY &&
    Math.abs(TRAVOLTA_LOW_LEFT.x) >= TRAVOLTA.lowMinAbsX
  );
}

/**
 * Drives the real BodyStateTracker with synthetic landmarks and
 * reports the PoseInput the session expects.
 */
export class PoseDriver {
  private readonly tracker = new BodyStateTracker();
  public latest: BodyState | null = null;
  public receivedAtMs: number | null = null;

  public feed(
    nowMs: number,
    options: Parameters<typeof makePose>[0],
  ): void {
    this.latest = this.tracker.update({
      timestampMs: nowMs,
      landmarks: makePose(options),
      sourceId: 'test',
      provenance: 'simulated',
    });
    this.receivedAtMs = nowMs;
  }

  /** Report no person in frame. */
  public feedNone(nowMs: number): void {
    this.latest = this.tracker.update({
      timestampMs: nowMs,
      landmarks: null,
      sourceId: 'test',
      provenance: 'simulated',
    });
    this.receivedAtMs = nowMs;
  }

  public pose(): PoseInput {
    return { body: this.latest, receivedAtMs: this.receivedAtMs };
  }
}
