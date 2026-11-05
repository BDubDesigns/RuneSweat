/**
 * Avatar renderer — a real character, not a stickman.
 *
 * The hub draws one `AvatarRenderer` for every game whenever landmarks
 * exist. It reads RAW landmarks (the same ones the game render already
 * receives) and smooths the joints itself with per-joint One Euro
 * filters — `BodyState` deliberately has no per-joint fields, so the
 * avatar owns its own smoothing state and never touches `bodyState.ts`.
 *
 * Look (chunky, charming, RuneSpace-ish, readable at phone size): thick
 * capsule limbs, torso in the outfit's top, hips/upper legs in the
 * outfit's bottoms, a simple friendly face, and the outfit's hat. All
 * canvas vector shapes — no external art assets, nothing new to fetch.
 *
 * Draw order: far arm, far leg, torso (top), bottoms, near leg, near
 * arm, head + hat. No body (landmarks null or incomplete): draws nothing.
 *
 * Canvas drawing itself is untestable in Node — the pure geometry
 * helpers below (`avatarJoints`, `limbWidthPx`, `headRadiusPx`,
 * `resolveOutfit`) carry the unit tests; the `draw()` path is verified
 * by typecheck + build + a real-device playtest.
 */

import { AVATAR, OUTFIT, type AvatarOutfit } from '../core/config';
import { OneEuroFilter2D } from '../core/oneEuro';
import {
  PoseLandmark,
  type NormalizedLandmark,
  type PoseLandmarkIndex,
} from '../tracking/poseTypes';
import { toCanvas, type Vec2 } from './stage';

/** Canvas-space joint positions for one pose, plus the body scale unit. */
export interface AvatarJoints {
  nose: Vec2;
  leftEar: Vec2;
  rightEar: Vec2;
  leftShoulder: Vec2;
  rightShoulder: Vec2;
  leftElbow: Vec2;
  rightElbow: Vec2;
  leftWrist: Vec2;
  rightWrist: Vec2;
  leftHip: Vec2;
  rightHip: Vec2;
  leftKnee: Vec2;
  rightKnee: Vec2;
  leftAnkle: Vec2;
  rightAnkle: Vec2;
  /** Shoulder-mid to hip-mid distance, canvas px — the body's scale unit. */
  torsoLengthPx: number;
  /** Shoulder-to-shoulder distance, canvas px. */
  shoulderWidthPx: number;
}

type JointName = Exclude<
  keyof AvatarJoints,
  'torsoLengthPx' | 'shoulderWidthPx'
>;

/** Landmark index behind each drawn joint. */
const JOINT_LANDMARKS: Record<JointName, PoseLandmarkIndex> = {
  nose: PoseLandmark.NOSE,
  leftEar: PoseLandmark.LEFT_EAR,
  rightEar: PoseLandmark.RIGHT_EAR,
  leftShoulder: PoseLandmark.LEFT_SHOULDER,
  rightShoulder: PoseLandmark.RIGHT_SHOULDER,
  leftElbow: PoseLandmark.LEFT_ELBOW,
  rightElbow: PoseLandmark.RIGHT_ELBOW,
  leftWrist: PoseLandmark.LEFT_WRIST,
  rightWrist: PoseLandmark.RIGHT_WRIST,
  leftHip: PoseLandmark.LEFT_HIP,
  rightHip: PoseLandmark.RIGHT_HIP,
  leftKnee: PoseLandmark.LEFT_KNEE,
  rightKnee: PoseLandmark.RIGHT_KNEE,
  leftAnkle: PoseLandmark.LEFT_ANKLE,
  rightAnkle: PoseLandmark.RIGHT_ANKLE,
};

/** Pure: map raw landmarks to canvas-space joint positions. */
export function avatarJoints(
  landmarks: readonly NormalizedLandmark[],
  width: number,
  height: number,
): AvatarJoints | null {
  const points = {} as Record<JointName, Vec2>;
  for (const name of Object.keys(JOINT_LANDMARKS) as JointName[]) {
    const lm = landmarks[JOINT_LANDMARKS[name]];
    if (lm === undefined) return null;
    points[name] = toCanvas(lm, width, height);
  }
  const shoulderMid = {
    x: (points.leftShoulder.x + points.rightShoulder.x) / 2,
    y: (points.leftShoulder.y + points.rightShoulder.y) / 2,
  };
  const hipMid = {
    x: (points.leftHip.x + points.rightHip.x) / 2,
    y: (points.leftHip.y + points.rightHip.y) / 2,
  };
  return {
    ...points,
    torsoLengthPx: Math.max(
      Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y),
      1,
    ),
    shoulderWidthPx: Math.hypot(
      points.leftShoulder.x - points.rightShoulder.x,
      points.leftShoulder.y - points.rightShoulder.y,
    ),
  };
}

