import { describe, expect, it } from 'vitest';
import { BodyStateTracker, type BodyState } from '../core/bodyState';
import { MouseSource } from './mouseSource';
import type { RawPoseFrame } from '../tracking/poseTypes';

/** Pull a frame, failing the test if the source produces none. */
function mustFrame(source: MouseSource, nowMs: number): RawPoseFrame {
  const frame = source.frameAt(nowMs);
  if (frame === null) throw new Error(`MouseSource produced no frame at ${nowMs}`);
  return frame;
}

/** Advance the sim to `endMs` in 16ms steps, returning the last BodyState. */
function advanceTo(
  source: MouseSource,
  tracker: BodyStateTracker,
  endMs: number,
  startMs = 16,
): BodyState {
  let body = tracker.update(mustFrame(source, startMs));
  for (let t = startMs + 16; t <= endMs; t += 16) {
    body = tracker.update(mustFrame(source, t));
  }
  return body;
}

describe('MouseSource', () => {
  it('returns null before start and after stop', () => {
    const source = new MouseSource();
    expect(source.frameAt(0)).toBeNull();
    source.start(0);
    expect(source.frameAt(0)).not.toBeNull();
    source.stop();
    expect(source.frameAt(100)).toBeNull();
  });

  it('moves the torso with the pointer', () => {
    const source = new MouseSource();
    const tracker = new BodyStateTracker();
    source.start(0);
    source.setPointer({ x: 0.25, y: 0.55 }, false);
    const body = tracker.update(mustFrame(source, 16));
    expect(body.torsoX).toBeCloseTo(0.25, 1);
  });

  it('raises the left arm straight up on left-button hold', () => {
    const source = new MouseSource();
    const tracker = new BodyStateTracker();
    source.start(0);
    source.setPointer({ x: 0.5, y: 0.55 }, true, 0);
    const body = advanceTo(source, tracker, 400);
    expect(body.leftArm.raised).toBe(true);
    expect(body.leftArm.extended).toBe(true);
    expect(body.leftArm.angleDeg).toBeCloseTo(0, 0);
    expect(body.rightArm.raised).toBe(false);
  });

  it('raises the right arm straight up on right-button hold', () => {
    const source = new MouseSource();
    const tracker = new BodyStateTracker();
    source.start(0);
    source.setPointer({ x: 0.5, y: 0.55 }, true, 2);
    const body = advanceTo(source, tracker, 400);
    expect(body.rightArm.raised).toBe(true);
    expect(body.rightArm.angleDeg).toBeCloseTo(0, 0);
    expect(body.leftArm.raised).toBe(false);
  });

  it('lowers the arm on release', () => {
    const source = new MouseSource();
    const tracker = new BodyStateTracker();
    source.start(0);
    source.setPointer({ x: 0.5, y: 0.55 }, true, 0);
    advanceTo(source, tracker, 300);
    source.setPointer({ x: 0.5, y: 0.55 }, false);
    const body = advanceTo(source, tracker, 700, 316);
    expect(body.leftArm.raised).toBe(false);
  });

  it('raises the left arm angled with Q and the right arm angled with E', () => {
    const source = new MouseSource();
    const tracker = new BodyStateTracker();
    source.start(0);
    source.setKeyArmAngled('left', true);
    const body = advanceTo(source, tracker, 400);
    expect(body.leftArm.raised).toBe(true);
    expect(body.leftArm.angleDeg).toBeCloseTo(-35, 0);
    source.setKeyArmAngled('left', false);
    source.setKeyArmAngled('right', true);
    const body2 = advanceTo(source, tracker, 800, 416);
    expect(body2.rightArm.raised).toBe(true);
    expect(body2.rightArm.angleDeg).toBeCloseTo(35, 0);
  });

  it('raises arms straight up with A and D keys', () => {
    const source = new MouseSource();
    const tracker = new BodyStateTracker();
    source.start(0);
    source.setKeyArm('left', true);
    const body = advanceTo(source, tracker, 400);
    expect(body.leftArm.raised).toBe(true);
    expect(body.leftArm.angleDeg).toBeCloseTo(0, 0);
  });

  it('keeps ankles at hip width standing (~0.59 torso)', () => {
    const source = new MouseSource();
    const tracker = new BodyStateTracker();
    source.start(0);
    const body = advanceTo(source, tracker, 200);
    expect(body.ankleSpreadTorsoFrac).toBeCloseTo(0.59, 1);
  });

  it('spreads ankles past the star-jump line while X is held', () => {
    const source = new MouseSource();
    const tracker = new BodyStateTracker();
    source.start(0);
    source.setLegsWide(true);
    const body = advanceTo(source, tracker, 200);
    // Detector needs >= 0.85 (STAR_JUMP.minAnkleSpreadTorsoFrac);
    // legs-wide reads SIM.legsWideAnkleSpreadTorsoFrac (1.15).
    expect(body.ankleSpreadTorsoFrac ?? 0).toBeGreaterThanOrEqual(0.85);
    expect(body.ankleSpreadTorsoFrac).toBeCloseTo(1.15, 1);
    source.setLegsWide(false);
    const body2 = advanceTo(source, tracker, 400, 216);
    expect(body2.ankleSpreadTorsoFrac).toBeCloseTo(0.59, 1);
  });
});
