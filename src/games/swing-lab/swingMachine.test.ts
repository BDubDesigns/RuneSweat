import { describe, expect, it } from 'vitest';
import { SWING } from '../../core/config';
import {
  facingOkFor,
  SwingMachine,
  type SwingBodyInput,
} from './swingMachine';

/**
 * Synthetic body for the machine: heights in torso lengths above the
 * shoulder (+ = overhead, - = below), velocities in torso lengths/sec
 * (+ = moving down), wrist X offsets in torso lengths from the body
 * midline. The machine only reads wrist X/Y / velocity / shoulder Y /
 * torso length / shoulder width, so a fake body is exact here.
 */
function makeBody(options: {
  leftHeight?: number;
  rightHeight?: number;
  leftVel?: number;
  rightVel?: number;
  /** Wrist X offsets from the midline, in torso lengths. Default ±0.1: clasped. */
  leftWristXTorso?: number;
  rightWristXTorso?: number;
  shoulderWidthTorsoFrac?: number;
  /**
   * Nose offset from the shoulder midpoint, in torso lengths.
   * Default null: no nose reading, so the shoulder width decides
   * the facing check alone (as the real tracker reports when the
   * nose is not confidently visible).
   */
  noseOffsetTorsoFrac?: number | null;
  present?: boolean;
} = {}): SwingBodyInput {
  const torsoLength = 0.3;
  const shoulderY = 0.25;
  const midX = 0.5;
  const leftHeight = options.leftHeight ?? -1;
  const rightHeight = options.rightHeight ?? -1;
  return {
    present: options.present ?? true,
    torsoLength,
    shoulderY,
    leftWristX: midX + (options.leftWristXTorso ?? -0.1) * torsoLength,
    rightWristX: midX + (options.rightWristXTorso ?? 0.1) * torsoLength,
    leftWristY: shoulderY - leftHeight * torsoLength,
    rightWristY: shoulderY - rightHeight * torsoLength,
    leftWristVelY: (options.leftVel ?? 0) * torsoLength,
    rightWristVelY: (options.rightVel ?? 0) * torsoLength,
    shoulderWidthTorsoFrac: options.shoulderWidthTorsoFrac ?? 1.0,
    noseOffsetTorsoFrac: options.noseOffsetTorsoFrac ?? null,
  };
}

/** Rest pose: both arms hanging, still. */
const REST = makeBody();

/** Both arms overhead, hands clasped, still. */
const WOUND = makeBody({ leftHeight: 0.9, rightHeight: 0.9 });

/** Both arms dropping fast through mid-air (above the strike line). */
const DROPPING_FAST = makeBody({
  leftHeight: 0.3,
  rightHeight: 0.3,
  leftVel: 5,
  rightVel: 5,
});

/** Both arms past the strike line (waist level), still moving fast. */
const CROSSED_FAST = makeBody({
  leftHeight: -1.0,
  rightHeight: -1.0,
  leftVel: 5,
  rightVel: 5,
});

/** Both arms past the strike line, moving slowly. */
const CROSSED_SLOW = makeBody({
  leftHeight: -1.0,
  rightHeight: -1.0,
  leftVel: 1,
  rightVel: 1,
});

/**
 * Both arms at chest level (-0.6): above the v3 strike line (0.7), so a
 * chop that stops here must NOT count — but it is closer than the old
 * waist-level line (0.85), which is the point of the v3 raise.
 */
const AT_CHEST_FAST = makeBody({
  leftHeight: -0.6,
  rightHeight: -0.6,
  leftVel: 5,
  rightVel: 5,
});

/** Both arms past the v3 strike line (-0.75), still moving fast. */
const CROSSED_AT_NEW_LINE_FAST = makeBody({
  leftHeight: -0.75,
  rightHeight: -0.75,
  leftVel: 5,
  rightVel: 5,
});

