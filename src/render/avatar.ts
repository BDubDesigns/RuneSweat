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
 * Draw order: far arm, far leg, torso (top), near leg, bottoms, near
 * arm, head: skin circle, then the hat, then the face. Both legs go
 * before the bottoms (v3.3) so the cuffs cover the upper thighs and
 * the legs emerge from them. The hat goes BEFORE the face on purpose
 * (v3.2): v3.1 drew the eyes first and the hard-hat dome over them, so
 * every playtest frame showed a smile and no eyes. The face sits in
 * the visible band below the brim.
 *
 * Hand circles (v3.6): each arm ends in a circle centred exactly on
 * the (smoothed) wrist landmark — the circle IS the hand and IS the
 * hitbox for every hand interaction, so what the player sees is
 * where the game thinks the hand is. Brandon's v3.5 playtest had
 * nothing on screen showing the hand position (the arm tips missed
 * his real hands by ~50–100 px), so aiming was guesswork. The
 * forearm capsule stops inside the circle (see `forearmEndPoint`),
 * never poking past the wrist. Both hands get circles whenever the
 * avatar is drawn. `handCircleGeometry` is the single source for
 * the circle centre + radius: the detectors and the pointer
 * highlight (Worker B) read the same numbers the render draws.
 *
 * Canvas drawing itself is untestable in Node — the pure geometry
 * helpers below (`avatarJoints`, `limbWidthPx`, `headRadiusPx`,
 * `resolveOutfit`, `torsoGeometry`, `bottomsGeometry`) carry the unit
 * tests; the `draw()` path is verified by typecheck + build + a
 * real-device playtest.
 */

import { AVATAR, OUTFIT, RENDER, type AvatarOutfit } from '../core/config';
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

/**
 * Hand-circle radius, as a fraction of torso length (v3.6).
 *
 * 0.125, so the circle is 0.25 torso lengths across — the same
 * width as a v3.5 press pad, fist-sized: a fist (~0.18–0.2 torso
 * wide) fills the circle with a little margin, and the circle is
 * clearly visible at stage size without swallowing the forearm.
 * The old hand dot (radius `limbW * 0.55` = 0.088 torso) was
 * smaller than a fist, the same colour as the arm, and had no
 * outline — it read as the arm's rounded tip, not a hand.
 */
export const HAND_CIRCLE_RADIUS_TORSO_FRAC = 0.125;

/** Dark outline for the hand circles — reads against any background. */
export const HAND_CIRCLE_OUTLINE = '#7a5230';

/** Pure: hand-circle radius for a body of this canvas torso length. */
export function handCircleRadiusPx(torsoLengthPx: number): number {
  return HAND_CIRCLE_RADIUS_TORSO_FRAC * torsoLengthPx;
}

/** Canvas-space hand circle for one hand: centre + radius. */
export interface HandCircleGeometry {
  /** Centre — exactly the (smoothed) wrist joint position. */
  centre: Vec2;
  /** Radius, canvas px. */
  r: number;
}

/**
 * Pure: the hand circles for a pose (v3.6). Each circle is centred
 * exactly on its wrist joint — the same smoothed position the
 * detectors use, so the circle IS the hand and IS the hitbox: where
 * the player sees the circle is where the game thinks the hand is.
 * Pass the SMOOTHED joints (what `draw()` draws from), not the raw
 * landmarks, or the circle will sit on the unsmoothed wrist while
 * the arm follows the smoothed one. Radius is
 * `handCircleRadiusPx(torsoLengthPx)` for both hands.
 */
export function handCircleGeometry(joints: AvatarJoints): {
  left: HandCircleGeometry;
  right: HandCircleGeometry;
} {
  const r = handCircleRadiusPx(joints.torsoLengthPx);
  return {
    left: { centre: joints.leftWrist, r },
    right: { centre: joints.rightWrist, r },
  };
}

