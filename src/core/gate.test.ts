import { describe, expect, it } from 'vitest';
import {
  bodyUsableForActivity,
  evaluateGate,
  gateRequirementsFor,
  missingBodyParts,
  shouldShowGateBanner,
  type ModelState,
} from './gate';
import { ActionButtonDwell, actionButtonGeometry, pointInActionCircle } from './actionButton';
import { BodyStateTracker, type BodyState } from './bodyState';
import { makeFrame, makePose } from './poseFixture';
import { confirmHandPoint, PointerController, pointerHandPoint } from './pointer';
import { PoseLandmark } from '../tracking/poseTypes';
import { toCanvas } from '../render/stage';
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

  it('a knees-hidden body passes: knees are not a gate input (v3.7)', () => {
    const body = kneesHiddenBody();
    expect(body.kneesVisible).toBe(false);
    expect(body.bodyUsable).toBe(true);
    // The global fallback (no requirements) is the shoulders + hips
    // rule too, so the knees-hidden body opens the gate outright.
    const gate = evaluateGate(body, 1000, null, 'ready');
    expect(gate.gated).toBe(false);
    expect(gate.reason).toBe('open');
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

/**
 * Banner vs full overlay (v3.2, Nov 4 playtest): a lost body while an
 * activity screen is up shows only a small top banner — the full dim
 * + ghost covered the recipe picker, tier chips and Leave control.
 * Model problems always keep the loud full overlay.
 */
describe('shouldShowGateBanner', () => {
  it('banners a lost body while an activity screen is up', () => {
    expect(
      shouldShowGateBanner({ reason: 'no-body', activityScreenUp: true }),
    ).toBe(true);
  });

  it('keeps the full overlay (with ghost) on an empty stage', () => {
    expect(
      shouldShowGateBanner({ reason: 'no-body', activityScreenUp: false }),
    ).toBe(false);
  });

  it('never banners a model problem, even with an activity screen up', () => {
    for (const reason of [
      'model-failed',
      'model-loading',
      'inference-stopped',
      'stale-frame',
    ] as const) {
      expect(shouldShowGateBanner({ reason, activityScreenUp: true })).toBe(
        false,
      );
    }
  });

  it('never banners an open gate', () => {
    expect(
      shouldShowGateBanner({ reason: 'open', activityScreenUp: true }),
    ).toBe(false);
  });
});

/**
 * Per-activity gate requirements (v3.2, Nov 4 playtest; knees dropped
 * for every activity in v3.7, Nov 5): the refining gate kept firing
 * while Brandon was standing right there — the global rule required
 * knees, and a side reach dipped the far knee. The refiner dropped
 * the knee requirement first; the v3.6 playtest showed the swing
 * failing the same way at the top of a reach for the action circle,
 * so v3.7 drops knees everywhere. What differs per activity now is
 * only the grace: swing 500 ms, refiner 1500 ms; the picker has no
 * gate at all.
 */
describe('per-activity gate requirements (v3.2, knees dropped v3.7)', () => {
  /** A body whose shoulders the model barely sees. */
  function shouldersHiddenBody(): BodyState {
    const tracker = new BodyStateTracker();
    const pose = makePose({
      visibilityOverrides: {
        [PoseLandmark.LEFT_SHOULDER]: 0.1,
        [PoseLandmark.RIGHT_SHOULDER]: 0.1,
      },
    });
    return tracker.update(makeFrame(pose, 1000));
  }

  /** A body whose hips the model barely sees. */
  function hipsHiddenBody(): BodyState {
    const tracker = new BodyStateTracker();
    const pose = makePose({
      visibilityOverrides: {
        [PoseLandmark.LEFT_HIP]: 0.1,
        [PoseLandmark.RIGHT_HIP]: 0.1,
      },
    });
    return tracker.update(makeFrame(pose, 1000));
  }

  it('gateRequirementsFor returns the per-activity presets', () => {
    expect(gateRequirementsFor('swing')).toEqual({
      gracePeriodMs: 500,
    });
    expect(gateRequirementsFor('refiner-carry')).toEqual({
      gracePeriodMs: 1500,
    });
    expect(gateRequirementsFor('refiner-press')).toEqual({
      gracePeriodMs: 1500,
    });
    expect(gateRequirementsFor('picker')).toBeNull();
  });

  it('swing AND refiner open with knees hidden (v3.7)', () => {
    const body = kneesHiddenBody();
    expect(body.kneesVisible).toBe(false);
    expect(bodyUsableForActivity(body)).toBe(true);
    // End to end: both gates open on the same body.
    const carry = evaluateGate(body, 1000, null, 'ready', {
      requirements: gateRequirementsFor('refiner-carry'),
    });
    expect(carry.gated).toBe(false);
    expect(carry.reason).toBe('open');
    const swing = evaluateGate(body, 1000, null, 'ready', {
      requirements: gateRequirementsFor('swing'),
    });
    expect(swing.gated).toBe(false);
    expect(swing.reason).toBe('open');
  });

  it('the gate still fails when shoulders or hips are hidden', () => {
    for (const body of [shouldersHiddenBody(), hipsHiddenBody()]) {
      expect(bodyUsableForActivity(body)).toBe(false);
      for (const activity of ['swing', 'refiner-carry', 'refiner-press'] as const) {
        const gate = evaluateGate(body, 1000, null, 'ready', {
          requirements: gateRequirementsFor(activity),
        });
        expect(gate.gated).toBe(true);
        expect(gate.reason).toBe('no-body');
      }
      // And the global fallback (no requirements) fails too.
      expect(evaluateGate(body, 1000, null, 'ready').gated).toBe(true);
    }
  });

  it('the pedestal-press phase uses the same carry rule (the buttons are the detector’s job)', () => {
    const body = kneesHiddenBody();
    const gate = evaluateGate(body, 1000, null, 'ready', {
      requirements: gateRequirementsFor('refiner-press'),
    });
    expect(gate.gated).toBe(false);
  });

  it('refiner grace is 1500 ms; swing grace stays 500 ms', () => {
    const carryReq = gateRequirementsFor('refiner-carry');
    const swingReq = gateRequirementsFor('swing');
    // 1400 ms after the last usable frame: both still open.
    expect(
      evaluateGate(noBody(), 2400, 1000, 'ready', {
        requirements: carryReq,
      }).gated,
    ).toBe(false);
    expect(
      evaluateGate(noBody(), 1400, 1000, 'ready', {
        requirements: swingReq,
      }).gated,
    ).toBe(false);
    // 1500 ms after: the swing tripped long ago, the refiner is still
    // open (the grace is inclusive: 1500 <= 1500).
    expect(
      evaluateGate(noBody(), 2500, 1000, 'ready', {
        requirements: carryReq,
      }).gated,
    ).toBe(false);
    expect(
      evaluateGate(noBody(), 1600, 1000, 'ready', {
        requirements: swingReq,
      }).gated,
    ).toBe(true);
    // Past the refiner grace it trips too.
    expect(
      evaluateGate(noBody(), 2501, 1000, 'ready', {
        requirements: carryReq,
      }).gated,
    ).toBe(true);
  });

  it('an explicit gracePeriodMs still overrides the requirement grace', () => {
    expect(
      evaluateGate(noBody(), 1600, 1000, 'ready', {
        requirements: gateRequirementsFor('refiner-carry'),
        gracePeriodMs: 500,
      }).gated,
    ).toBe(true);
  });

  it('the picker has no gate: open with no body, a failed model, a frozen feed', () => {
    for (const model of ['ready', 'failed', 'loading'] as const) {
      const gate = evaluateGate(noBody(), 1000, 1000, model, {
        requirements: gateRequirementsFor('picker'),
        frameAgeMs: 3000,
      });
      expect(gate.gated).toBe(false);
      expect(gate.reason).toBe('open');
      // The grace clock is not advanced by the picker.
      expect(gate.lastUsableMs).toBe(1000);
    }
  });

  it('a frozen feed still closes the refiner gate (stale rule untouched)', () => {
    const gate = evaluateGate(usableBody(), 1000, null, 'ready', {
      requirements: gateRequirementsFor('refiner-carry'),
      frameAgeMs: 3000,
    });
    expect(gate.gated).toBe(true);
    expect(gate.reason).toBe('stale-frame');
  });

  it('the no-body message names the missing landmarks — never knees', () => {
    const shoulders = evaluateGate(shouldersHiddenBody(), 1000, null, 'ready', {
      requirements: gateRequirementsFor('swing'),
    });
    expect(shoulders.message).toBe(
      "I can't see your shoulders — step back",
    );
    const hips = evaluateGate(hipsHiddenBody(), 1000, null, 'ready', {
      requirements: gateRequirementsFor('swing'),
    });
    expect(hips.message).toBe("I can't see your hips — step back");
    // A lost body mid-game names what is missing too, not the generic line.
    const lost = evaluateGate(shouldersHiddenBody(), 2000, 1000, 'ready', {
      requirements: gateRequirementsFor('swing'),
    });
    expect(lost.gated).toBe(true);
    expect(lost.message).toBe("I can't see your shoulders — step back");
    // Knees hidden is not a missing part at all: the gate is open, so
    // there is no message — and no gate message anywhere names knees.
    const knees = evaluateGate(kneesHiddenBody(), 1000, null, 'ready', {
      requirements: gateRequirementsFor('swing'),
    });
    expect(knees.gated).toBe(false);
    expect(knees.message).toBe('');
    for (const body of [kneesHiddenBody(), shouldersHiddenBody(), hipsHiddenBody(), noBody()]) {
      for (const activity of ['swing', 'refiner-carry', 'refiner-press'] as const) {
        const gate = evaluateGate(body, 1000, null, 'ready', {
          requirements: gateRequirementsFor(activity),
        });
        expect(gate.message.toLowerCase()).not.toContain('knee');
      }
      expect(
        evaluateGate(body, 1000, null, 'ready').message.toLowerCase(),
      ).not.toContain('knee');
    }
    // No body at all keeps the generic lines (existing contract).
    expect(
      evaluateGate(noBody(), 1000, null, 'ready').message,
    ).toBe('Step back so I can see your whole body');
    expect(
      evaluateGate(noBody(), 1600, 1000, 'ready', { gracePeriodMs: 500 })
        .message,
    ).toBe("Step back — I can't see your body");
  });

  it('missingBodyParts lists what is missing (knees never listed)', () => {
    const body = kneesHiddenBody();
    expect(missingBodyParts(body)).toEqual([]);
    expect(missingBodyParts(shouldersHiddenBody())).toEqual(['shoulders']);
    expect(missingBodyParts(hipsHiddenBody())).toEqual(['hips']);
    expect(missingBodyParts(null)).toEqual([]);
  });
});

/**
 * Upper-body-only gate + action-button hover/dwell (v3.7, Nov 5):
 * the v3.6 playtest failure was Brandon reaching up to the top-right
 * action circle, his knees leaving the frame, the gate tripping, and
 * the hover/dwell doing nothing. `main.ts` only hands the pointer a
 * point (and the dwell a confirm point) while `!currentGate.gated`,
 * so the gate opening with knees hidden IS the hover/dwell fix —
 * these tests drive the same chain the hub runs: gate -> pointer
 * point -> hover -> confirm point in the circle -> dwell fires.
 */
describe('v3.7: knees-hidden body can hover the action circle and dwell to town', () => {
  /**
   * Brandon's reach shape: standing left of centre, right arm up
   * toward the top-right circle, knees out of frame. The fixture
   * math puts the smoothed right wrist at canvas ~(888, 57) on a
   * 960x540 stage — inside the (888, 84) r36 circle — and the left
   * (pointer) wrist mid-stage.
   */
  function reachingBody(): BodyState {
    const tracker = new BodyStateTracker();
    let state: BodyState | null = null;
    for (let t = 1000; t <= 1100; t += 33) {
      const pose = makePose({
        torsoX: 0.25,
        rightArmDeg: -63,
        visibilityOverrides: {
          [PoseLandmark.LEFT_KNEE]: 0.1,
          [PoseLandmark.RIGHT_KNEE]: 0.1,
        },
      });
      state = tracker.update(makeFrame(pose, t));
    }
    if (state === null) throw new Error('unreachable');
    return state;
  }

  it('the swing gate opens for the reaching body (knees hidden)', () => {
    const body = reachingBody();
    expect(body.kneesVisible).toBe(false);
    const gate = evaluateGate(body, 1100, null, 'ready', {
      requirements: gateRequirementsFor('swing'),
    });
    expect(gate.gated).toBe(false);
    expect(gate.reason).toBe('open');
  });

  it('the pointer hand hovers while knees are hidden', () => {
    const body = reachingBody();
    const gate = evaluateGate(body, 1100, null, 'ready', {
      requirements: gateRequirementsFor('swing'),
    });
    // main.ts hands the pointer a point only while the gate is open.
    const point = gate.gated
      ? null
      : toCanvas(
          { ...pointerHandPoint(body), visibility: 1 },
          960,
          540,
        );
    expect(point).not.toBeNull();
    const pointer = new PointerController();
    const selectable = {
      id: 'recipe:refined-ferrite',
      x: (point?.x ?? 0) - 50,
      y: (point?.y ?? 0) - 30,
      w: 100,
      h: 60,
    };
    pointer.update(point, [selectable]);
    expect(pointer.hoveredId).toBe('recipe:refined-ferrite');
  });

  it('the confirm hand dwells inside the top-right circle and fires (town mode)', () => {
    const body = reachingBody();
    const gate = evaluateGate(body, 1100, null, 'ready', {
      requirements: gateRequirementsFor('swing'),
    });
    expect(gate.gated).toBe(false);
    const geometry = actionButtonGeometry(960, 540);
    // main.ts hands the dwell a confirm point only while ungated.
    const confirm = gate.gated
      ? null
      : toCanvas(
          { ...confirmHandPoint(body), visibility: 1 },
          960,
          540,
        );
    expect(confirm).not.toBeNull();
    // Genuinely reaching up-right, not just anywhere on stage.
    expect(confirm?.x ?? 0).toBeGreaterThan(800);
    expect(confirm?.y ?? 0).toBeLessThan(150);
    const inside = pointInActionCircle(confirm?.x ?? 0, confirm?.y ?? 0, geometry);
    expect(inside).toBe(true);
    // Nothing hovered, so the circle is in town mode — the dwell
    // firing is the "go to town" action (main.ts fires it).
    const dwell = new ActionButtonDwell();
    expect(dwell.update(inside, 1100)).toBe(false);
    expect(dwell.update(inside, 2000)).toBe(false);
    expect(dwell.progress(2000)).toBeGreaterThan(0);
    expect(dwell.update(inside, 3099)).toBe(false);
    expect(dwell.update(inside, 3100)).toBe(true);
  });

  it('a gated body gets no pointer point and no dwell (shoulders hidden)', () => {
    const tracker = new BodyStateTracker();
    const pose = makePose({
      torsoX: 0.25,
      rightArmDeg: -63,
      visibilityOverrides: {
        [PoseLandmark.LEFT_SHOULDER]: 0.1,
        [PoseLandmark.RIGHT_SHOULDER]: 0.1,
      },
    });
    const body = tracker.update(makeFrame(pose, 1000));
    const gate = evaluateGate(body, 1000, null, 'ready', {
      requirements: gateRequirementsFor('swing'),
    });
    expect(gate.gated).toBe(true);
    // main.ts nulls the point when gated: hover clears, dwell starves.
    const pointer = new PointerController();
    pointer.update({ x: 800, y: 300 }, [
      { id: 'mine', x: 750, y: 270, w: 100, h: 60 },
    ]);
    expect(pointer.hoveredId).toBe('mine');
    pointer.update(null, [{ id: 'mine', x: 750, y: 270, w: 100, h: 60 }]);
    expect(pointer.hoveredId).toBeNull();
    const dwell = new ActionButtonDwell();
    expect(dwell.update(false, 1000)).toBe(false);
    expect(dwell.update(false, 4000)).toBe(false);
  });
});