/** Wrists a shoulder-width apart (0.8 torso lengths): hands NOT together. */
function handsApart(options: {
  leftHeight?: number;
  rightHeight?: number;
  leftVel?: number;
  rightVel?: number;
} = {}): SwingBodyInput {
  return makeBody({
    ...options,
    leftWristXTorso: -0.4,
    rightWristXTorso: 0.4,
  });
}

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

  it('does NOT wind up on one arm alone, and a solo drop is "Both hands together!"', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    // One wrist overhead, the other at rest: no windup yet — wait.
    expect(
      machine.update(makeBody({ leftHeight: 0.9 }), 100),
    ).toBeNull();
    expect(machine.currentPhase).toBe('ready');
    expect(
      machine.update(makeBody({ leftHeight: 0.3, leftVel: 5 }), 200),
    ).toBeNull();
    expect(machine.currentPhase).toBe('ready');
    // The solo arm completes a full fast drop through the strike line.
    const event = machine.update(
      makeBody({ leftHeight: -1.0, leftVel: 5 }),
      300,
    );
    expect(event).toEqual({
      kind: 'weak',
      reason: 'hands-apart',
      message: 'Both hands together!',
    });
  });

  it('says nothing when a solo arm is lowered slowly', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(makeBody({ leftHeight: 0.9 }), 100);
    machine.update(makeBody({ leftHeight: 0.3, leftVel: 1 }), 200);
    expect(machine.update(makeBody({ leftHeight: -1.0, leftVel: 1 }), 300)).toBeNull();
    expect(machine.snapshot().lastEvent).toBeNull();
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

  it('rejects a partway pair raise dropped fast: "Swing bigger!"', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    // Raise BOTH partway: above the shoulders (0.4) but below windup (0.6).
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
    // The detail names the miss: highest 0.4 of the 0.6 windup.
    expect(machine.snapshot().lastWeakDetail).toContain('never wound');
    expect(machine.snapshot().lastWeakDetail).toContain('highest 0.40');
  });

  it('says nothing for a partway raise of ONE arm dropped fast', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    // Only the left arm rises partway; the right never leaves rest.
    machine.update(makeBody({ leftHeight: 0.4 }), 100);
    machine.update(
      makeBody({ leftHeight: 0.1, leftVel: 5 }),
      200,
    );
    expect(machine.update(REST, 300)).toBeNull();
    expect(machine.snapshot().lastEvent).toBeNull();
  });

  it('rejects a windup dropped slowly: "Swing faster!" with the measured peak', () => {
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
    // The snapshot carries the evidence: peak 1.0 vs the 2.5 threshold.
    expect(machine.snapshot().lastWeakDetail).toBe(
      `peak 1.0 torso/s, need ${SWING.strikeVelocityTorsoFracPerSec}`,
    );
  });

  it('counts a chop at peak 2.7 torso/s (above the loosened 2.5 line)', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(WOUND, 100);
    machine.update(
      makeBody({ leftHeight: 0.3, rightHeight: 0.3, leftVel: 2.7, rightVel: 2.7 }),
      200,
    );
    // 2.7 would have failed the old 3.0 threshold; the v3 loosen is
    // what counts it.
    const event = machine.update(
      makeBody({ leftHeight: -1.0, rightHeight: -1.0, leftVel: 2.7, rightVel: 2.7 }),
      300,
    );
    expect(event?.kind).toBe('hit');
  });

  it('still rejects a chop at peak 2.0 torso/s as too slow', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(WOUND, 100);
    machine.update(
      makeBody({ leftHeight: 0.3, rightHeight: 0.3, leftVel: 2.0, rightVel: 2.0 }),
      200,
    );
    const event = machine.update(
      makeBody({ leftHeight: -1.0, rightHeight: -1.0, leftVel: 2.0, rightVel: 2.0 }),
      300,
    );
    expect(event).toEqual({
      kind: 'weak',
      reason: 'too-slow',
      message: 'Swing faster!',
    });
    expect(machine.snapshot().lastWeakDetail).toContain('peak 2.0 torso/s');
  });

  it('judges the pair on the SLOWER arm: one fast arm cannot carry the swing', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(WOUND, 100);
    // Left chops fast, right drifts down slowly.
    machine.update(
      makeBody({ leftHeight: 0.3, rightHeight: 0.3, leftVel: 6, rightVel: 1 }),
      200,
    );
    const event = machine.update(
      makeBody({ leftHeight: -1.0, rightHeight: -1.0, leftVel: 6, rightVel: 1 }),
      300,
    );
    expect(event).toEqual({
      kind: 'weak',
      reason: 'too-slow',
      message: 'Swing faster!',
    });
  });

  it('says nothing when a partway pair raise is lowered slowly', () => {
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

  it('rejects a wound pair that separates during the drop: "Both hands together!" with the gap', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(WOUND, 100);
    // Hands clasped at the top, apart by mid-drop while chopping fast.
    const event = machine.update(
      handsApart({ leftHeight: 0.3, rightHeight: 0.3, leftVel: 5, rightVel: 5 }),
      200,
    );
    expect(event).toEqual({
      kind: 'weak',
      reason: 'hands-apart',
      message: 'Both hands together!',
    });
    // Wrists 0.8 torso apart vs the 0.5 limit: the gap is the evidence.
    expect(machine.snapshot().lastWeakDetail).toContain('gap 0.80 torso');
  });

  it('rejects hands apart at the strike line, even on a slow drop', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(WOUND, 100);
    // Slow drop, hands together: no separation event mid-drop…
    expect(
      machine.update(
        makeBody({ leftHeight: 0.3, rightHeight: 0.3, leftVel: 1, rightVel: 1 }),
        200,
      ),
    ).toBeNull();
    // …but the wrists are apart when they cross the line.
    const event = machine.update(
      handsApart({ leftHeight: -1.0, rightHeight: -1.0, leftVel: 1, rightVel: 1 }),
      300,
    );
    expect(event).toEqual({
      kind: 'weak',
      reason: 'hands-apart',
      message: 'Both hands together!',
    });
  });

  it('rejects one wrist crossing while the other stays up overhead', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(WOUND, 100);
    machine.update(DROPPING_FAST, 200);
    // Left hand drops to the waist; right hand stays overhead: split.
    const event = machine.update(
      makeBody({ leftHeight: -1.0, rightHeight: 0.9, leftVel: 5, rightVel: 0 }),
      300,
    );
    expect(event).toEqual({
      kind: 'weak',
      reason: 'hands-apart',
      message: 'Both hands together!',
    });
  });

  it('does NOT count a chop that stops at chest level (-0.6, above the 0.7 line)', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(WOUND, 100);
    machine.update(DROPPING_FAST, 200);
    expect(machine.currentPhase).toBe('strike');
    // -0.6 has not crossed the v3 line (0.7).
    expect(machine.update(AT_CHEST_FAST, 300)).toBeNull();
    expect(machine.currentPhase).toBe('strike');
    // Following through to the waist counts.
    expect(machine.update(CROSSED_FAST, 400)?.kind).toBe('hit');
  });

  it('counts a swing finishing at the raised strike line (-0.75 past 0.7)', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(WOUND, 100);
    machine.update(DROPPING_FAST, 200);
    expect(machine.currentPhase).toBe('strike');
    // -0.75 crosses the v3 line (0.7) but would NOT have crossed the
    // old waist line (0.85): the v3 raise is what counts this chop.
    const event = machine.update(CROSSED_AT_NEW_LINE_FAST, 300);
    expect(event?.kind).toBe('hit');
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

  it('rejects a fast flick pulled back up before the strike line: "Follow through!"', () => {
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
      message: 'Follow through!',
    });
    // Distinct from "Swing bigger!" (never wound): this one wound and
    // pulled back. The detail says so.
    expect(machine.snapshot().lastWeakDetail).toContain('pulled back overhead');
  });

  it('does NOT call a settled windup starting its drop a flick', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(WOUND, 100);
    // A ~0.5 s hold: the wrists are settled overhead, then the drop
    // starts fast — but the first fast frames still read ABOVE the
    // windup line. v1 misread that as "pulled back up" and swallowed
    // the swing with "Swing bigger!".
    expect(
      machine.update(
        makeBody({ leftHeight: 0.8, rightHeight: 0.8, leftVel: 5, rightVel: 5 }),
        200,
      ),
    ).toBeNull();
    expect(machine.currentPhase).toBe('strike');
    expect(
      machine.update(
        makeBody({ leftHeight: 0.7, rightHeight: 0.7, leftVel: 5, rightVel: 5 }),
        300,
      ),
    ).toBeNull();
    expect(machine.currentPhase).toBe('strike');
    machine.update(DROPPING_FAST, 400);
    expect(machine.update(CROSSED_FAST, 500)?.kind).toBe('hit');
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
    // One arm up alone: no windup yet — the machine waits.
    machine.update(makeBody({ leftHeight: 0.9 }), 100);
    expect(machine.currentPhase).toBe('ready');
    // The second arm joins: now the pair is wound.
    machine.update(makeBody({ leftHeight: 0.9, rightHeight: 0.9 }), 200);
    expect(machine.currentPhase).toBe('windup');
    machine.update(DROPPING_FAST, 300);
    const event = machine.update(CROSSED_FAST, 400);
    expect(event?.kind).toBe('hit');
    if (event?.kind === 'hit') {
      expect(event.handedness).toBe('two-handed');
    }
  });

  it('reports windup progress from the LOWER wrist', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    // Left is at 0.3, right only at 0.1: the pair is only as wound as
    // its lower hand.
    machine.update(makeBody({ leftHeight: 0.3, rightHeight: 0.1 }), 100);
    expect(machine.snapshot().windupProgress).toBeCloseTo(
      0.1 / SWING.windupHeightTorsoFrac,
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

  it('says nothing when the pair hovers overhead with hands apart and still', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(WOUND, 100);
    // Arms spread wide at the top but not moving: no swing in flight,
    // so no hands-apart feedback yet — that fires on the drop.
    expect(
      machine.update(
        handsApart({ leftHeight: 0.9, rightHeight: 0.9 }),
        200,
      ),
    ).toBeNull();
    expect(machine.currentPhase).toBe('windup');
  });
});

