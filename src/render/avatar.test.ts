/**
 * Avatar geometry tests (pure helpers — no canvas needed).
 *
 * The canvas drawing itself cannot run in Node (there is no 2D context
 * here), so these tests cover the geometry the drawing is built on:
 * joint mapping, body-scale widths, and outfit slot resolution. The
 * `draw()` smoke test below runs the full draw path against a stub
 * context that accepts every call — it proves the path runs without
 * throwing, not what it looks like. The look needs a real-device
 * playtest.
 */

import { describe, expect, it } from 'vitest';
import { OUTFIT } from '../core/config';
import { makePose } from '../core/poseFixture';
import { PoseLandmark, type NormalizedLandmark } from '../tracking/poseTypes';
import {
  AvatarRenderer,
  avatarJoints,
  bottomsGeometry,
  faceGeometry,
  forearmEndPoint,
  HAND_CIRCLE_OUTLINE,
  HAND_CIRCLE_RADIUS_TORSO_FRAC,
  handCircleGeometry,
  handCircleRadiusPx,
  hardHatGeometry,
  headGeometry,
  headRadiusPx,
  limbWidthPx,
  resolveOutfit,
  torsoGeometry,
} from './avatar';
import { toCanvas } from './stage';

/**
 * A stand-in 2D context: every method is a no-op, every property set
 * succeeds. `draw()` only calls methods and assigns style properties,
 * so this is enough to run the whole draw path in Node.
 */
