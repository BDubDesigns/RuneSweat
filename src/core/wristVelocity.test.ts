import { describe, expect, it } from 'vitest';
import { SWING } from './config';
import { BodyStateTracker } from './bodyState';
import { makeFrame, makePose } from './poseFixture';

/**
 * Wrist tracking: smoothed wrist Y + vertical velocity (positive = moving
 * down in video space). Driven through synthetic landmark frames at a
 * fixed 60 Hz step, like the mouse simulator's frame rate.
 */
describe('BodyStateTracker wrist tracking', () => {
  it('reports wrist Y above the shoulder when the arm is raised', () => {
    const tracker = new BodyStateTracker();
    const state = tracker.update(
      makeFrame(makePose({ leftArmDeg: 0, rightArmDeg: 0 }), 1000),
    );
    expect(state.leftWristY).toBeLessThan(state.shoulderY);
    expect(state.rightWristY).toBeLessThan(state.shoulderY);
    // Default pose: hips at 0.55, torso 0.30, shoulders at 0.25.
    expect(state.shoulderY).toBeCloseTo(0.25, 1);
    expect(state.leftWristVelY).toBe(0);
  });

  it('derives a fast downward velocity from a quick arm drop', () => {
    const tracker = new BodyStateTracker();
    let peakVel = 0;
    // Arms up, then drop from 0° to 170° over ~120ms (the sim's raiseMs).
    const steps = 8;
    for (let i = 0; i <= steps; i += 1) {
      const t = 1000 + i * 16;
      const angle = (170 * i) / steps;
      const state = tracker.update(
        makeFrame(makePose({ leftArmDeg: angle }), t),
      );
      peakVel = Math.max(peakVel, state.leftWristVelY / state.torsoLength);
    }
    // A real swing drop reads well above the strike threshold.
    expect(peakVel).toBeGreaterThan(SWING.strikeVelocityTorsoFracPerSec);
  });

  it('derives a slow velocity from a slow arm lower', () => {
    const tracker = new BodyStateTracker();
    let peakVel = 0;
    // Same drop, stretched over 1.5 s: a deliberate slow lower.
    const steps = 90;
    for (let i = 0; i <= steps; i += 1) {
      const t = 1000 + i * 16;
      const angle = (170 * i) / steps;
      const state = tracker.update(
        makeFrame(makePose({ leftArmDeg: angle }), t),
      );
      peakVel = Math.max(peakVel, state.leftWristVelY / state.torsoLength);
    }
    expect(peakVel).toBeGreaterThan(0);
    expect(peakVel).toBeLessThan(SWING.strikeVelocityTorsoFracPerSec);
  });

  it('reports a negative velocity while the arm rises', () => {
    const tracker = new BodyStateTracker();
    tracker.update(makeFrame(makePose({ leftArmDeg: 170 }), 1000));
    let minVel = 0;
    for (let i = 1; i <= 8; i += 1) {
      const state = tracker.update(
        makeFrame(makePose({ leftArmDeg: 170 - (170 * i) / 8 }), 1000 + i * 16),
      );
      minVel = Math.min(minVel, state.leftWristVelY);
    }
    expect(minVel).toBeLessThan(0);
  });

  it('reports zero velocity for a still arm', () => {
    const tracker = new BodyStateTracker();
    tracker.update(makeFrame(makePose({ leftArmDeg: 0 }), 1000));
    const state = tracker.update(makeFrame(makePose({ leftArmDeg: 0 }), 1016));
    expect(state.leftWristVelY).toBeCloseTo(0, 9);
  });

  it('resets velocity to zero after a lost frame (no stale spike)', () => {
    const tracker = new BodyStateTracker();
    // Fast drop in progress…
    tracker.update(makeFrame(makePose({ leftArmDeg: 0 }), 1000));
    const dropping = tracker.update(
      makeFrame(makePose({ leftArmDeg: 90 }), 1016),
    );
    expect(dropping.leftWristVelY).toBeGreaterThan(0);
    // …then the body vanishes and reappears with arms down: the velocity
    // must not spike from the stale pre-gap wrist position.
    tracker.update(makeFrame(null, 1032));
    const back = tracker.update(
      makeFrame(makePose({ leftArmDeg: 170 }), 1048),
    );
    expect(back.leftWristVelY).toBe(0);
    expect(back.present).toBe(true);
  });

  it('reports zero velocity on a repeated timestamp', () => {
    const tracker = new BodyStateTracker();
    tracker.update(makeFrame(makePose({ leftArmDeg: 0 }), 1000));
    const state = tracker.update(makeFrame(makePose({ leftArmDeg: 90 }), 1000));
    expect(state.leftWristVelY).toBe(0);
  });
});