describe('facingOkFor', () => {
  it('is true with no body (null width)', () => {
    expect(facingOkFor(null)).toBe(true);
  });

  it('is true front-facing, at the v3 threshold, and false in profile', () => {
    expect(facingOkFor(1.0)).toBe(true);
    expect(facingOkFor(0.73)).toBe(true);
    expect(facingOkFor(0.5)).toBe(true);
    expect(facingOkFor(0.49)).toBe(false);
    expect(facingOkFor(0.3)).toBe(false);
  });

  it('lets a centred nose veto a narrow shoulder reading (t30/t66)', () => {
    // Front-facing, shoulders reading narrow, nose on the midline:
    // the Nov 4 frames showed this exact shape firing the hint.
    expect(facingOkFor(0.3, 0.05)).toBe(true);
    expect(facingOkFor(0.3, 0.2)).toBe(true);
  });

  it('still warns when narrow shoulders AND the nose is off to the side', () => {
    expect(facingOkFor(0.3, 0.3)).toBe(false);
    expect(facingOkFor(0.3, 0.5)).toBe(false);
  });

  it('falls back to the width alone when the nose is not visible', () => {
    expect(facingOkFor(0.3, null)).toBe(false);
    expect(facingOkFor(0.73, null)).toBe(true);
  });
});

