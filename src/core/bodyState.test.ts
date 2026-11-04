import { describe, expect, it } from 'vitest';
import {
  armAngleDegRaw,
  armCanFire,
  armDirectionCanvas,
  BodyStateTracker,
  jointAngle,
  jointAngles,
  poseMatchScore,
  type PoseTarget,
} from './bodyState';
import { makeFrame, makePose } from './poseFixture';
import { PoseLandmark } from '../tracking/poseTypes';
import type { NormalizedLandmark } from '../tracking/poseTypes';

function lm(x: number, y: number): NormalizedLandmark {
  return { x, y, visibility: 0.99 };
}

describe('armAngleDegRaw', () => {
  it('is 0 straight up', () => {
    expect(armAngleDegRaw(lm(0.4, 0.3), lm(0.4, 0.1))).toBeCloseTo(0, 9);
  });

  it('is positive pointing to video-right, negative to video-left', () => {
    expect(armAngleDegRaw(lm(0.4, 0.3), lm(0.5, 0.1))).toBeCloseTo(26.57, 1);
    expect(armAngleDegRaw(lm(0.4, 0.3), lm(0.3, 0.1))).toBeCloseTo(-26.57, 1);
  });

  it('is 90 pointing straight sideways', () => {
    expect(armAngleDegRaw(lm(0.4, 0.3), lm(0.6, 0.3))).toBeCloseTo(90, 9);
  });
});

describe('armDirectionCanvas', () => {
  it('points straight up for angle 0', () => {
    const d = armDirectionCanvas(0);
    expect(d.x).toBeCloseTo(0, 9);
    expect(d.y).toBeCloseTo(-1, 9);
  });

  it('mirrors video-right into canvas-left', () => {
    // An arm pointing to video-right (positive angle) points to canvas-left.
    const d = armDirectionCanvas(30);
    expect(d.x).toBeLessThan(0);
    expect(d.y).toBeLessThan(0);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 9);
  });

  it('clamps to the max fire angle', () => {
    const d = armDirectionCanvas(120);
    const expected = armDirectionCanvas(60);
    expect(d.x).toBeCloseTo(expected.x, 9);
    expect(d.y).toBeCloseTo(expected.y, 9);
  });
});

describe('jointAngle', () => {
  it('is 180 for a straight line', () => {
    expect(jointAngle(lm(0, 0), lm(1, 0), lm(2, 0))).toBeCloseTo(180, 9);
  });

  it('is 90 for a right angle', () => {
    expect(jointAngle(lm(0, 0), lm(1, 0), lm(1, 1))).toBeCloseTo(90, 9);
  });
});

describe('BodyStateTracker', () => {
  it('reports no person when landmarks are null', () => {
    const tracker = new BodyStateTracker();
    const state = tracker.update(makeFrame(null, 1000));
    expect(state.present).toBe(false);
    expect(state.inFrame).toBe(false);
    expect(state.leftArm.raised).toBe(false);
  });

  it('derives torsoX from the hip midpoint', () => {
    const tracker = new BodyStateTracker();
    const state = tracker.update(makeFrame(makePose({ torsoX: 0.3 }), 1000));
    expect(state.present).toBe(true);
    expect(state.torsoX).toBeCloseTo(0.3, 2);
    expect(state.torsoLength).toBeGreaterThan(0.2);
  });

  it('detects a raised straight arm as ready to fire', () => {
    const tracker = new BodyStateTracker();
    const state = tracker.update(
      makeFrame(makePose({ rightArmDeg: 0 }), 1000),
    );
    expect(state.rightArm.raised).toBe(true);
    expect(state.rightArm.extended).toBe(true);
    expect(state.rightArm.angleDeg).toBeCloseTo(0, 0);
    expect(armCanFire(state.rightArm)).toBe(true);
    // The other arm hangs down and cannot fire.
    expect(armCanFire(state.leftArm)).toBe(false);
  });

  it('does not let a bent raised arm fire', () => {
    const tracker = new BodyStateTracker();
    const state = tracker.update(
      makeFrame(makePose({ rightArmDeg: 0, rightArmBent: true }), 1000),
    );
    expect(state.rightArm.raised).toBe(true);
    expect(state.rightArm.extended).toBe(false);
    expect(armCanFire(state.rightArm)).toBe(false);
  });

  it('detects an angled arm', () => {
    const tracker = new BodyStateTracker();
    const state = tracker.update(
      makeFrame(makePose({ leftArmDeg: -35 }), 1000),
    );
    expect(state.leftArm.raised).toBe(true);
    expect(state.leftArm.angleDeg).toBeCloseTo(-35, 0);
  });

  it('detects a jump from a hip rise', () => {
    const tracker = new BodyStateTracker();
    tracker.update(makeFrame(makePose({}), 1000));
    tracker.update(makeFrame(makePose({}), 1033));
    const state = tracker.update(makeFrame(makePose({ hipDY: -0.12 }), 1066));
    expect(state.jumping).toBe(true);
    expect(state.ducking).toBe(false);
  });

  it('detects a duck from a hip drop plus bent knees', () => {
    const tracker = new BodyStateTracker();
    tracker.update(makeFrame(makePose({}), 1000));
    tracker.update(makeFrame(makePose({}), 1033));
    const state = tracker.update(
      makeFrame(makePose({ hipDY: 0.08, kneeBend: 1 }), 1066),
    );
    expect(state.ducking).toBe(true);
    expect(state.jumping).toBe(false);
  });

  it('flags out-of-frame when the torso leaves the margins', () => {
    const tracker = new BodyStateTracker();
    const state = tracker.update(makeFrame(makePose({ torsoX: 0.02 }), 1000));
    expect(state.present).toBe(true);
    expect(state.inFrame).toBe(false);
  });
});

