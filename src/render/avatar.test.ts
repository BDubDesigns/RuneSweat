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
import {
  AvatarRenderer,
  avatarJoints,
  headGeometry,
  headRadiusPx,
  limbWidthPx,
  resolveOutfit,
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
});