describe('SwingMachine facingOk snapshot', () => {
  it('is true with no body and front-facing, false when turned sideways', () => {
    const machine = new SwingMachine();
    expect(machine.snapshot().facingOk).toBe(true);
    machine.update(REST, 0);
    expect(machine.snapshot().facingOk).toBe(true);
    machine.update(makeBody({ shoulderWidthTorsoFrac: 0.3 }), 100);
    // Debounce: one bad frame does not show the hint yet.
    expect(machine.snapshot().facingOk).toBe(true);
    // Sustained past the 500ms debounce, the hint shows.
    machine.update(makeBody({ shoulderWidthTorsoFrac: 0.3 }), 700);
    expect(machine.snapshot().facingOk).toBe(false);
    expect(machine.update(null, 800)).toBeNull();
    expect(machine.snapshot().facingOk).toBe(true);
  });

  it('does NOT show the hint for a brief dip below the threshold', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    // 300ms of narrow shoulders: under the 500ms debounce.
    machine.update(makeBody({ shoulderWidthTorsoFrac: 0.3 }), 100);
    machine.update(makeBody({ shoulderWidthTorsoFrac: 0.3 }), 300);
    expect(machine.snapshot().facingOk).toBe(true);
    // Back to front-facing before the debounce elapses: no hint, and
    // the streak resets — a later dip starts the clock again.
    machine.update(REST, 400);
    expect(machine.snapshot().facingOk).toBe(true);
    machine.update(makeBody({ shoulderWidthTorsoFrac: 0.3 }), 500);
    expect(machine.snapshot().facingOk).toBe(true);
  });

  it('clears the hint the moment a good reading returns', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(makeBody({ shoulderWidthTorsoFrac: 0.3 }), 100);
    machine.update(makeBody({ shoulderWidthTorsoFrac: 0.3 }), 700);
    expect(machine.snapshot().facingOk).toBe(false);
    machine.update(REST, 800);
    expect(machine.snapshot().facingOk).toBe(true);
  });

  it('stays silent for narrow shoulders with a centred nose, however long', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    // The t30/t66 shape, held for 2 seconds: narrow shoulders, nose
    // on the midline. The nose vetoes the hint outright.
    for (let t = 100; t <= 2000; t += 100) {
      machine.update(
        makeBody({ shoulderWidthTorsoFrac: 0.3, noseOffsetTorsoFrac: 0.05 }),
        t,
      );
    }
    expect(machine.snapshot().facingOk).toBe(true);
  });

  it('shows the hint for narrow shoulders with the nose off to the side', () => {
    const machine = new SwingMachine();
    machine.update(REST, 0);
    machine.update(
      makeBody({ shoulderWidthTorsoFrac: 0.3, noseOffsetTorsoFrac: 0.35 }),
      100,
    );
    machine.update(
      makeBody({ shoulderWidthTorsoFrac: 0.3, noseOffsetTorsoFrac: 0.35 }),
      700,
    );
    expect(machine.snapshot().facingOk).toBe(false);
  });
});