/**
 * Label on a menu hand circle (v3.7): 'L' / 'R', centred in the
 * circle, bold, sized to the circle radius. The cap height of a bold
 * capital at font size `r` is ~0.7r, so the letter fills the circle
 * without touching its edge at any body distance — the label scales
 * with the circle because it IS a fraction of it. Colour is the
 * face-feature dark, which reads on the skin fill.
 *
 * Menu-only: the in-game circles (`drawHandCircle`) carry no label —
 * activities keep exactly the v3.6 look, and the label lives only on
 * the menu cursors drawn by `AvatarRenderer.drawHandCursors`.
 */
export const HAND_CIRCLE_LABEL_COLOR = '#26221f';
/** Label font size, as a fraction of the hand-circle radius. */
export const HAND_CIRCLE_LABEL_FONT_RADIUS_FRAC = 1;

/** Canvas-space label for one hand circle: what + where + how big. */
export interface HandCircleLabelGeometry {
  text: 'L' | 'R';
  x: number;
  y: number;
  fontPx: number;
}

/**
 * Pure: the label for one hand circle. Centred on the circle centre
 * — the letter rides the wrist exactly like the circle does, so it
 * can never drift off the hand it names.
 */
export function handCircleLabelGeometry(
  circle: HandCircleGeometry,
  label: 'L' | 'R',
): HandCircleLabelGeometry {
  return {
    text: label,
    x: circle.centre.x,
    y: circle.centre.y,
    fontPx: circle.r * HAND_CIRCLE_LABEL_FONT_RADIUS_FRAC,
  };
}

/**
 * Pure: where the forearm capsule ends (v3.6). The capsule runs
 * elbow -> this point, NOT elbow -> wrist: the point sits
 * `0.5 * handRadius` back from the wrist along the forearm, so the
 * capsule's round cap (half-width `0.9 * limbW / 2` = 0.072 torso)
 * ends at wrist − 0.0625 + 0.072 ≈ wrist + 0.01 torso — inside the
 * hand circle (radius 0.125 torso), never poking past the wrist.
 * A capsule drawn all the way to the wrist ends ~0.072 torso past
 * it, which is the floating rounded tip the v3.5 playtest showed.
 */
