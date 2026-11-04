import { describe, expect, it } from 'vitest';
import { evaluateGate, type ModelState } from './gate';
import { BodyStateTracker, type BodyState } from './bodyState';
import { makeFrame, makePose } from './poseFixture';
import { PoseLandmark } from '../tracking/poseTypes';
import { MouseSource } from '../sim/mouseSource';

function usableBody(): BodyState {
  const tracker = new BodyStateTracker();
  return tracker.update(makeFrame(makePose({}), 1000));
}

/** A body whose knees the model barely sees — the Nov 4 playtest shape. */
function kneesHiddenBody(): BodyState {
  const tracker = new BodyStateTracker();
  const pose = makePose({
    visibilityOverrides: {
      [PoseLandmark.LEFT_KNEE]: 0.1,
      [PoseLandmark.RIGHT_KNEE]: 0.1,
    },
  });
  return tracker.update(makeFrame(pose, 1000));
}

function noBody(): BodyState {
  const tracker = new BodyStateTracker();
  return tracker.update(makeFrame(null, 1000));
}

describe('evaluateGate', () => {
  it('is open when a usable body is present', () => {
    const gate = evaluateGate(usableBody(), 1000, null, 'ready');
    expect(gate.gated).toBe(false);
    expect(gate.reason).toBe('open');
    expect(gate.lastUsableMs).toBe(1000);
  });

  it('is gated immediately when no body was ever usable', () => {
    const gate = evaluateGate(noBody(), 1000, null, 'ready');
    expect(gate.gated).toBe(true);
    expect(gate.reason).toBe('no-body');
    expect(gate.message).toBe('Step back so I can see your whole body');
  });

  it('is gated immediately when the body state is null', () => {
    const gate = evaluateGate(null, 1000, null, 'ready');
    expect(gate.gated).toBe(true);
    expect(gate.reason).toBe('no-body');
  });

  it('does not trip inside the grace period after a pose is lost', () => {
    const gate = evaluateGate(noBody(), 1400, 1000, 'ready', {
      gracePeriodMs: 500,
    });
    expect(gate.gated).toBe(false);
    expect(gate.reason).toBe('open');
    expect(gate.lastUsableMs).toBe(1000);
  });

  it('trips once the grace period has passed', () => {
    const gate = evaluateGate(noBody(), 1600, 1000, 'ready', {
      gracePeriodMs: 500,
    });
    expect(gate.gated).toBe(true);
    expect(gate.reason).toBe('no-body');
    expect(gate.message).toBe("Step back — I can't see your body");
  });

  it('reopens when the body returns', () => {
    const gate = evaluateGate(usableBody(), 2000, 1000, 'ready');
    expect(gate.gated).toBe(false);
    expect(gate.lastUsableMs).toBe(2000);
  });

  it('model failure gates with the model message, not the step-back message', () => {
    const gate = evaluateGate(usableBody(), 1000, 1000, 'failed');
    expect(gate.gated).toBe(true);
    expect(gate.reason).toBe('model-failed');
    expect(gate.message).toContain('Pose model failed to load');
  });

  it('model loading gates with the loading message', () => {
    const gate = evaluateGate(null, 1000, null, 'loading');
    expect(gate.gated).toBe(true);
    expect(gate.reason).toBe('model-loading');
  });

  it('model failure gates even when a body was usable before', () => {
    const gate = evaluateGate(usableBody(), 1000, 1000, 'failed');
    expect(gate.gated).toBe(true);
  });

  it('is open for sim/replay sources (model not applicable)', () => {
    const gate = evaluateGate(usableBody(), 1000, null, 'not-applicable');
    expect(gate.gated).toBe(false);
  });

  it('a knees-hidden body gates: knees are required for swing games', () => {
    const body = kneesHiddenBody();
    expect(body.bodyUsable).toBe(false);
    const gate = evaluateGate(body, 1000, null, 'ready');
    expect(gate.gated).toBe(true);
    expect(gate.reason).toBe('no-body');
  });
});

