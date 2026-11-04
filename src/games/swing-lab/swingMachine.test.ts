import { describe, expect, it } from 'vitest';
import { SWING } from '../../core/config';
import { SwingMachine, type SwingBodyInput } from './swingMachine';

/**
 * Synthetic body for the machine: heights in torso lengths above the
 * shoulder (+ = overhead, - = below), velocities in torso lengths/sec
 * (+ = moving down). The machine only reads wrist Y / velocity /
 * shoulder Y / torso length, so a fake body is exact here.
 */
function makeBody(options: {
  leftHeight?: number;
  rightHeight?: number;
  leftVel?: number;
  rightVel?: number;
  present?: boolean;
} = {}): SwingBodyInput {
  const torsoLength = 0.3;
  const shoulderY = 0.25;
  const leftHeight = options.leftHeight ?? -1;
  const rightHeight = options.rightHeight ?? -1;
  return {
    present: options.present ?? true,
    torsoLength,
    shoulderY,
    leftWristY: shoulderY - leftHeight * torsoLength,
    rightWristY: shoulderY - rightHeight * torsoLength,
    leftWristVelY: (options.leftVel ?? 0) * torsoLength,
    rightWristVelY: (options.rightVel ?? 0) * torsoLength,
  };
}

/** Rest pose: both arms hanging, still. */
const REST = makeBody();

/** Both arms overhead, still. */
const WOUND = makeBody({ leftHeight: 0.9, rightHeight: 0.9 });

/** Both arms dropping fast through mid-air (above the strike line). */
const DROPPING_FAST = makeBody({
  leftHeight: 0.3,
  rightHeight: 0.3,
  leftVel: 5,
  rightVel: 5,
});

/** Both arms past the strike line, still moving fast. */
const CROSSED_FAST = makeBody({
  leftHeight: -0.6,
  rightHeight: -0.6,
  leftVel: 5,
  rightVel: 5,
});

/** Both arms past the strike line, moving slowly. */
const CROSSED_SLOW = makeBody({
  leftHeight: -0.6,
  rightHeight: -0.6,
  leftVel: 1,
  rightVel: 1,
});

