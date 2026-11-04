import { describe, expect, it } from 'vitest';
import { evaluateGate, type ModelState } from './gate';
import { BodyStateTracker, type BodyState } from './bodyState';
import { makeFrame, makePose } from './poseFixture';
import { MouseSource } from '../sim/mouseSource';

function usableBody(): BodyState {
  const tracker = new BodyStateTracker();
  return tracker.update(makeFrame(makePose({}), 1000));
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
    const states: ModelState[] = ['not-applicable', 'loading', 'ready', 'failed'];
    expect(states).toHaveLength(4);
  });
});