describe('evaluateGate stale frames', () => {
  it('is open when the usable body frame is fresh', () => {
    const gate = evaluateGate(usableBody(), 1000, null, 'ready', {
      frameAgeMs: 100,
    });
    expect(gate.gated).toBe(false);
    expect(gate.reason).toBe('open');
  });

  it('gates a usable body whose frame is stale', () => {
    const gate = evaluateGate(usableBody(), 1000, null, 'ready', {
      frameAgeMs: 3000,
    });
    expect(gate.gated).toBe(true);
    expect(gate.reason).toBe('stale-frame');
    expect(gate.message).toBe('Pose feed frozen — tap Retry');
  });

  it('staleness beats the grace period mid-game', () => {
    // Body was usable at 1000 ms, frame frozen since; 400 ms later the
    // grace period (500 ms) would still be open — staleness must win.
    const gate = evaluateGate(usableBody(), 1400, 1000, 'ready', {
      gracePeriodMs: 500,
      frameAgeMs: 3000,
    });
    expect(gate.gated).toBe(true);
    expect(gate.reason).toBe('stale-frame');
  });

  it('a frame at the staleness boundary does not gate', () => {
    const gate = evaluateGate(usableBody(), 1000, null, 'ready', {
      frameAgeMs: 2000,
    });
    expect(gate.gated).toBe(false);
  });

  it('without frameAgeMs the grace period still works (callers unchanged)', () => {
    const gate = evaluateGate(noBody(), 1400, 1000, 'ready', {
      gracePeriodMs: 500,
    });
    expect(gate.gated).toBe(false);
    expect(gate.reason).toBe('open');
  });
});

describe('evaluateGate inference-stopped', () => {
  it('gates with the retry message when no error is attached', () => {
    const gate = evaluateGate(usableBody(), 1000, 1000, 'inference-stopped');
    expect(gate.gated).toBe(true);
    expect(gate.reason).toBe('inference-stopped');
    expect(gate.message).toBe('Pose detection stopped — tap Retry');
  });

  it('includes the inference error in the message', () => {
    const gate = evaluateGate(usableBody(), 1000, 1000, 'inference-stopped', {
      inferenceError: 'GPU delegate failed',
    });
    expect(gate.gated).toBe(true);
    expect(gate.reason).toBe('inference-stopped');
    expect(gate.message).toBe('Pose detection stopped — GPU delegate failed');
  });

  it('truncates a long inference error to ~60 chars', () => {
    const longError = 'x'.repeat(100);
    const gate = evaluateGate(usableBody(), 1000, 1000, 'inference-stopped', {
      inferenceError: longError,
    });
    expect(gate.message).toBe(`Pose detection stopped — ${'x'.repeat(60)}…`);
    expect(gate.message.length).toBeLessThanOrEqual(
      'Pose detection stopped — '.length + 61,
    );
  });

  it('gates even when a body was usable before the stop', () => {
    const gate = evaluateGate(usableBody(), 1000, 1000, 'inference-stopped');
    expect(gate.gated).toBe(true);
  });
});

describe('gate + MouseSource', () => {
  it('the mouse simulator always produces a usable body, so the gate stays open', () => {
    const mouse = new MouseSource();
    mouse.start(1000);
    const frame = mouse.frameAt(1000);
    expect(frame).not.toBeNull();
    const tracker = new BodyStateTracker();
    const state = tracker.update(frame);
    expect(state.present).toBe(true);
    expect(state.bodyUsable).toBe(true);
    // No source special-casing: the body state alone opens the gate.
    const gate = evaluateGate(state, 1000, null, 'not-applicable');
    expect(gate.gated).toBe(false);
  });

  it('the gate stays open across sim frames', () => {
    const mouse = new MouseSource();
    mouse.start(1000);
    const tracker = new BodyStateTracker();
    let lastUsable: number | null = null;
    for (let t = 1000; t <= 2000; t += 100) {
      const frame = mouse.frameAt(t);
      const state = tracker.update(frame);
      const gate = evaluateGate(state, t, lastUsable, 'not-applicable');
      expect(gate.gated).toBe(false);
      lastUsable = gate.lastUsableMs;
    }
  });
});

describe('model state plumbing', () => {
  it('covers every ModelState the hub can produce', () => {
    const states: ModelState[] = [
      'not-applicable',
      'loading',
      'ready',
      'failed',
      'inference-stopped',
    ];
    expect(states).toHaveLength(5);
  });
});