export function forearmEndPoint(
  elbow: Vec2,
  wrist: Vec2,
  handRadius: number,
): Vec2 {
  const dir = vUnit(vSub(wrist, elbow));
  return vSub(wrist, vScale(dir, handRadius * 0.5));
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

/** Canvas-space hard-hat geometry for a head circle. */
export interface HardHatGeometry {
  /** Y of the dome centre (the dome is drawn from this point up). */
  topY: number;
  /** Dome radius. */
  domeRadius: number;
  /**
   * Bottom edge of the brim ellipse. Everything above this line is
   * under the hat: the brim is `0.16r` tall, centred on `topY`, so
   * the brim bottom sits at `cy + 0.04r`.
   */
  brimBottomY: number;
}

/**
 * Pure: hard-hat geometry for a head circle. The dome is centred
 * `0.12r` above the head centre with radius `1.02r`, so it covers
 * everything within a head-radius of that point — including where
 * v3.1 put the eyes (`cy - 0.3r`, `0.42r` from the dome centre).
 */
export function hardHatGeometry(head: HeadGeometry): HardHatGeometry {
  const topY = head.cy - head.r * 0.12;
  return {
    topY,
    domeRadius: head.r * 1.02,
    brimBottomY: topY + head.r * 0.16,
  };
}

/** Canvas-space face geometry for a head circle. */
export interface FaceGeometry {
  /** Y of the eye centres. */
  eyeY: number;
  /** Eye dot radius. */
  eyeRadius: number;
  /** Horizontal offset of each eye from the face centre. */
  eyeDX: number;
  /** Y of the smile arc centre. */
  smileY: number;
  /** Smile arc radius. */
  smileRadius: number;
}

/**
 * Pure: face geometry for a head circle (v3.2). The eyes sit BELOW
 * the brim (`cy + 0.32r`, brim bottom is `cy + 0.04r`) in the visible
 * face band, which runs from the brim to the chin at `cy + r`. Eye
 * radius is `0.15r` — v3.1's `0.09r` was ~7 px across at laptop size
 * and unreadable at phone size; `0.15r` is ~12 px across on the sim
 * body and still small enough not to look googly. The smile sits
 * below the eyes (`cy + 0.55r`, bottom at `cy + 0.85r`), clear of
 * both the eyes and the chin.
 */
export function faceGeometry(head: HeadGeometry): FaceGeometry {
  return {
    eyeY: head.cy + head.r * 0.32,
    eyeRadius: head.r * 0.15,
    eyeDX: head.r * 0.36,
    smileY: head.cy + head.r * 0.55,
    smileRadius: head.r * 0.3,
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

/** Tiny 2D vector helpers for the geometry builders below. */
function vAdd(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}
function vSub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}
function vScale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}
function vLen(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}
function vUnit(a: Vec2): Vec2 {
  const len = vLen(a);
  return len < 1e-6 ? { x: 0, y: 1 } : vScale(a, 1 / len);
}
function vMid(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function vDot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}
/** Rotate 90° counter-clockwise (canvas y-down: this is "left" of the vector). */
function vPerp(a: Vec2): Vec2 {
  return { x: -a.y, y: a.x };
}

/** Canvas-space tank-top strap: a short strip on the shoulder line. */
export interface StrapGeometry {
  /** Outer end, at the shoulder (pulled slightly inward from the corner). */
  a: Vec2;
  /** Inner end, toward the neck along the shoulder line. */
  b: Vec2;
  /** Strip width, canvas px. */
  width: number;
}

/** Canvas-space torso geometry for a pose. */
export interface TorsoGeometry {
  /** Top edge endpoints — exactly the shoulder landmarks. */
  topLeft: Vec2;
  topRight: Vec2;
  /** Waist endpoints — on the hip line, tapered inward from the hips. */
  waistLeft: Vec2;
  waistRight: Vec2;
  /** Midpoint of the shoulder line — the neck centre. */
  neckMid: Vec2;
  /** How far the neckline dips below the shoulder line at the neck. */
  scoopDepth: number;
  /** Deepest point of the neckline scoop. */
  scoopBottom: Vec2;
  /**
   * Quadratic control point for the scoop curve, `2 * scoopDepth`
   * below the neck line — a quadratic's midpoint sits halfway between
   * its endpoints' midpoint and its control point, so this makes the
   * drawn curve bottom out exactly at `scoopBottom`.
   */
  scoopControl: Vec2;
  /** How far the side control points pull inward from the straight shoulder-to-waist line. */
  armholeInset: number;
  /** Quadratic control points for the side curves (top -> waist). */
  leftSideControl: Vec2;
  rightSideControl: Vec2;
  strapLeft: StrapGeometry;
  strapRight: StrapGeometry;
}

/**
 * Pure: torso geometry for a pose (v3.3).
 *
 * The top edge IS the shoulder line — from the actual leftShoulder
 * landmark to the actual rightShoulder landmark, tilted however the
 * body leans, so the arms anchor exactly at the torso's top corners.
 * The waist end follows the hip line the same way, tapered inward
 * (waist half-width `0.82` of hip half-width — v3.2's slab was `0.9`).
 * The neckline scoop is cut INTO the top edge: the edge dips
 * `0.09` torso lengths below the shoulder line at the neck. That
 * stays clear of the chin — the chin sits `0.45 * headR` = `0.108`
 * torso lengths below the shoulder line, so the scoop bottoms out
 * ~0.018 torso lengths above it and never cuts into the face. The
 * sides curve inward below the shoulders (armholes), pulled
 * `0.08` shoulder widths in from the straight shoulder-to-waist line.
 * Straps are short thin strips ON the shoulder line, running
 * shoulder-to-neck: `0.18` shoulder widths long, `0.035` torso
 * lengths wide — half v3.2's `0.07` width, which is what made them
 * read as white lines — centred just above the top edge so they sit
 * on the shoulder without crossing the chest.
 */
export function torsoGeometry(j: AvatarJoints): TorsoGeometry {
  const shoulderDir = vUnit(vSub(j.rightShoulder, j.leftShoulder));
  const neckMid = vMid(j.leftShoulder, j.rightShoulder);
  const hipDir = vUnit(vSub(j.rightHip, j.leftHip));
  const hipMid = vMid(j.leftHip, j.rightHip);
  const hipHalf = vLen(vSub(j.rightHip, j.leftHip)) / 2;
  const waistHalf = hipHalf * 0.82;
  const waistLeft = vAdd(hipMid, vScale(hipDir, -waistHalf));
  const waistRight = vAdd(hipMid, vScale(hipDir, waistHalf));
  // "Down" for this body: perpendicular to the shoulder line, pointing
  // toward the hips (canvas y-down, so usually +y, but follow the lean).
  const perp = vPerp(shoulderDir);
  const down = vDot(perp, vSub(hipMid, neckMid)) >= 0 ? perp : vScale(perp, -1);
  const up = vScale(down, -1);
  const scoopDepth = j.torsoLengthPx * 0.09;
  const scoopBottom = vAdd(neckMid, vScale(down, scoopDepth));
  const scoopControl = vAdd(neckMid, vScale(down, scoopDepth * 2));
  const armholeInset = j.shoulderWidthPx * 0.08;
  // Side curves: the midpoint of the straight shoulder-to-waist line,
  // pulled toward the torso centreline by the armhole inset.
  const centreMid = vMid(neckMid, hipMid);
  const sideControl = (top: Vec2, waist: Vec2): Vec2 => {
    const mid = vMid(top, waist);
    return vAdd(mid, vScale(vUnit(vSub(centreMid, mid)), armholeInset));
  };
  const leftSideControl = sideControl(j.leftShoulder, waistLeft);
  const rightSideControl = sideControl(j.rightShoulder, waistRight);
  // Straps: along the shoulder line from each shoulder toward the neck,
  // centred a little above the top edge so they sit on the shoulder.
  const strapWidth = j.torsoLengthPx * 0.035;
  const strapOffset = vScale(up, strapWidth * 0.35);
  const strapLen = j.shoulderWidthPx * 0.18;
  const strapInset = j.shoulderWidthPx * 0.02;
  const strap = (shoulder: Vec2, dir: Vec2): StrapGeometry => {
    const a = vAdd(vAdd(shoulder, vScale(dir, strapInset)), strapOffset);
    const b = vAdd(a, vScale(dir, strapLen));
    return { a, b, width: strapWidth };
  };
  return {
    topLeft: j.leftShoulder,
    topRight: j.rightShoulder,
    waistLeft,
    waistRight,
    neckMid,
    scoopDepth,
    scoopBottom,
    scoopControl,
    armholeInset,
    leftSideControl,
    rightSideControl,
    strapLeft: strap(j.leftShoulder, shoulderDir),
    strapRight: strap(j.rightShoulder, vScale(shoulderDir, -1)),
  };
}

/** Canvas-space geometry for one boxer leg cuff. */
export interface CuffGeometry {
  side: 'left' | 'right';
  /** Top edge endpoints, on the (lifted) hip line. */
  topOuter: Vec2;
  topInner: Vec2;
  /** The crotch point, shared by both cuffs, above the cuff bottoms. */
  crotch: Vec2;
  /** Bottom edge endpoints, partway down the thigh. */
  bottomInner: Vec2;
  bottomOuter: Vec2;
  /** Midpoint of the bottom edge — on the thigh, partway down. */
  bottomMid: Vec2;
  /** Unit vector from the hip to the bottom edge midpoint (the thigh direction). */
  axis: Vec2;
  /** |hip -> bottomMid| as a fraction of hip -> knee length. */
  depthFrac: number;
  /** Heart pattern centres, on the thigh axis inside the cuff. */
  heartCentres: Vec2[];
}

/** Canvas-space bottoms geometry for a pose: two cuffs + a shared crotch. */
export interface BottomsGeometry {
  left: CuffGeometry;
  right: CuffGeometry;
  /** The shared crotch point. */
  crotch: Vec2;
}

/**
 * Pure: bottoms geometry for a pose (v3.3).
 *
 * Two leg cuffs, one per thigh — not one slab. Each cuff is a pentagon
 * whose top edge runs from its hip to the shared waistband centre
 * (the hip line, lifted `0.04` torso lengths so the waistband overlaps
 * the torso), whose inner edge bends through the shared crotch point
 * (`0.10` torso lengths below the hip line, along the average thigh
 * direction), and whose bottom edge sits `0.55` of the way down the
 * thigh, perpendicular to it, `0.13` shoulder widths to each side of
 * the thigh axis — wider than the leg capsule, so the leg emerges
 * from the cuff instead of painting over it. The crotch sits well
 * above the cuff bottoms, so the bottom silhouette is a V notch, not
 * a straight line. Hearts: two per cuff, on the thigh axis at `0.20`
 * and `0.40` of the way down.
 */
export function bottomsGeometry(j: AvatarJoints): BottomsGeometry {
  const hipMid = vMid(j.leftHip, j.rightHip);
  const hipDir = vUnit(vSub(j.rightHip, j.leftHip));
  // "Up" for this body: perpendicular to the hip line, away from the knees.
  const perp = vPerp(hipDir);
  const up = vDot(perp, vSub(j.leftKnee, hipMid)) >= 0 ? vScale(perp, -1) : perp;
  const lift = j.torsoLengthPx * 0.04;
  const topInner = vAdd(hipMid, vScale(up, lift));
  // Crotch: below the hip line along the average thigh direction.
  const avgThighDir = vUnit(
    vAdd(
      vUnit(vSub(j.leftKnee, j.leftHip)),
      vUnit(vSub(j.rightKnee, j.rightHip)),
    ),
  );
  const crotch = vAdd(hipMid, vScale(avgThighDir, j.torsoLengthPx * 0.1));
  const cuff = (side: 'left' | 'right'): CuffGeometry => {
    const hip = side === 'left' ? j.leftHip : j.rightHip;
    const knee = side === 'left' ? j.leftKnee : j.rightKnee;
    const thigh = vSub(knee, hip);
    const thighLen = vLen(thigh);
    const thighDir = vUnit(thigh);
    const depthFrac = 0.55;
    const bottomMid = vAdd(hip, vScale(thighDir, thighLen * depthFrac));
    // Outward from the thigh axis, away from the body midline.
    const outPerp = vPerp(thighDir);
    const outward =
      vDot(outPerp, vSub(hip, hipMid)) >= 0 ? outPerp : vScale(outPerp, -1);
    const halfW = j.shoulderWidthPx * 0.13;
    const bottomOuter = vAdd(bottomMid, vScale(outward, halfW));
    const bottomInner = vAdd(bottomMid, vScale(outward, -halfW));
    return {
      side,
      topOuter: vAdd(hip, vScale(up, lift)),
      topInner,
      crotch,
      bottomInner,
      bottomOuter,
      bottomMid,
      axis: thighDir,
      depthFrac,
      heartCentres: [0.2, 0.4].map((f) =>
        vAdd(hip, vScale(thighDir, thighLen * f)),
      ),
    };
  };
  return { left: cuff('left'), right: cuff('right'), crotch };
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
    // Both legs go BEFORE the bottoms (v3.3): the cuffs are drawn over
    // the upper thighs, so the legs emerge from the cuffs instead of
    // painting a skin stripe down the middle of the near cuff.
    this.drawArm(ctx, sm, 'left', limbW, resolved.skin.tone);
    this.drawLeg(ctx, sm, 'left', limbW, resolved.skin.tone);
    this.drawTorso(ctx, sm, resolved);
    this.drawLeg(ctx, sm, 'right', limbW, resolved.skin.tone);
    this.drawBottoms(ctx, sm, resolved);
    this.drawArm(ctx, sm, 'right', limbW, resolved.skin.tone);
    this.drawHead(ctx, sm, headR, resolved);
    ctx.restore();
  }

  /**
   * Menu hand cursors (v3.7): BOTH hand circles, labelled, and
   * nothing else — no torso, no head, no limbs. For menu screens
   * where the full avatar is not drawn (the Town Hub): the two
   * circles ARE the cursor there, so the player can always see
   * where both hands are. Same circles as in-game
   * (`handCircleGeometry`, same fill/outline via `drawHandCircle`),
   * so the menu circles and the in-game circles can never disagree
   * about where a hand is; the only addition is the 'L' / 'R'
   * label centred in each circle. Uses the same per-joint smoothing
   * as `draw()`, so the circles track exactly like the in-game
   * ones. No body: draws nothing and resets the smoothing state.
   */
  public drawHandCursors(
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
    const circles = handCircleGeometry(sm);
    ctx.save();
    this.drawHandCircle(
      ctx,
      circles.left.centre,
      circles.left.r,
      resolved.skin.tone,
    );
    this.drawHandCircleLabel(ctx, circles.left, 'L');
    this.drawHandCircle(
      ctx,
      circles.right.centre,
      circles.right.r,
      resolved.skin.tone,
    );
    this.drawHandCircleLabel(ctx, circles.right, 'R');
    ctx.restore();
  }

  /** 'L' / 'R' centred in a hand circle (v3.7, menu cursors only). */
  private drawHandCircleLabel(
    ctx: CanvasRenderingContext2D,
    circle: HandCircleGeometry,
    label: 'L' | 'R',
  ): void {
    const geometry = handCircleLabelGeometry(circle, label);
    ctx.font = `700 ${geometry.fontPx}px ${RENDER.gameFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = HAND_CIRCLE_LABEL_COLOR;
    ctx.fillText(geometry.text, geometry.x, geometry.y);
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
    const handR = handCircleRadiusPx(j.torsoLengthPx);
    capsule(ctx, shoulder, elbow, limbW, skin);
    // Forearm stops inside the hand circle (v3.6): the capsule
    // terminates at the circle, its round cap never poking past
    // the wrist the way the v3.5 arm tips did.
    capsule(ctx, elbow, forearmEndPoint(elbow, wrist, handR), limbW * 0.9, skin);
    // Hand: a fist-sized circle at the wrist, drawn AFTER (over)
    // the arm capsules — the circle IS the hand and IS the hitbox.
    this.drawHandCircle(ctx, wrist, handR, skin);
  }

  /**
   * Hand circle (v3.6): skin-toned fill with a darker outline, so
   * it reads as a hand against any background and is
   * distinguishable from the arm capsule behind it. Centred
   * exactly on the wrist landmark. The pointer highlight (Worker
   * B) rings this same circle via `handCircleGeometry`.
   */
  private drawHandCircle(
    ctx: CanvasRenderingContext2D,
    wrist: Vec2,
    handR: number,
    skin: string,
  ): void {
    ctx.fillStyle = skin;
    ctx.strokeStyle = HAND_CIRCLE_OUTLINE;
    ctx.lineWidth = Math.max(2, handR * 0.12);
    ctx.beginPath();
    ctx.arc(wrist.x, wrist.y, handR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
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
   * Torso in the outfit's top (v3.3): a tank top whose top edge IS the
   * shoulder line, so the arms anchor at its top corners whatever the
   * lean; the neckline scoop is cut into the top edge between the
   * straps (no skin ellipse stamped on top); the sides curve inward
   * below the shoulders (armholes); the waist follows the hip line,
   * tapered. Straps are short thin strips on the shoulder line.
   */
  private drawTorso(
    ctx: CanvasRenderingContext2D,
    j: AvatarJoints,
    outfit: AvatarOutfit,
  ): void {
    const g = torsoGeometry(j);
    ctx.fillStyle = outfit.top.color;
    ctx.beginPath();
    ctx.moveTo(g.topLeft.x, g.topLeft.y);
    ctx.lineTo(g.strapLeft.b.x, g.strapLeft.b.y);
    // Scoop: quadratic between the strap inner ends, bottoming out at
    // scoopBottom (the control point sits 2x the depth below the neck).
    ctx.quadraticCurveTo(
      g.scoopControl.x,
      g.scoopControl.y,
      g.strapRight.b.x,
      g.strapRight.b.y,
    );
    ctx.lineTo(g.topRight.x, g.topRight.y);
    ctx.quadraticCurveTo(
      g.rightSideControl.x,
      g.rightSideControl.y,
      g.waistRight.x,
      g.waistRight.y,
    );
    ctx.lineTo(g.waistLeft.x, g.waistLeft.y);
    ctx.quadraticCurveTo(
      g.leftSideControl.x,
      g.leftSideControl.y,
      g.topLeft.x,
      g.topLeft.y,
    );
    ctx.closePath();
    ctx.fill();
    if (outfit.top.style === 'tank') {
      // Straps on the shoulder line, shoulder-to-neck — never diagonal
      // across the chest, never past the torso midline.
      for (const strap of [g.strapLeft, g.strapRight]) {
        capsule(ctx, strap.a, strap.b, strap.width, outfit.top.strapColor);
      }
    }
  }

  /**
   * Bottoms (v3.3): two leg cuffs, one per thigh, meeting at the
   * crotch — the legs emerge from the cuffs, and the bottom silhouette
   * is a V notch, not a straight edge. Hearts live on each cuff.
   */
  private drawBottoms(
    ctx: CanvasRenderingContext2D,
    j: AvatarJoints,
    outfit: AvatarOutfit,
  ): void {
    const g = bottomsGeometry(j);
    ctx.fillStyle = outfit.bottoms.color;
    for (const cuff of [g.left, g.right]) {
      ctx.beginPath();
      ctx.moveTo(cuff.topOuter.x, cuff.topOuter.y);
      ctx.lineTo(cuff.topInner.x, cuff.topInner.y);
      ctx.lineTo(cuff.crotch.x, cuff.crotch.y);
      ctx.lineTo(cuff.bottomInner.x, cuff.bottomInner.y);
      ctx.lineTo(cuff.bottomOuter.x, cuff.bottomOuter.y);
      ctx.closePath();
      ctx.fill();
    }
    if (outfit.bottoms.pattern === 'hearts') {
      const heartSize = AVATAR.heartSizeTorsoFrac * j.torsoLengthPx;
      ctx.fillStyle = outfit.bottoms.patternColor;
      for (const cuff of [g.left, g.right]) {
        for (const centre of cuff.heartCentres) {
          traceHeart(ctx, centre.x, centre.y, heartSize);
          ctx.fill();
        }
      }
    }
  }

  /**
   * Head: skin circle, then the hat, then the face. The hat goes on
   * BEFORE the face (v3.2): v3.1 drew dot eyes at `cy - 0.3r` and
   * then painted the hard-hat dome over them, so every playtest
   * frame showed a smile and no eyes. The eyes now sit below the
   * brim (see `faceGeometry`) in the visible face band, and are
   * drawn after the hat, so nothing can cover them. The face is
   * drawn relative to the head centre, NOT the nose landmark: the
   * nose rides ~0.3 torso lengths above the shoulders, so
   * nose-anchored eyes would sit at the top rim of the bigger,
   * lower head. `nose.x` still centres the face horizontally.
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
    // Hat first — the dome covers the top of the head, and the face
    // must land on top of it, not under it.
    if (outfit.hat.style === 'hard-hat') {
      this.drawHardHat(ctx, cx, cy, r, outfit.hat.color);
    }
    // Friendly face: dot eyes below the brim, small smile below them.
    const face = faceGeometry({ cx, cy, r });
    ctx.fillStyle = '#26221f';
    for (const ex of [j.nose.x - face.eyeDX, j.nose.x + face.eyeDX]) {
      ctx.beginPath();
      ctx.arc(ex, face.eyeY, face.eyeRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#26221f';
    ctx.lineWidth = Math.max(2, r * 0.06);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(j.nose.x, face.smileY, face.smileRadius, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  /** The yellow hard hat from the old helmet drawing, scaled to the head. */
  private drawHardHat(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    headR: number,
    color: string,
  ): void {
    const hat = hardHatGeometry({ cx, cy, r: headR });
    ctx.fillStyle = color;
    ctx.strokeStyle = '#d9a441';
    ctx.lineWidth = 2;
    // Dome.
    ctx.beginPath();
    ctx.arc(cx, hat.topY, hat.domeRadius, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Brim.
    ctx.beginPath();
    ctx.ellipse(cx, hat.topY, headR * 1.32, headR * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