describe('BodyStateTracker bodyUsable', () => {
  it('is usable when shoulders + hips are all confidently visible', () => {
    const tracker = new BodyStateTracker();
    const state = tracker.update(makeFrame(makePose({}), 1000));
    expect(state.present).toBe(true);
    expect(state.inFrame).toBe(true);
    expect(state.bodyUsable).toBe(true);
    expect(state.visibilityScore).toBeCloseTo(0.99, 2);
    expect(state.landmarkVisibility.leftShoulder).toBeCloseTo(0.99, 2);
    expect(state.kneesVisible).toBe(true);
  });

  it('is not usable when one shoulder is invisible, even if the mean hides it', () => {
    const tracker = new BodyStateTracker();
    const pose = makePose({
      visibilityOverrides: { [PoseLandmark.LEFT_SHOULDER]: 0.1 },
    });
    const state = tracker.update(makeFrame(pose, 1000));
    // Mean visibility is still (0.1 + 0.99*3)/4 = 0.77 — the mean alone
    // would call this usable. The per-landmark check must not.
    expect(state.visibilityScore).toBeGreaterThan(0.5);
    expect(state.bodyUsable).toBe(false);
    expect(state.landmarkVisibility.leftShoulder).toBeCloseTo(0.1, 2);
  });

  it('is not usable when one hip is invisible', () => {
    const tracker = new BodyStateTracker();
    const pose = makePose({
      visibilityOverrides: { [PoseLandmark.RIGHT_HIP]: 0.2 },
    });
    const state = tracker.update(makeFrame(pose, 1000));
    expect(state.bodyUsable).toBe(false);
  });

  it('is not usable when there is no frame at all', () => {
    const tracker = new BodyStateTracker();
    const state = tracker.update(makeFrame(null, 1000));
    expect(state.present).toBe(false);
    expect(state.bodyUsable).toBe(false);
    expect(state.visibilityScore).toBe(0);
  });

  it('is not usable when the torso is out of frame', () => {
    const tracker = new BodyStateTracker();
    const state = tracker.update(makeFrame(makePose({ torsoX: 0.02 }), 1000));
    expect(state.inFrame).toBe(false);
    expect(state.bodyUsable).toBe(false);
  });

  it('is still usable when knees are missing (requireKnees is false in v1)', () => {
    const tracker = new BodyStateTracker();
    const pose = makePose({
      visibilityOverrides: {
        [PoseLandmark.LEFT_KNEE]: 0.1,
        [PoseLandmark.RIGHT_KNEE]: 0.1,
      },
    });
    const state = tracker.update(makeFrame(pose, 1000));
    expect(state.kneesVisible).toBe(false);
    expect(state.bodyUsable).toBe(true);
  });

  it('is not usable when every torso landmark is low-visibility', () => {
    const tracker = new BodyStateTracker();
    const state = tracker.update(makeFrame(makePose({ visibility: 0.2 }), 1000));
    expect(state.bodyUsable).toBe(false);
  });
});

describe('poseMatchScore', () => {
  it('scores 1 for a pose against its own joint angles', () => {
    const pose = makePose({ leftArmDeg: -90, rightArmDeg: 90 });
    const target = jointAngles(pose);
    expect(poseMatchScore(pose, target)).toBeCloseTo(1, 9);
  });

  it('scores low for a different pose on the joints that define it', () => {
    const tPose = makePose({ leftArmDeg: -90, rightArmDeg: 90 });
    const armsUp = makePose({ leftArmDeg: 0, rightArmDeg: 0 });
    // Arm poses differ only in the shoulders: elbows, hips and knees match
    // in both, so a full 8-joint target would dilute the difference to
    // ~0.88. Real dance targets specify only the defining joints.
    const target: PoseTarget = {
      leftShoulder: jointAngles(tPose).leftShoulder,
      rightShoulder: jointAngles(tPose).rightShoulder,
    };
    expect(poseMatchScore(armsUp, target)).toBeLessThan(0.72);
  });

  it('ignores joints the target does not specify', () => {
    const pose = makePose({ leftArmDeg: 0, rightArmDeg: 0 });
    const target = {
      leftShoulder: jointAngles(pose).leftShoulder,
    };
    expect(poseMatchScore(pose, target)).toBeCloseTo(1, 9);
  });

  it('returns 0 for an empty target', () => {
    expect(poseMatchScore(makePose({}), {})).toBe(0);
  });

  it('reads the shoulder angle from named landmarks, not raw indices', () => {
    const pose = makePose({ leftArmDeg: 0, rightArmDeg: 0 });
    const angles = jointAngles(pose);
    // Arms straight up: shoulder angle (elbow-shoulder-hip) is ~180.
    expect(angles.leftShoulder).toBeGreaterThan(160);
    expect(angles.rightShoulder).toBeGreaterThan(160);
    // Arms hanging: shoulder angle is small.
    const down = jointAngles(makePose({ leftArmDeg: 170, rightArmDeg: 170 }));
    expect(down.leftShoulder).toBeLessThan(40);
  });
});
