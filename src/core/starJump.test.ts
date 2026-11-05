import { describe, expect, it } from 'vitest';
import {
  StarJumpDetector,
  starJumpShape,
  type StarJumpBodyInput,
} from './starJump';

/**
 * Synthetic body for the detector: wrist spread / heights in torso
 * lengths, ankle spread in torso lengths. The detector only reads
 * wrist X/Y + shoulder Y + torso length + jumping + ankle spread,
 * so a fake body is exact here.
 */
function makeBody(options: {
  jumping?: boolean;
  /** Wrist spread, torso lengths. Default 0.2: hands together. */
  wristSpreadTorso?: number;
  /** Wrist height above the shoulder, torso lengths. Default -1: hanging. */
  wristHeightTorso?: number;
  /** Ankle spread, torso lengths. Default 0.59: standing hip width. */
  ankleSpreadTorso?: number;
  present?: boolean;
} = {}): StarJumpBodyInput {
  const torsoLength = 0.3;
  const shoulderY = 0.25;
  const midX = 0.5;
  const spread = (options.wristSpreadTorso ?? 0.2) * torsoLength;
  const height = options.wristHeightTorso ?? -1;
  return {
    present: options.present ?? true,
    torsoLength,
    shoulderY,
    leftWristX: midX - spread / 2,
    rightWristX: midX + spread / 2,
    leftWristY: shoulderY - height * torsoLength,
    rightWristY: shoulderY - height * torsoLength,
    jumping: options.jumping ?? false,
    ankleSpreadTorsoFrac: options.ankleSpreadTorso ?? 0.59,
  };
}

/** A full jumping-jack shape: mid-air, arms wide + up, feet apart. */
const STAR_JUMP = makeBody({
  jumping: true,
  wristSpreadTorso: 1.6,
  wristHeightTorso: 0.5,
  ankleSpreadTorso: 1.2,
});

describe('starJumpShape', () => {
  it('accepts a wide-arms jump with legs apart', () => {
    const shape = starJumpShape(STAR_JUMP);
    expect(shape.jumping).toBe(true);
    expect(shape.armsWide).toBe(true);
    expect(shape.legsApart).toBe(true);
    expect(shape.progress).toBe(1);
    expect(shape.isStarJump).toBe(true);
  });

  it('rejects a plain jump (arms down, feet together)', () => {
    const shape = starJumpShape(makeBody({ jumping: true }));
    expect(shape.jumping).toBe(true);
    expect(shape.armsWide).toBe(false);
    expect(shape.legsApart).toBe(false);
    expect(shape.isStarJump).toBe(false);
    expect(shape.progress).toBeCloseTo(1 / 3);
  });

  it('rejects a static wide stance (not jumping)', () => {
    const shape = starJumpShape(
      makeBody({
        wristSpreadTorso: 1.6,
        wristHeightTorso: 0.5,
        ankleSpreadTorso: 1.2,
      }),
    );
    expect(shape.jumping).toBe(false);
    expect(shape.isStarJump).toBe(false);
    expect(shape.progress).toBeCloseTo(2 / 3);
  });

  it('rejects a jump with arms straight up (not wide)', () => {
    const shape = starJumpShape(
      makeBody({
        jumping: true,
        wristSpreadTorso: 0.73,
        wristHeightTorso: 0.9,
        ankleSpreadTorso: 1.2,
      }),
    );
    expect(shape.armsWide).toBe(false);
    expect(shape.isStarJump).toBe(false);
  });

  it('rejects a jump with arms wide but hanging at the sides', () => {
    const shape = starJumpShape(
      makeBody({
        jumping: true,
        wristSpreadTorso: 1.6,
        wristHeightTorso: -0.5,
        ankleSpreadTorso: 1.2,
      }),
    );
    expect(shape.armsWide).toBe(false);
    expect(shape.isStarJump).toBe(false);
  });

  it('rejects a jump with arms wide but feet together', () => {
    const shape = starJumpShape(
      makeBody({
        jumping: true,
        wristSpreadTorso: 1.6,
        wristHeightTorso: 0.5,
        ankleSpreadTorso: 0.59,
      }),
    );
    expect(shape.legsApart).toBe(false);
    expect(shape.isStarJump).toBe(false);
  });

  it('returns no shape for a missing body', () => {
    expect(starJumpShape(null).isStarJump).toBe(false);
    expect(starJumpShape(null).progress).toBe(0);
  });
});

describe('StarJumpDetector', () => {
  it('fires once per jump, not once per frame in the shape', () => {
    const detector = new StarJumpDetector();
    expect(detector.update(STAR_JUMP, 1000)?.kind).toBe('star-jump');
    // Still mid-air in the same shape: no second event.
    expect(detector.update(STAR_JUMP, 1100)).toBeNull();
    expect(detector.update(STAR_JUMP, 1600)).toBeNull();
    // Land, then jump again: fires again.
    expect(detector.update(makeBody(), 2000)).toBeNull();
    expect(detector.update(STAR_JUMP, 2600)?.kind).toBe('star-jump');
  });

  it('does not double-count inside the minimum interval', () => {
    const detector = new StarJumpDetector();
    expect(detector.update(STAR_JUMP, 1000)?.kind).toBe('star-jump');
    expect(detector.update(makeBody(), 1100)).toBeNull();
    // Re-armed by landing, but inside the 500 ms interval: silent.
    expect(detector.update(STAR_JUMP, 1200)).toBeNull();
    // Past the interval: fires.
    expect(detector.update(makeBody(), 1600)).toBeNull();
    expect(detector.update(STAR_JUMP, 1700)?.kind).toBe('star-jump');
  });

  it('re-arms when the arms come in mid-air', () => {
    const detector = new StarJumpDetector();
    expect(detector.update(STAR_JUMP, 1000)?.kind).toBe('star-jump');
    expect(detector.update(makeBody({ jumping: true }), 1200)).toBeNull();
    expect(detector.update(STAR_JUMP, 2000)?.kind).toBe('star-jump');
  });
});