/** Pure: limb capsule width for a body of this canvas torso length. */
export function limbWidthPx(torsoLengthPx: number): number {
  return AVATAR.limbWidthTorsoFrac * torsoLengthPx;
}

/** Pure: head radius for a body of this canvas torso length. */
export function headRadiusPx(torsoLengthPx: number): number {
  return AVATAR.headRadiusTorsoFrac * torsoLengthPx;
}

/** Canvas-space head circle for a pose: centre + radius. */
export interface HeadGeometry {
  cx: number;
  cy: number;
  r: number;
}

/**
 * Pure: where the head circle goes. `cx` is the ear midpoint; `cy` is
 * `headCentreAboveNeckHeadFrac` head-radii above the shoulder (neck)
 * line, so the chin (`cy + r`) overlaps the torso top and the head sits
 * ON the neck — no gap, whatever the ear-to-shoulder distance of the
 * framing. v3 centred the head on the ears, which floated the chin
 * ~25 px above the neck on the sim body.
 */
export function headGeometry(
  joints: AvatarJoints,
  headR: number,
): HeadGeometry {
  const cx = (joints.leftEar.x + joints.rightEar.x) / 2;
  const shoulderY = (joints.leftShoulder.y + joints.rightShoulder.y) / 2;
  return {
    cx,
    cy: shoulderY - headR * AVATAR.headCentreAboveNeckHeadFrac,
    r: headR,
  };
}

/**
 * Pure: resolve an outfit against the default. A partial override swaps
 * whole slots (top / bottoms / skin / hat); anything not overridden keeps
 * the default — that is how a future outfit swap works.
 */
export function resolveOutfit(
  partial?: Partial<AvatarOutfit>,
): AvatarOutfit {
  if (partial === undefined) return OUTFIT;
  return {
    top: { ...OUTFIT.top, ...partial.top },
    bottoms: { ...OUTFIT.bottoms, ...partial.bottoms },
    skin: { ...OUTFIT.skin, ...partial.skin },
    hat: { ...OUTFIT.hat, ...partial.hat },
  };
}

/** Draw a thick round-capped segment — the limb primitive. */
function capsule(
  ctx: CanvasRenderingContext2D,
  a: Vec2,
  b: Vec2,
  widthPx: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = widthPx;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** Trace a heart path centred at (`x`, `y`), `size` px tall. */
function traceHeart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const s = size;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s * 0.6, y - s * 0.25, x - s * 0.25, y - s * 0.75, x, y - s * 0.3);
  ctx.bezierCurveTo(x + s * 0.25, y - s * 0.75, x + s * 0.6, y - s * 0.25, x, y + s * 0.35);
  ctx.closePath();
}

/** The avatar renderer: per-joint smoothing state + the draw call. */
export class AvatarRenderer {
  private readonly filters = new Map<JointName, OneEuroFilter2D>();

  /** Clear smoothing state (e.g. when the body leaves the frame). */
  public reset(): void {
    this.filters.clear();
  }

  /**
   * Draw the avatar for one frame. `nowMs` is the render loop's
   * monotonic clock (ms) — the One Euro filters need real timestamps.
   * No body: draws nothing and resets the smoothing state.
   */
  public draw(
    ctx: CanvasRenderingContext2D,
    landmarks: readonly NormalizedLandmark[] | null,
    width: number,
    height: number,
    outfit: AvatarOutfit = OUTFIT,
    nowMs = 0,
  ): void {
    if (landmarks === null) {
      this.reset();
      return;
    }
    const joints = avatarJoints(landmarks, width, height);
    if (joints === null) {
      this.reset();
      return;
    }
    const tSeconds = nowMs / 1000;
    const sm = this.smooth(joints, tSeconds);
    const resolved = resolveOutfit(outfit);
    const limbW = limbWidthPx(joints.torsoLengthPx);
    const headR = headRadiusPx(joints.torsoLengthPx);

    ctx.save();
    ctx.lineJoin = 'round';
    // Far side first, near side last — the near limbs overlap the torso.
    this.drawArm(ctx, sm, 'left', limbW, resolved.skin.tone);
    this.drawLeg(ctx, sm, 'left', limbW, resolved.skin.tone);
    this.drawTorso(ctx, sm, joints, resolved);
    this.drawBottoms(ctx, sm, joints, resolved);
    this.drawLeg(ctx, sm, 'right', limbW, resolved.skin.tone);
    this.drawArm(ctx, sm, 'right', limbW, resolved.skin.tone);
    this.drawHead(ctx, sm, headR, resolved);
    ctx.restore();
  }