function stubContext(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get: (_t, _prop) => () => undefined,
    set: (t, prop, value) => {
      t[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/**
 * A recording stand-in: like `stubContext`, but every method call is
 * logged (method name + args) so tests can prove DRAW ORDER — e.g.
 * that the hat dome is painted before the eyes. Property sets are
 * also recorded for `fillStyle` (the background-fill assertions).
 */
interface RecordedCall {
  method: string;
  args: unknown[];
}
function recordingContext(): {
  ctx: CanvasRenderingContext2D;
  calls: RecordedCall[];
  fillStyles: string[];
} {
  const calls: RecordedCall[] = [];
  const fillStyles: string[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get: (_t, prop) => {
      if (prop === 'canvas') return { width: 960, height: 540 };
      return (...args: unknown[]) => {
        calls.push({ method: String(prop), args });
      };
    },
    set: (t, prop, value) => {
      if (prop === 'fillStyle' && typeof value === 'string') {
        fillStyles.push(value);
      }
      t[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, fillStyles };
}

describe('avatarJoints', () => {
  it('maps landmarks through toCanvas (mirrored once)', () => {
    const pose = makePose();
    const joints = avatarJoints(pose, 960, 540);
    expect(joints).not.toBeNull();
    const nose = pose[0];
    const leftWrist = pose[15];
    const rightAnkle = pose[28];
    if (joints === null || nose === undefined || leftWrist === undefined || rightAnkle === undefined) return;
    expect(joints.nose).toEqual(toCanvas(nose, 960, 540));
    expect(joints.leftWrist).toEqual(toCanvas(leftWrist, 960, 540));
    expect(joints.rightAnkle).toEqual(toCanvas(rightAnkle, 960, 540));
  });

  it('derives torso length from shoulder-mid to hip-mid, in canvas px', () => {
    const pose = makePose();
    const joints = avatarJoints(pose, 960, 540);
    expect(joints).not.toBeNull();
    if (joints === null) return;
    // Fixture: shoulderY = hipY - 0.3, so torso is 0.3 * 540 = 162 px.
    expect(joints.torsoLengthPx).toBeCloseTo(162, 6);
    expect(joints.shoulderWidthPx).toBeCloseTo(0.22 * 960, 6);
  });

  it('returns null for an incomplete pose', () => {
    expect(avatarJoints(makePose().slice(0, 20), 960, 540)).toBeNull();
    expect(avatarJoints([], 960, 540)).toBeNull();
  });
});

describe('avatar scale helpers', () => {
  it('limb width is ~0.16 torso lengths', () => {
    expect(limbWidthPx(162)).toBeCloseTo(25.92, 6);
    expect(limbWidthPx(0)).toBe(0);
  });

  it('head radius is ~0.24 torso lengths (v3.1: bigger than v3\'s 0.17)', () => {
    expect(headRadiusPx(162)).toBeCloseTo(38.88, 6);
  });
});

describe('headGeometry (v3.1: bigger head, sitting on the neck)', () => {
  it('head is bigger than v3 and its centre is lower than the ear line', () => {
    const pose = makePose();
    const joints = avatarJoints(pose, 960, 540);
    expect(joints).not.toBeNull();
    if (joints === null) return;
    const headR = headRadiusPx(joints.torsoLengthPx);
    const head = headGeometry(joints, headR);
    // v3: radius 0.17 * 162 = 27.54, centre at earY - 0.15 * 27.54.
    expect(head.r).toBeGreaterThan(0.17 * joints.torsoLengthPx);
    const earY = (joints.leftEar.y + joints.rightEar.y) / 2;
    expect(head.cy).toBeGreaterThan(earY);
  });

  it('chin overlaps the neck line: no gap, no floating', () => {
    const pose = makePose();
    const joints = avatarJoints(pose, 960, 540);
    expect(joints).not.toBeNull();
    if (joints === null) return;
    const headR = headRadiusPx(joints.torsoLengthPx);
    const head = headGeometry(joints, headR);
    const shoulderY = (joints.leftShoulder.y + joints.rightShoulder.y) / 2;
    // Bottom of the head is below the shoulder line (overlap), but by
    // less than a full radius — the head sits on the neck, it does not
    // swallow the chest.
    expect(head.cy + head.r).toBeGreaterThan(shoulderY);
    expect(head.cy + head.r - shoulderY).toBeLessThan(head.r);
  });

  it('head top is above the ears, so the ears stay inside the head', () => {
    const pose = makePose();
    const joints = avatarJoints(pose, 960, 540);
    expect(joints).not.toBeNull();
    if (joints === null) return;
    const headR = headRadiusPx(joints.torsoLengthPx);
    const head = headGeometry(joints, headR);
    const earY = (joints.leftEar.y + joints.rightEar.y) / 2;
    expect(head.cy - head.r).toBeLessThan(earY);
  });

  it('head is centred on the ear midpoint', () => {
    const pose = makePose();
    const joints = avatarJoints(pose, 960, 540);
    expect(joints).not.toBeNull();
    if (joints === null) return;
    const headR = headRadiusPx(joints.torsoLengthPx);
    const head = headGeometry(joints, headR);
    expect(head.cx).toBeCloseTo(
      (joints.leftEar.x + joints.rightEar.x) / 2,
      6,
    );
  });
});

describe('hardHatGeometry + faceGeometry (v3.2: eyes under the hat)', () => {
  function head(): {
    cx: number;
    cy: number;
    r: number;
    noseX: number;
  } {
    const pose = makePose();
    const joints = avatarJoints(pose, 960, 540);
    if (joints === null) throw new Error('fixture pose incomplete');
    const headR = headRadiusPx(joints.torsoLengthPx);
    const h = headGeometry(joints, headR);
    return { ...h, noseX: joints.nose.x };
  }

  it('the v3.1 eye position was inside the dome — the bug, pinned', () => {
    const h = head();
    const hat = hardHatGeometry(h);
    // v3.1 eyes: (nose.x ± 0.38r, cy - 0.3r). Distance from the dome
    // centre (cx, topY): sqrt(0.38² + 0.18²)r ≈ 0.42r, well inside
    // the 1.02r dome — and the dome was painted AFTER the eyes.
    const eyeY = h.cy - h.r * 0.3;
    const dx = h.r * 0.38;
    const dist = Math.hypot(dx, eyeY - hat.topY);
    expect(dist).toBeLessThan(hat.domeRadius);
    expect(eyeY).toBeLessThan(hat.brimBottomY);
  });

  it('the brim bottom sits at cy + 0.04r', () => {
    const h = head();
    const hat = hardHatGeometry(h);
    expect(hat.brimBottomY).toBeCloseTo(h.cy + h.r * 0.04, 6);
    expect(hat.domeRadius).toBeCloseTo(h.r * 1.02, 6);
  });

  it('the eyes sit below the brim bottom, inside the head circle', () => {
    const h = head();
    const hat = hardHatGeometry(h);
    const face = faceGeometry(h);
    expect(face.eyeY).toBeGreaterThan(hat.brimBottomY);
    // Both eyes fully inside the head circle.
    for (const ex of [h.noseX - face.eyeDX, h.noseX + face.eyeDX]) {
      const dist = Math.hypot(ex - h.cx, face.eyeY - h.cy);
      expect(dist + face.eyeRadius).toBeLessThan(h.r);
    }
  });

  it('the eyes are bigger than v3.1 (0.09r -> 0.15r)', () => {
    const h = head();
    const face = faceGeometry(h);
    expect(face.eyeRadius).toBeCloseTo(h.r * 0.15, 6);
    expect(face.eyeRadius).toBeGreaterThan(h.r * 0.09);
    // ~12 px across on the sim body (r ≈ 39 px) — readable at phone size.
    expect(face.eyeRadius * 2).toBeGreaterThan(10);
  });

  it('the smile sits below the eyes and inside the head', () => {
    const h = head();
    const face = faceGeometry(h);
    expect(face.smileY).toBeGreaterThan(face.eyeY + face.eyeRadius);
    expect(face.smileY + face.smileRadius).toBeLessThan(h.cy + h.r);
  });
});

describe('torsoGeometry (v3.3: torso follows the shoulder line)', () => {
  /** A pose leaning to one side: left shoulder/hip raised, right lowered. */
  function tiltedPose(): NormalizedLandmark[] {
    const pose = makePose();
    const tilt = 0.04;
    const shift = (index: number, dy: number): void => {
      const entry = pose[index];
      if (entry === undefined) throw new Error('fixture pose incomplete');
      entry.y += dy;
    };
    shift(PoseLandmark.LEFT_SHOULDER, -tilt);
    shift(PoseLandmark.RIGHT_SHOULDER, tilt);
    shift(PoseLandmark.LEFT_HIP, -tilt);
    shift(PoseLandmark.RIGHT_HIP, tilt);
    return pose;
  }

  it('top edge equals the shoulder landmarks, tilted the same way — not horizontal', () => {
    const joints = avatarJoints(tiltedPose(), 960, 540);
    expect(joints).not.toBeNull();
    if (joints === null) return;
    const g = torsoGeometry(joints);
    expect(g.topLeft).toEqual(joints.leftShoulder);
    expect(g.topRight).toEqual(joints.rightShoulder);
    // 0.04 normalized each way at 540 px tall = 43.2 px of tilt.
    expect(g.topLeft.y - g.topRight.y).toBeCloseTo(-43.2, 1);
    // Same tilt direction as the shoulders themselves.
    expect(Math.sign(g.topLeft.y - g.topRight.y)).toBe(
      Math.sign(joints.leftShoulder.y - joints.rightShoulder.y),
    );
  });

  it('top edge is level when the shoulders are level', () => {
    const joints = avatarJoints(makePose(), 960, 540);
    expect(joints).not.toBeNull();
    if (joints === null) return;
    const g = torsoGeometry(joints);
    expect(g.topLeft.y).toBeCloseTo(g.topRight.y, 6);
  });

  it('waist follows the hip line, tapered inward from the hips', () => {
    const joints = avatarJoints(tiltedPose(), 960, 540);
    expect(joints).not.toBeNull();
    if (joints === null) return;
    const g = torsoGeometry(joints);
    // Waist edge parallel to the hip line (cross product ~ 0).
    const cross =
      (g.waistRight.x - g.waistLeft.x) * (joints.rightHip.y - joints.leftHip.y) -
      (g.waistRight.y - g.waistLeft.y) * (joints.rightHip.x - joints.leftHip.x);
    expect(Math.abs(cross)).toBeLessThan(1);
    // Same tilt direction as the hips.
    expect(Math.sign(g.waistLeft.y - g.waistRight.y)).toBe(
      Math.sign(joints.leftHip.y - joints.rightHip.y),
    );
    // Tapered: waist is 0.82x the hip width, so the waist points sit
    // between the hips and the hip midpoint.
    const hipWidth = Math.hypot(
      joints.rightHip.x - joints.leftHip.x,
      joints.rightHip.y - joints.leftHip.y,
    );
    const waistWidth = Math.hypot(
      g.waistRight.x - g.waistLeft.x,
      g.waistRight.y - g.waistLeft.y,
    );
    expect(waistWidth / hipWidth).toBeCloseTo(0.82, 6);
    const hipMid = {
      x: (joints.leftHip.x + joints.rightHip.x) / 2,
      y: (joints.leftHip.y + joints.rightHip.y) / 2,
    };
    expect(
      Math.hypot(g.waistLeft.x - hipMid.x, g.waistLeft.y - hipMid.y),
    ).toBeLessThan(hipWidth / 2);
  });

  it('neckline scoop dips below the shoulder line, centred on the neck, clear of the chin', () => {
    const joints = avatarJoints(makePose(), 960, 540);
    expect(joints).not.toBeNull();
    if (joints === null) return;
    const g = torsoGeometry(joints);
    // 0.09 torso lengths on the sim body (torso 162 px).
    expect(g.scoopDepth).toBeCloseTo(joints.torsoLengthPx * 0.09, 6);
    expect(g.scoopDepth).toBeGreaterThan(0);
    // Bounded: nowhere near the waist, a full torso length below.
    expect(g.scoopDepth).toBeLessThan(joints.torsoLengthPx * 0.2);
    // Centred on the neck/shoulder midpoint, below the shoulder line.
    expect(g.scoopBottom.x).toBeCloseTo(g.neckMid.x, 6);
    expect(g.scoopBottom.y).toBeGreaterThan(g.neckMid.y);
    expect(g.scoopBottom.y - g.neckMid.y).toBeCloseTo(g.scoopDepth, 6);
    // The chin overlaps the torso top by 0.45 * headR; the scoop stays
    // above the chin line so it never cuts into the face.
    const headR = headRadiusPx(joints.torsoLengthPx);
    expect(g.scoopDepth).toBeLessThan(0.45 * headR);
    // The scoop control point sits 2x the depth below the neck, so the
    // drawn quadratic bottoms out exactly at the scoop bottom.
    expect(g.scoopControl.y - g.neckMid.y).toBeCloseTo(g.scoopDepth * 2, 6);
  });

  it('armholes pull the sides inward below the shoulders', () => {
    const joints = avatarJoints(makePose(), 960, 540);
    expect(joints).not.toBeNull();
    if (joints === null) return;
    const g = torsoGeometry(joints);
    expect(g.armholeInset).toBeGreaterThan(0);
    expect(g.armholeInset).toBeCloseTo(joints.shoulderWidthPx * 0.08, 6);
    // Each side control point sits inside the straight shoulder-to-waist
    // line — closer to the torso centreline than the line's midpoint.
    const centreX = g.neckMid.x;
    for (const [control, top] of [
      [g.leftSideControl, g.topLeft],
      [g.rightSideControl, g.topRight],
    ] as const) {
      const midX = (top.x + (top === g.topLeft ? g.waistLeft.x : g.waistRight.x)) / 2;
      expect(Math.abs(control.x - centreX)).toBeLessThan(Math.abs(midX - centreX));
    }
  });

  it('straps sit inside the shoulder band, thin, and never cross the midline', () => {
    const joints = avatarJoints(makePose(), 960, 540);
    expect(joints).not.toBeNull();
    if (joints === null) return;
    const g = torsoGeometry(joints);
    // Half v3.2's 0.07-torso width — thin enough to read as a strap.
    expect(g.strapLeft.width).toBeCloseTo(joints.torsoLengthPx * 0.035, 6);
    expect(g.strapLeft.width).toBeLessThan(joints.torsoLengthPx * 0.07);
    expect(g.strapRight.width).toBe(g.strapLeft.width);
    // 0.18 shoulder widths long, starting just inside the corner.
    const strapLen = Math.hypot(
      g.strapLeft.b.x - g.strapLeft.a.x,
      g.strapLeft.b.y - g.strapLeft.a.y,
    );
    expect(strapLen).toBeCloseTo(joints.shoulderWidthPx * 0.18, 6);
    // Both endpoints within the shoulder-to-neck span (t in [0, 0.5)
    // from the shoulder toward the neck) and on the shoulder's own
    // side of the midline — no strap crosses the chest centre.
    const shoulderDir = {
      x: (joints.rightShoulder.x - joints.leftShoulder.x) / joints.shoulderWidthPx,
      y: (joints.rightShoulder.y - joints.leftShoulder.y) / joints.shoulderWidthPx,
    };
    for (const [strap, shoulder, inward, sign] of [
      [g.strapLeft, joints.leftShoulder, shoulderDir, -1],
      [g.strapRight, joints.rightShoulder, { x: -shoulderDir.x, y: -shoulderDir.y }, 1],
    ] as const) {
      for (const p of [strap.a, strap.b]) {
        const along =
          (p.x - shoulder.x) * inward.x + (p.y - shoulder.y) * inward.y;
        expect(along).toBeGreaterThanOrEqual(0);
        expect(along).toBeLessThan(joints.shoulderWidthPx * 0.5);
        // Same side of the neck midpoint as its shoulder.
        const side =
          (p.x - g.neckMid.x) * shoulderDir.x + (p.y - g.neckMid.y) * shoulderDir.y;
        expect(Math.sign(side)).toBe(sign);
      }
    }
  });
});

describe('bottomsGeometry (v3.3: two cuffs with a notch)', () => {
  it('two cuffs share one crotch point, above the cuff bottoms — a notch, not a straight edge', () => {
    const joints = avatarJoints(makePose(), 960, 540);
    expect(joints).not.toBeNull();
    if (joints === null) return;
    const g = bottomsGeometry(joints);
    expect(g.left.crotch).toEqual(g.right.crotch);
    expect(g.crotch).toEqual(g.left.crotch);
    // The crotch sits above every cuff bottom corner (canvas y-down).
    for (const cuff of [g.left, g.right]) {
      expect(g.crotch.y).toBeLessThan(cuff.bottomInner.y);
      expect(g.crotch.y).toBeLessThan(cuff.bottomOuter.y);
      expect(g.crotch.y).toBeLessThan(cuff.bottomMid.y);
    }
    // And above the line joining the two outer bottom corners, by a
    // clear margin — the bottom silhouette is a V, not one straight line.
    const t =
      (g.crotch.x - g.left.bottomOuter.x) /
      (g.right.bottomOuter.x - g.left.bottomOuter.x);
    const lineY =
      g.left.bottomOuter.y +
      t * (g.right.bottomOuter.y - g.left.bottomOuter.y);
    expect(lineY - g.crotch.y).toBeGreaterThan(10);
    // The two cuffs are genuinely separate: their bottoms are apart.
    expect(
      Math.hypot(
        g.right.bottomMid.x - g.left.bottomMid.x,
        g.right.bottomMid.y - g.left.bottomMid.y,
      ),
    ).toBeGreaterThan(50);
  });

  it('each cuff follows its thigh: bottom edge on the thigh, perpendicular, partway down', () => {
    const joints = avatarJoints(makePose(), 960, 540);
    expect(joints).not.toBeNull();
    if (joints === null) return;
    const g = bottomsGeometry(joints);
    for (const [cuff, hip, knee] of [
      [g.left, joints.leftHip, joints.leftKnee],
      [g.right, joints.rightHip, joints.rightKnee],
    ] as const) {
      const thighLen = Math.hypot(knee.x - hip.x, knee.y - hip.y);
      const thighDir = {
        x: (knee.x - hip.x) / thighLen,
        y: (knee.y - hip.y) / thighLen,
      };
      // Hip -> bottomMid runs along the thigh (angle ~ 0).
      const toBottom = {
        x: cuff.bottomMid.x - hip.x,
        y: cuff.bottomMid.y - hip.y,
      };
      const along = toBottom.x * thighDir.x + toBottom.y * thighDir.y;
      const cross = toBottom.x * thighDir.y - toBottom.y * thighDir.x;
      expect(Math.atan2(Math.abs(cross), along)).toBeLessThan(0.09);
      // Bottom edge midpoint is 0.55 of the way down the thigh.
      expect(cuff.depthFrac).toBeCloseTo(0.55, 6);
      expect(along / thighLen).toBeCloseTo(0.55, 6);
      // Bottom edge is (near-)perpendicular to the thigh.
      const edgeLen = Math.hypot(
        cuff.bottomOuter.x - cuff.bottomInner.x,
        cuff.bottomOuter.y - cuff.bottomInner.y,
      );
      const edgeDot =
        ((cuff.bottomOuter.x - cuff.bottomInner.x) * thighDir.x +
          (cuff.bottomOuter.y - cuff.bottomInner.y) * thighDir.y) /
        edgeLen;
      expect(Math.abs(edgeDot)).toBeLessThan(0.15);
      // Cuff axis is the thigh direction.
      expect(Math.abs(cuff.axis.x - thighDir.x)).toBeLessThan(0.01);
      expect(Math.abs(cuff.axis.y - thighDir.y)).toBeLessThan(0.01);
    }
  });

  it('hearts live on each cuff, on the thigh axis inside the cuff', () => {
    const joints = avatarJoints(makePose(), 960, 540);
    expect(joints).not.toBeNull();
    if (joints === null) return;
    const g = bottomsGeometry(joints);
    for (const [cuff, hip, knee] of [
      [g.left, joints.leftHip, joints.leftKnee],
      [g.right, joints.rightHip, joints.rightKnee],
    ] as const) {
      expect(cuff.heartCentres).toHaveLength(2);
      const thighLen = Math.hypot(knee.x - hip.x, knee.y - hip.y);
      for (const heart of cuff.heartCentres) {
        // On the thigh axis...
        const cross =
          (heart.x - hip.x) * (knee.y - hip.y) -
          (heart.y - hip.y) * (knee.x - hip.x);
        expect(Math.abs(cross) / thighLen).toBeLessThan(1);
        // ...between the hip and the cuff bottom.
        const frac =
          ((heart.x - hip.x) * (knee.x - hip.x) +
            (heart.y - hip.y) * (knee.y - hip.y)) /
          (thighLen * thighLen);
        expect(frac).toBeGreaterThan(0.1);
        expect(frac).toBeLessThan(cuff.depthFrac);
      }
    }
  });
});

describe('handCircleGeometry (v3.6: the circle IS the hand and the hitbox)', () => {
  it('circle centres equal the wrist joints, radius is fist-sized (0.125 torso)', () => {
    const pose = makePose();
    const joints = avatarJoints(pose, 960, 540);
    expect(joints).not.toBeNull();
    if (joints === null) return;
    const circles = handCircleGeometry(joints);
    // Centres: exactly the wrist landmarks (the same smoothed
    // position the detectors use — no offset, no guesswork).
    expect(circles.left.centre).toEqual(joints.leftWrist);
    expect(circles.right.centre).toEqual(joints.rightWrist);
    // Radius: 0.125 torso lengths each — 0.25 across, the same
    // width as a press pad, fist-sized.
    expect(HAND_CIRCLE_RADIUS_TORSO_FRAC).toBeCloseTo(0.125);
    expect(circles.left.r).toBeCloseTo(joints.torsoLengthPx * 0.125, 6);
    expect(circles.right.r).toBe(circles.left.r);
    expect(circles.left.r * 2).toBeCloseTo(joints.torsoLengthPx * 0.25, 6);
    // Bigger than the old hand dot (limbW * 0.55 = 0.088 torso):
    // the old dot read as the arm's rounded tip, not a hand.
    expect(circles.left.r).toBeGreaterThan(limbWidthPx(joints.torsoLengthPx) * 0.55);
  });

  it('handCircleRadiusPx scales with the body', () => {
    expect(handCircleRadiusPx(162)).toBeCloseTo(20.25, 6);
    expect(handCircleRadiusPx(0)).toBe(0);
    expect(handCircleRadiusPx(324)).toBeCloseTo(40.5, 6);
  });

  it('the two circles are apart — one per hand, not one blob', () => {
    const pose = makePose();
    const joints = avatarJoints(pose, 960, 540);
    expect(joints).not.toBeNull();
    if (joints === null) return;
    const circles = handCircleGeometry(joints);
    const gap = Math.hypot(
      circles.right.centre.x - circles.left.centre.x,
      circles.right.centre.y - circles.left.centre.y,
    );
    expect(gap).toBeGreaterThan(circles.left.r + circles.right.r);
  });
});

describe('forearmEndPoint (v3.6: the capsule terminates at the circle)', () => {
  it('the forearm ends 0.5 hand-radii back from the wrist, on the elbow-wrist line', () => {
    const pose = makePose();
    const joints = avatarJoints(pose, 960, 540);
    expect(joints).not.toBeNull();
    if (joints === null) return;
    const handR = handCircleRadiusPx(joints.torsoLengthPx);
    for (const [elbow, wrist] of [
      [joints.leftElbow, joints.leftWrist],
      [joints.rightElbow, joints.rightWrist],
    ] as const) {
      const end = forearmEndPoint(elbow, wrist, handR);
      // On the elbow -> wrist segment, 0.5r short of the wrist.
      expect(Math.hypot(end.x - wrist.x, end.y - wrist.y)).toBeCloseTo(handR * 0.5, 6);
      // Collinear: cross product of (wrist - elbow) and (end - elbow) ~ 0.
      const cross =
        (wrist.x - elbow.x) * (end.y - elbow.y) -
        (wrist.y - elbow.y) * (end.x - elbow.x);
      expect(Math.abs(cross)).toBeLessThan(1);
      // Between elbow and wrist (not past either end).
      const along =
        ((end.x - elbow.x) * (wrist.x - elbow.x) +
          (end.y - elbow.y) * (wrist.y - elbow.y)) /
        (Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y) ** 2);
      expect(along).toBeGreaterThan(0);
      expect(along).toBeLessThan(1);
      // The round cap's tip (end + half the forearm width along the
      // arm direction) still lands INSIDE the hand circle, so no
      // rounded tip floats past the wrist: cap tip is wrist − 0.5r
      // + 0.072 torso, i.e. ~0.01 torso past the wrist, well inside
      // the 0.125-torso circle.
      const halfW = limbWidthPx(joints.torsoLengthPx) * 0.9 / 2;
      const capTipDist = Math.abs(handR * 0.5 - halfW);
      expect(capTipDist).toBeLessThan(handR);
    }
  });
});

describe('resolveOutfit', () => {
  it('defaults to the mining outfit (white tank, heart boxers, hard hat)', () => {
    const outfit = resolveOutfit();
    expect(outfit.top.style).toBe('tank');
    expect(outfit.top.color).toBe(OUTFIT.top.color);
    expect(outfit.bottoms.style).toBe('boxers');
    expect(outfit.bottoms.pattern).toBe('hearts');
    expect(outfit.hat.style).toBe('hard-hat');
  });

  it('swaps whole slots and keeps the rest at the default', () => {
    const outfit = resolveOutfit({
      top: { style: 'tee', color: '#4ea1ff', strapColor: '#4ea1ff' },
      hat: { style: 'none', color: '#000000' },
    });
    expect(outfit.top.style).toBe('tee');
    expect(outfit.top.color).toBe('#4ea1ff');
    expect(outfit.hat.style).toBe('none');
    // Untouched slots stay default.
    expect(outfit.bottoms).toEqual(OUTFIT.bottoms);
    expect(outfit.skin).toEqual(OUTFIT.skin);
  });
});

describe('AvatarRenderer.draw', () => {
  it('draws nothing (and does not throw) with no body', () => {
    const renderer = new AvatarRenderer();
    const ctx = stubContext();
    expect(() =>
      renderer.draw(ctx, null, 960, 540, OUTFIT, 1000),
    ).not.toThrow();
  });

  it('runs the full draw path for a complete pose without throwing', () => {
    const renderer = new AvatarRenderer();
    const ctx = stubContext();
    const pose = makePose({ leftArmDeg: 10, rightArmDeg: -10 });
    expect(() =>
      renderer.draw(ctx, pose, 960, 540, OUTFIT, 1000),
    ).not.toThrow();
    // A second frame with a later timestamp exercises the smoothing.
    const moved = makePose({ leftArmDeg: 30, rightArmDeg: -30 });
    expect(() =>
      renderer.draw(ctx, moved, 960, 540, OUTFIT, 1016),
    ).not.toThrow();
  });

  it('draws the hat dome BEFORE the eyes, and the eyes below the brim (v3.2)', () => {
    const renderer = new AvatarRenderer();
    const { ctx, calls } = recordingContext();
    const pose = makePose({ leftArmDeg: 10, rightArmDeg: -10 });
    renderer.draw(ctx, pose, 960, 540, OUTFIT, 1000);

    const joints = avatarJoints(pose, 960, 540);
    if (joints === null) throw new Error('fixture pose incomplete');
    const headR = headRadiusPx(joints.torsoLengthPx);
    const h = headGeometry(joints, headR);
    const hat = hardHatGeometry(h);
    const face = faceGeometry(h);

    // All arc() calls, in draw order, with their (x, y, radius).
    const arcs = calls
      .filter((c) => c.method === 'arc')
      .map((c) => ({
        x: c.args[0] as number,
        y: c.args[1] as number,
        r: c.args[2] as number,
      }));
    const close = (a: number, b: number): boolean => Math.abs(a - b) < 1;
    // The dome: radius 1.02r, centred at (cx, topY).
    const domeIdx = arcs.findIndex(
      (a) => close(a.r, hat.domeRadius) && close(a.y, hat.topY),
    );
    expect(domeIdx).toBeGreaterThanOrEqual(0);
    // The eyes: radius 0.15r, at eyeY. (The head circle is r, the
    // smile is 0.30r — neither matches 0.15r.)
    const eyeIdxs = arcs
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => close(a.r, face.eyeRadius) && close(a.y, face.eyeY))
      .map(({ i }) => i);
    expect(eyeIdxs).toHaveLength(2);
    for (const i of eyeIdxs) {
      // Hat first, eyes after — the dome can no longer paint over them.
      expect(i).toBeGreaterThan(domeIdx);
      // And the eyes sit below the brim bottom in the visible band.
      expect(arcs[i]?.y ?? 0).toBeGreaterThan(hat.brimBottomY);
    }
  });

  it('draws both legs before the bottoms, so the cuffs cover the upper thighs (v3.3)', () => {
    const renderer = new AvatarRenderer();
    const { ctx, fillStyles } = recordingContext();
    const pose = makePose({ leftArmDeg: 10, rightArmDeg: -10 });
    renderer.draw(ctx, pose, 960, 540, OUTFIT, 1000);

    // fillStyle sets, in draw order: far-arm hand (skin), far-leg foot
    // (skin), torso (top), near-leg foot (skin), bottoms, hearts, ...
    const topIdx = fillStyles.indexOf(OUTFIT.top.color);
    const bottomsIdx = fillStyles.indexOf(OUTFIT.bottoms.color);
    expect(topIdx).toBeGreaterThanOrEqual(0);
    expect(bottomsIdx).toBeGreaterThan(topIdx);
    // A skin fill (the near leg's foot) sits between the torso and the
    // bottoms — the near leg is drawn before the cuffs, not over them.
    const between = fillStyles.slice(topIdx + 1, bottomsIdx);
    expect(between).toContain(OUTFIT.skin.tone);
  });

  it('draws a hand circle at each wrist AFTER the arm capsules, filled + outlined (v3.6)', () => {
    const renderer = new AvatarRenderer();
    const { ctx, calls } = recordingContext();
    const pose = makePose({ leftArmDeg: 10, rightArmDeg: -10 });
    renderer.draw(ctx, pose, 960, 540, OUTFIT, 1000);

    const joints = avatarJoints(pose, 960, 540);
    if (joints === null) throw new Error('fixture pose incomplete');
    const handR = handCircleRadiusPx(joints.torsoLengthPx);
    const close = (a: number, b: number): boolean => Math.abs(a - b) < 1.5;

    // All arc() calls, in draw order.
    const arcs = calls
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.method === 'arc')
      .map(({ c, i }) => ({
        i,
        x: c.args[0] as number,
        y: c.args[1] as number,
        r: c.args[2] as number,
      }));
    // The hand circles: radius handR, centred on the wrists. (The
    // head is headR, the dome 1.02 * headR, the eyes 0.15 * headR,
    // the smile 0.30 * headR — none matches handR. First frame, so
    // the smoothing is the identity and the drawn wrists equal the
    // raw joints.)
    const handArcs = arcs.filter(
      (a) =>
        close(a.r, handR) &&
        ((close(a.x, joints.leftWrist.x) && close(a.y, joints.leftWrist.y)) ||
          (close(a.x, joints.rightWrist.x) && close(a.y, joints.rightWrist.y))),
    );
    expect(handArcs).toHaveLength(2);
    for (const hand of handArcs) {
      // Drawn AFTER the arm capsules: the nearest lineTo before
      // the circle is the forearm segment, and it ends inside the
      // circle (0.5 hand-radii back from the wrist) — the capsule
      // terminates at the circle, it does not poke past the wrist.
      let lineToIdx = -1;
      for (let k = hand.i - 1; k >= 0; k -= 1) {
        if (calls[k]?.method === 'lineTo') {
          lineToIdx = k;
          break;
        }
      }
      expect(lineToIdx).toBeGreaterThanOrEqual(0);
      expect(lineToIdx).toBeLessThan(hand.i);
      const lineTo = calls[lineToIdx];
      const endDist = Math.hypot(
        (lineTo?.args[0] as number) - hand.x,
        (lineTo?.args[1] as number) - hand.y,
      );
      expect(endDist).toBeLessThan(handR);
      // Filled in skin, then stroked with the dark outline — the
      // circle reads as a hand, distinct from the arm capsule.
      expect(calls[hand.i + 1]?.method).toBe('fill');
      expect(calls[hand.i + 2]?.method).toBe('stroke');
    }
    // The outline colour is a real dark tone, not the skin tone.
    expect(HAND_CIRCLE_OUTLINE).not.toBe(OUTFIT.skin.tone);
  });
});