describe('SwingMachine', () => {
  it('counts a full two-handed swing as one HIT', () => {
    const machine = new SwingMachine();
    expect(machine.update(REST, 0)).toBeNull();
    expect(machine.update(WOUND, 100)).toBeNull();
    expect(machine.currentPhase).toBe('windup');
    expect(machine.update(DROPPING_FAST, 200)).toBeNull();
    expect(machine.currentPhase).toBe('strike');
    const event = machine.update(CROSSED_FAST, 300);
    expect(event).toEqual({
      kind: 'hit',
      handedness: 'two-handed',
      message: 'HIT!',
    });
    expect(machine.currentPhase).toBe('recover');
  });

  it('accepts a single-arm overhead swing', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(makeBody({ leftHeight: 0.9 }), 100);
    expect(machine.currentPhase).toBe('windup');
    machine.update(
      makeBody({ leftHeight: 0.3, leftVel: 5 }),
      200,
    );
    const event = machine.update(
      makeBody({ leftHeight: -0.6, leftVel: 5 }),
      300,
    );
    expect(event?.kind).toBe('hit');
    if (event?.kind === 'hit') {
      expect(event.handedness).toBe('left');
    }
  });

  it('counts two arms swinging together as ONE hit, not two', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(WOUND, 100);
    machine.update(DROPPING_FAST, 200);
    const first = machine.update(CROSSED_FAST, 300);
    expect(first?.kind).toBe('hit');
    // Both arms still crossing on the next frames: still recovering.
    expect(machine.update(CROSSED_FAST, 400)).toBeNull();
    expect(machine.update(CROSSED_FAST, 500)).toBeNull();
  });

  it('rejects a partway raise dropped fast: "Swing bigger!"', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    // Raise partway: above the shoulders (0.4) but below windup (0.6).
    expect(
      machine.update(
        makeBody({ leftHeight: 0.4, rightHeight: 0.4 }),
        100,
      ),
    ).toBeNull();
    expect(machine.currentPhase).toBe('ready');
    // Drop fast through the attempt zone…
    expect(
      machine.update(
        makeBody({ leftHeight: 0.1, rightHeight: 0.1, leftVel: 5, rightVel: 5 }),
        200,
      ),
    ).toBeNull();
    // …back to rest: judged now.
    const event = machine.update(REST, 300);
    expect(event).toEqual({
      kind: 'weak',
      reason: 'too-small',
      message: 'Swing bigger!',
    });
  });

  it('rejects a windup dropped slowly: "Swing faster!"', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(WOUND, 100);
    // Drop slowly the whole way down past the strike line.
    machine.update(
      makeBody({ leftHeight: 0.3, rightHeight: 0.3, leftVel: 1, rightVel: 1 }),
      200,
    );
    expect(machine.currentPhase).toBe('windup');
    const event = machine.update(CROSSED_SLOW, 300);
    expect(event).toEqual({
      kind: 'weak',
      reason: 'too-slow',
      message: 'Swing faster!',
    });
  });

  it('says nothing when a partway raise is lowered slowly', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(
      makeBody({ leftHeight: 0.4, rightHeight: 0.4 }),
      100,
    );
    machine.update(
      makeBody({ leftHeight: 0.1, rightHeight: 0.1, leftVel: 1, rightVel: 1 }),
      200,
    );
    expect(machine.update(REST, 300)).toBeNull();
    expect(machine.snapshot().lastEvent).toBeNull();
  });

  it('says nothing for a fast drop that never rose at all', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    // Wrists never left rest height; velocity alone is not a swing.
    expect(
      machine.update(
        makeBody({ leftHeight: -0.9, rightHeight: -0.9, leftVel: 6, rightVel: 6 }),
        100,
      ),
    ).toBeNull();
  });

  it('blocks a double-count from one swing during the cooldown', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(WOUND, 100);
    machine.update(DROPPING_FAST, 200);
    const hit = machine.update(CROSSED_FAST, 300);
    expect(hit?.kind).toBe('hit');
    // Immediately wind up again, inside the cooldown: ignored.
    machine.update(WOUND, 400);
    machine.update(DROPPING_FAST, 500);
    expect(machine.update(CROSSED_FAST, 600)).toBeNull();
    expect(machine.currentPhase).toBe('recover');
    // After the cooldown (700ms from the hit at t=300) a new swing counts.
    machine.update(REST, 1100);
    expect(machine.currentPhase).toBe('ready');
    machine.update(WOUND, 1200);
    machine.update(DROPPING_FAST, 1300);
    expect(machine.update(CROSSED_FAST, 1400)?.kind).toBe('hit');
  });

  it('re-arms quickly after a weak swing (300ms, not the full cooldown)', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(
      makeBody({ leftHeight: 0.4, rightHeight: 0.4 }),
      100,
    );
    machine.update(
      makeBody({ leftHeight: 0.1, rightHeight: 0.1, leftVel: 5, rightVel: 5 }),
      200,
    );
    const weak = machine.update(REST, 300);
    expect(weak?.kind).toBe('weak');
    // 100ms later the machine still ignores input (re-arm window).
    machine.update(WOUND, 400);
    expect(machine.currentPhase).toBe('ready');
    // Past the 300ms re-arm, a full swing works again.
    machine.update(REST, 700);
    machine.update(WOUND, 800);
    machine.update(DROPPING_FAST, 900);
    expect(machine.update(CROSSED_FAST, 1000)?.kind).toBe('hit');
  });

  it('rejects a fast flick pulled back up before the strike line', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(WOUND, 100);
    // Fast drop, but stop above the line…
    machine.update(DROPPING_FAST, 200);
    expect(machine.currentPhase).toBe('strike');
    // …and pull both arms back up overhead without crossing.
    const event = machine.update(WOUND, 300);
    expect(event).toEqual({
      kind: 'weak',
      reason: 'too-small',
      message: 'Swing bigger!',
    });
  });

  it('produces no swing with no body, and resets cleanly', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(WOUND, 100);
    expect(machine.currentPhase).toBe('windup');
    expect(machine.update(null, 200)).toBeNull();
    expect(machine.currentPhase).toBe('ready');
    // A fresh swing works after the body returns.
    machine.update(WOUND, 300);
    machine.update(DROPPING_FAST, 400);
    expect(machine.update(CROSSED_FAST, 500)?.kind).toBe('hit');
  });

  it('lets the second arm join the windup late (still two-handed)', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(makeBody({ leftHeight: 0.9 }), 100);
    expect(machine.currentPhase).toBe('windup');
    machine.update(makeBody({ leftHeight: 0.9, rightHeight: 0.9 }), 200);
    machine.update(DROPPING_FAST, 300);
    const event = machine.update(CROSSED_FAST, 400);
    expect(event?.kind).toBe('hit');
    if (event?.kind === 'hit') {
      expect(event.handedness).toBe('two-handed');
    }
  });

  it('reports windup progress from the highest wrist', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(makeBody({ leftHeight: 0.3, rightHeight: 0.1 }), 100);
    expect(machine.snapshot().windupProgress).toBeCloseTo(
      0.3 / SWING.windupHeightTorsoFrac,
      5,
    );
    machine.update(WOUND, 200);
    expect(machine.snapshot().windupProgress).toBe(1);
    expect(machine.snapshot().leftVel).toBeCloseTo(0, 5);
  });

  it('exposes wrist velocities in torso lengths/sec for the HUD', () => {
    const machine = new SwingMachine();
    machine.update(
      makeBody({ leftHeight: 0.3, rightHeight: 0.3, leftVel: 4.5, rightVel: -2 }),
      0,
    );
    const snap = machine.snapshot();
    expect(snap.leftVel).toBeCloseTo(4.5, 5);
    expect(snap.rightVel).toBeCloseTo(-2, 5);
  });
});