  /** Smooth every joint through its own One Euro filter. */
  private smooth(joints: AvatarJoints, tSeconds: number): AvatarJoints {
    const out = { ...joints };
    for (const name of Object.keys(JOINT_LANDMARKS) as JointName[]) {
      let filter = this.filters.get(name);
      if (filter === undefined) {
        filter = new OneEuroFilter2D({
          minCutoff: AVATAR.oneEuroMinCutoff,
          beta: AVATAR.oneEuroBeta,
          dCutoff: AVATAR.oneEuroDCutoff,
        });
        this.filters.set(name, filter);
      }
      const p = joints[name];
      out[name] = filter.filter(p.x, p.y, tSeconds);
    }
    return out;
  }

  private drawArm(
    ctx: CanvasRenderingContext2D,
    j: AvatarJoints,
    side: 'left' | 'right',
    limbW: number,
    skin: string,
  ): void {
    const shoulder = side === 'left' ? j.leftShoulder : j.rightShoulder;
    const elbow = side === 'left' ? j.leftElbow : j.rightElbow;
    const wrist = side === 'left' ? j.leftWrist : j.rightWrist;
    capsule(ctx, shoulder, elbow, limbW, skin);
    capsule(ctx, elbow, wrist, limbW * 0.9, skin);
    // Hand: a fist-sized dot at the wrist.
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(wrist.x, wrist.y, limbW * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawLeg(
    ctx: CanvasRenderingContext2D,
    j: AvatarJoints,
    side: 'left' | 'right',
    limbW: number,
    skin: string,
  ): void {
    const hip = side === 'left' ? j.leftHip : j.rightHip;
    const knee = side === 'left' ? j.leftKnee : j.rightKnee;
    const ankle = side === 'left' ? j.leftAnkle : j.rightAnkle;
    capsule(ctx, hip, knee, limbW * 1.05, skin);
    capsule(ctx, knee, ankle, limbW * 0.9, skin);
    // Foot: a small ellipse at the ankle, pointing away from the body.
    const outward = side === 'left' ? -1 : 1;
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(
      ankle.x + outward * limbW * 0.35,
      ankle.y + limbW * 0.15,
      limbW * 0.55,
      limbW * 0.35,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  /**
   * Torso in the outfit's top: a tapered rounded shape, wide at the
   * shoulders, narrower at the waist. The tank's straps run from the
   * shoulders up toward the neck.
   */
  private drawTorso(
    ctx: CanvasRenderingContext2D,
    j: AvatarJoints,
    raw: AvatarJoints,
    outfit: AvatarOutfit,
  ): void {
    const waistHalf = raw.shoulderWidthPx * 0.36;
    const shoulderHalf = raw.shoulderWidthPx * 0.5;
    const midX =
      (j.leftShoulder.x + j.rightShoulder.x) / 2;
    const shoulderY =
      (j.leftShoulder.y + j.rightShoulder.y) / 2;
    const hipY = (j.leftHip.y + j.rightHip.y) / 2;
    ctx.fillStyle = outfit.top.color;
    ctx.beginPath();
    ctx.moveTo(midX - shoulderHalf, shoulderY);
    ctx.lineTo(midX + shoulderHalf, shoulderY);
    ctx.quadraticCurveTo(
      midX + waistHalf + 6,
      (shoulderY + hipY) / 2,
      midX + waistHalf,
      hipY,
    );
    ctx.lineTo(midX - waistHalf, hipY);
    ctx.quadraticCurveTo(
      midX - waistHalf - 6,
      (shoulderY + hipY) / 2,
      midX - shoulderHalf,
      shoulderY,
    );
    ctx.closePath();
    ctx.fill();
    if (outfit.top.style === 'tank') {
      // Straps over the shoulders, up toward the neck.
      const strapW = raw.torsoLengthPx * 0.07;
      for (const shoulder of [j.leftShoulder, j.rightShoulder]) {
        capsule(
          ctx,
          { x: shoulder.x, y: shoulder.y - strapW * 0.4 },
          {
            x: shoulder.x + (midX - shoulder.x) * 0.25,
            y: shoulder.y - raw.torsoLengthPx * 0.14,
          },
          strapW,
          outfit.top.strapColor,
        );
      }
      // Scooped neckline: skin shows between the straps.
      ctx.fillStyle = outfit.skin.tone;
      ctx.beginPath();
      ctx.ellipse(midX, shoulderY - 2, shoulderHalf * 0.42, raw.torsoLengthPx * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Bottoms: hips down to mid-thigh, in the outfit's bottoms colour and
   * pattern. The legs are drawn over the lower edge, so the boxers read
   * as shorts the legs emerge from.
   */
  private drawBottoms(
    ctx: CanvasRenderingContext2D,
    j: AvatarJoints,
    raw: AvatarJoints,
    outfit: AvatarOutfit,
  ): void {
    const hipY = (j.leftHip.y + j.rightHip.y) / 2;
    const midX = (j.leftHip.x + j.rightHip.x) / 2;
    const halfW = raw.shoulderWidthPx * 0.42;
    // Mid-thigh: halfway from hips to knees.
    const legY =
      (j.leftKnee.y + j.rightKnee.y) / 2;
    const bottomY = hipY + (legY - hipY) * 0.55;
    ctx.fillStyle = outfit.bottoms.color;
    ctx.beginPath();
    ctx.moveTo(midX - halfW, hipY - raw.torsoLengthPx * 0.04);
    ctx.lineTo(midX + halfW, hipY - raw.torsoLengthPx * 0.04);
    ctx.lineTo(midX + halfW * 0.92, bottomY);
    ctx.lineTo(midX - halfW * 0.92, bottomY);
    ctx.closePath();
    ctx.fill();
    if (outfit.bottoms.pattern === 'hearts') {
      const heartSize = AVATAR.heartSizeTorsoFrac * raw.torsoLengthPx;
      ctx.fillStyle = outfit.bottoms.patternColor;
      const midY = (hipY + bottomY) / 2;
      for (const dx of [-0.5, 0, 0.5]) {
        for (const dy of [-0.22, 0.22]) {
          traceHeart(
            ctx,
            midX + dx * halfW,
            midY + dy * (bottomY - hipY),
            heartSize,
          );
          ctx.fill();
        }
      }
    }
  }

  /**
   * Head: skin circle, two dot eyes + a small smile, then the hat. The
   * circle comes from `headGeometry` — big (0.24 torso lengths) and
   * sitting on the neck, chin overlapping the torso top. The face is
   * drawn relative to the head centre, NOT the nose landmark: the nose
   * rides ~0.3 torso lengths above the shoulders, so nose-anchored
   * eyes would sit at the top rim of the bigger, lower head. `nose.x`
   * still centres the face horizontally.
   */
  private drawHead(
    ctx: CanvasRenderingContext2D,
    j: AvatarJoints,
    headR: number,
    outfit: AvatarOutfit,
  ): void {
    const { cx, cy, r } = headGeometry(j, headR);
    ctx.fillStyle = outfit.skin.tone;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // Friendly face: dot eyes above the head centre, small smile below it.
    ctx.fillStyle = '#26221f';
    const eyeDX = r * 0.38;
    const eyeY = cy - r * 0.3;
    for (const ex of [j.nose.x - eyeDX, j.nose.x + eyeDX]) {
      ctx.beginPath();
      ctx.arc(ex, eyeY, r * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#26221f';
    ctx.lineWidth = Math.max(2, r * 0.06);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(j.nose.x, cy + r * 0.25, r * 0.32, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    if (outfit.hat.style === 'hard-hat') {
      this.drawHardHat(ctx, cx, cy, r, outfit.hat.color);
    }
  }

  /** The yellow hard hat from the old helmet drawing, scaled to the head. */
  private drawHardHat(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    headR: number,
    color: string,
  ): void {
    const topY = cy - headR * 0.12;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#d9a441';
    ctx.lineWidth = 2;
    // Dome.
    ctx.beginPath();
    ctx.arc(cx, topY, headR * 1.02, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Brim.
    ctx.beginPath();
    ctx.ellipse(cx, topY, headR * 1.32, headR * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
