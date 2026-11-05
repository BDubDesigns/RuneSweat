import { beforeEach, describe, expect, it } from 'vitest';
import { SoundEffects } from '../../core/audio';
import { PRESS, SIM } from '../../core/config';
import type { BodyState } from '../../core/bodyState';
import { BodyStateTracker } from '../../core/bodyState';
import { pressButtonZones } from '../../core/pressDetector';
import { inventory } from '../../core/inventory';
import { MouseSource } from '../../sim/mouseSource';
import {
  PEDESTAL_STYLE,
  PICKER_CARD,
  RefinerGame,
  hopperLabelRect,
  hopperZoneForStage,
  leaveChipRect,
  pedestalRectsForStage,
  pickerCardLayout,
  pileLabelRect,
  pileZoneForStage,
  rectsIntersect,
  simTorsoBox,
} from './refiner';
import { GATE_BANNER, gateBannerRect } from '../../render/renderer';
import { BUTTON_STYLES } from '../../hub/townHub';

const PILE = pileZoneForStage(960, 540);
const HOPPER = hopperZoneForStage(960, 540);

/** Canvas point -> normalized video coords (toCanvas is mirrored in x). */
function toVideo(canvasX: number, canvasY: number): { x: number; y: number } {
  return { x: 1 - canvasX / 960, y: canvasY / 540 };
}

/**
 * Synthetic body for the game: both wrists at one canvas point
 * (hands together), or a pedestal-press shape. The game only reads
 * wrist X/Y + hip-mid + torso length + jumping, so a fake body is
 * exact here. Hip-mid is `torsoX`/`torsoY` (BodyState carries the
 * smoothed hip-midpoint directly — there are no per-hip fields).
 */
function makeBody(options: {
  handCanvas?: { x: number; y: number };
} = {}): BodyState {
  const hand = options.handCanvas ?? { x: 480, y: 300 };
  const video = toVideo(hand.x, hand.y);
  const torsoLength = 0.3;
  return {
    present: true,
    torsoLength,
    torsoX: 0.5,
    torsoY: 0.55,
    shoulderY: 0.25,
    leftWristX: video.x,
    rightWristX: video.x,
    leftWristY: video.y,
    rightWristY: video.y,
    jumping: false,
    ankleSpreadTorsoFrac: 0.59,
  } as unknown as BodyState;
}

/**
 * Press body for the game: both wrists inside the detector's button
 * zones, moving downward into the pressed position, then holding.
 * Geometry comes from `pressButtonZones` (hip-mid (0.5, 0.55),
 * torso 0.3) — never hard-coded — so it follows the zones whatever
 * size Worker A lands: v3.4 zones were left x 0.185..0.335, right x
 * 0.665..0.815, y 0.505..0.625; v3.5 shrinks them toward hip-mid
 * ±0.5 torso. `elapsedMs` is ms since this press started: the
 * wrists travel from the zone top down to the pressed depth (hip
 * line + `PRESS.pressDepthTorsoFrac`, clamped inside the zone) over
 * the first frames, then hold still. The detector needs downward
 * motion at some point in the hold + a 300 ms hold, so each press
 * is held ~900 ms in the tests.
 */
function pressBody(elapsedMs: number): BodyState {
  const zones = pressButtonZones(0.5, 0.55, 0.3);
  const pressedY = Math.min(
    zones.left.y + zones.left.h - 0.001,
    0.55 + PRESS.pressDepthTorsoFrac * 0.3,
  );
  const frames = Math.floor(elapsedMs / 16);
  const y = Math.min(pressedY, zones.left.y + 0.005 * frames);
  return {
    present: true,
    torsoLength: 0.3,
    torsoX: 0.5,
    torsoY: 0.55,
    shoulderY: 0.25,
    leftWristX: zones.left.x + zones.left.w / 2,
    rightWristX: zones.right.x + zones.right.w / 2,
    leftWristY: y,
    rightWristY: y,
    jumping: false,
    ankleSpreadTorsoFrac: 0.59,
  } as unknown as BodyState;
}

/**
 * Press body at the OLD v3.4 far-out positions: wrists at hip-mid
 * ±0.8 torso, travelling from the old zone top (hip − 0.15 torso)
 * down to the old pressed depth (hip + 0.12 torso). Once the v3.5
 * zones shrink, these wrists sit outside the buttons and must not
 * count — that is the regression this pins. While the config still
 * carries the v3.4 numbers the old positions ARE the zones, so the
 * same body counts one press; the test below reads the live zones
 * to decide which outcome to expect.
 */
function oldPressBody(elapsedMs: number): BodyState {
  const frames = Math.floor(elapsedMs / 16);
  const y = Math.min(0.586, 0.505 + 0.005 * frames);
  return {
    present: true,
    torsoLength: 0.3,
    torsoX: 0.5,
    torsoY: 0.55,
    shoulderY: 0.25,
    leftWristX: 0.26,
    rightWristX: 0.74,
    leftWristY: y,
    rightWristY: y,
    jumping: false,
    ankleSpreadTorsoFrac: 0.59,
  } as unknown as BodyState;
}

/** Press body with only the LEFT wrist on its button (right at rest). */
function oneWristBody(elapsedMs: number): BodyState {
  const body = pressBody(elapsedMs);
  body.rightWristX = 0.5;
  body.rightWristY = 0.556;
  return body;
}

const REST = makeBody();
const OVER_PILE = makeBody({
  handCanvas: { x: PILE.x + PILE.w / 2, y: PILE.y + PILE.h / 2 },
});
const OVER_HOPPER = makeBody({
  handCanvas: { x: HOPPER.x + HOPPER.w / 2, y: HOPPER.y + HOPPER.h / 2 },
});

function stubContext(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get: (_t, prop) => {
      if (prop === 'canvas') return { width: 960, height: 540 };
      return () => undefined;
    },
    set: (t, prop, value) => {
      t[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/**
 * Recording stand-in for the Leave-chip style test: logs method
 * calls and string `fillStyle` sets, and `createLinearGradient`
 * returns a stub gradient that records its stops.
 */
interface RecordedGradient {
  args: unknown[];
  stops: { offset: number; color: string }[];
}
function recordingContext(): {
  ctx: CanvasRenderingContext2D;
  calls: { method: string; args: unknown[] }[];
  fillStyles: string[];
  gradients: RecordedGradient[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  const fillStyles: string[] = [];
  const gradients: RecordedGradient[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get: (_t, prop) => {
      if (prop === 'canvas') return { width: 960, height: 540 };
      if (prop === 'createLinearGradient') {
        return (...args: unknown[]) => {
          const entry: RecordedGradient = { args, stops: [] };
          gradients.push(entry);
          calls.push({ method: 'createLinearGradient', args });
          return {
            addColorStop: (offset: number, color: string) => {
              entry.stops.push({ offset, color });
            },
          };
        };
      }
      return (...args: unknown[]) => {
        calls.push({ method: String(prop), args });
      };
    },
    set: (t, prop, value) => {
      if (prop === 'fillStyle' && typeof value === 'string') {
        fillStyles.push(value);
      }
      t[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, fillStyles, gradients };
}

describe('RefinerGame', () => {
  beforeEach(() => {
    inventory.reset();
  });

  it('picker gates Galvanic Stock at Refining 1, opens Ferrite with ore', () => {
    inventory.add('ferrite-shale', 5);
    const game = new RefinerGame(new SoundEffects());
    game.start();
    expect(game.selectRecipe('galvanic-stock')).toBe(false);
    expect(game.snapshot().phase).toBe('pick');
    expect(game.selectRecipe('refined-ferrite')).toBe(true);
    expect(game.snapshot().phase).toBe('carrying');
  });

  it('picker refuses Ferrite without 2 ore', () => {
    inventory.add('ferrite-shale', 1);
    const game = new RefinerGame(new SoundEffects());
    game.start();
    expect(game.selectRecipe('refined-ferrite')).toBe(false);
  });

  it('full batch via synthetic bodies: grab, carry, drop x2, 3 presses -> +1 refined, +15 XP', () => {
    inventory.add('ferrite-shale', 20);
    const game = new RefinerGame(new SoundEffects());
    game.start();
    expect(game.selectRecipe('refined-ferrite')).toBe(true);

    let t = 0;
    const stepTo = (toMs: number, body: BodyState): void => {
      for (; t < toMs; t += 16) {
        game.update(16, t, body, null);
      }
    };
    /** Step with a body that varies with time (a press in progress). */
    const stepFnTo = (
      toMs: number,
      bodyFn: (elapsedMs: number) => BodyState,
      startMs: number,
    ): void => {
      for (; t < toMs; t += 16) {
        game.update(16, t, bodyFn(t - startMs), null);
      }
    };
    // Grab 1: hold both hands over the pile past the 200 ms dwell.
    stepTo(300, OVER_PILE);
    expect(game.snapshot().carrying).toBe(true);
    expect(inventory.count('ferrite-shale')).toBe(19);
    // Carry to the hopper.
    stepTo(400, OVER_HOPPER);
    expect(game.snapshot().hopperFill).toBe(1);
    expect(game.snapshot().phase).toBe('carrying');
    // Grab 2 + drop 2: the hopper fills and the press phase starts.
    stepTo(700, OVER_PILE);
    expect(game.snapshot().carrying).toBe(true);
    stepTo(800, OVER_HOPPER);
    expect(game.snapshot().hopperFill).toBe(2);
    expect(game.snapshot().phase).toBe('pressing');
    // Pedestals slide in over 400 ms — the detector only runs once
    // they are fully up, so wait them out before pressing.
    stepTo(1300, REST);
    expect(game.snapshot().pedestalSlideT).toBe(1);
    // 3 presses (hold ~900 ms each, rest ~600 ms between so the
    // detector re-arms + clears its 500 ms minimum interval).
    stepFnTo(2200, pressBody, 1300);
    expect(game.snapshot().pressesDone).toBe(1);
    stepTo(2800, REST);
    stepFnTo(3700, pressBody, 2800);
    expect(game.snapshot().pressesDone).toBe(2);
    stepTo(4300, REST);
    stepFnTo(5200, pressBody, 4300);
    expect(game.snapshot().pressesDone).toBe(0);
    expect(game.snapshot().batchesDone).toBe(1);
    expect(inventory.count('refined-ferrite')).toBe(1);
    expect(inventory.count('ferrite-shale')).toBe(18);
    expect(inventory.xp('refining')).toBe(15);
    expect(inventory.level('refining')).toBe(1);
    // 'done' is transient: the next step returns to 'carrying', ready
    // for the next batch while the player still owns ore.
    expect(game.snapshot().phase).toBe('carrying');
    expect(game.snapshot().pileVisible).toBe(10);
  });

  it('one wrist only does NOT count (game level)', () => {
    inventory.add('ferrite-shale', 20);
    const game = new RefinerGame(new SoundEffects());
    game.start();
    expect(game.selectRecipe('refined-ferrite')).toBe(true);
    let t = 0;
    const stepTo = (toMs: number, body: BodyState): void => {
      for (; t < toMs; t += 16) game.update(16, t, body, null);
    };
    const stepFnTo = (
      toMs: number,
      bodyFn: (elapsedMs: number) => BodyState,
      startMs: number,
    ): void => {
      for (; t < toMs; t += 16) game.update(16, t, bodyFn(t - startMs), null);
    };
    stepTo(300, OVER_PILE);
    stepTo(400, OVER_HOPPER);
    stepTo(700, OVER_PILE);
    stepTo(800, OVER_HOPPER);
    expect(game.snapshot().phase).toBe('pressing');
    stepTo(1300, REST);
    // Left wrist presses for a full second; the right wrist never
    // leaves the centre. No press counts, no batch completes.
    stepFnTo(2300, oneWristBody, 1300);
    expect(game.snapshot().pressesDone).toBe(0);
    expect(game.snapshot().batchesDone).toBe(0);
    expect(game.snapshot().pressProgress).toBeLessThan(0.5);
  });

  it('pedestals slide in on entering the press phase and out on batch-complete', () => {
    inventory.add('ferrite-shale', 20);
    const game = new RefinerGame(new SoundEffects());
    game.start();
    expect(game.selectRecipe('refined-ferrite')).toBe(true);
    let t = 0;
    const stepTo = (toMs: number, body: BodyState): void => {
      for (; t < toMs; t += 16) game.update(16, t, body, null);
    };
    const stepFnTo = (
      toMs: number,
      bodyFn: (elapsedMs: number) => BodyState,
      startMs: number,
    ): void => {
      for (; t < toMs; t += 16) game.update(16, t, bodyFn(t - startMs), null);
    };
    // No pedestals before the hopper fills.
    stepTo(300, OVER_PILE);
    stepTo(400, OVER_HOPPER);
    expect(game.snapshot().pedestalSlideT).toBe(0);
    stepTo(700, OVER_PILE);
    stepTo(800, OVER_HOPPER);
    expect(game.snapshot().phase).toBe('pressing');
    // Mid-slide: partway up; fully up 400 ms after entering.
    stepTo(1000, REST);
    const mid = game.snapshot().pedestalSlideT;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    stepTo(1300, REST);
    expect(game.snapshot().pedestalSlideT).toBe(1);
    // Three presses complete the batch; the pedestals slide away.
    stepFnTo(2200, pressBody, 1300);
    stepTo(2800, REST);
    stepFnTo(3700, pressBody, 2800);
    stepTo(4300, REST);
    // The 3rd press fires ~300 ms into the hold (~4600), so at 4700
    // the slide-out is partway; by 5800 it is done.
    stepFnTo(4700, pressBody, 4300);
    expect(game.snapshot().batchesDone).toBe(1);
    const slidingOut = game.snapshot().pedestalSlideT;
    expect(slidingOut).toBeGreaterThan(0);
    expect(slidingOut).toBeLessThan(1);
    stepTo(5800, REST);
    expect(game.snapshot().pedestalSlideT).toBe(0);
  });

  it('leaving mid-press returns the ore and slides the pedestals away', () => {
    inventory.add('ferrite-shale', 10);
    const game = new RefinerGame(new SoundEffects());
    game.start();
    game.selectRecipe('refined-ferrite');
    const ctx = stubContext();
    game.render(ctx, 0, REST, null);
    let t = 0;
    for (; t < 300; t += 16) game.update(16, t, OVER_PILE, null);
    for (; t < 400; t += 16) game.update(16, t, OVER_HOPPER, null);
    for (; t < 700; t += 16) game.update(16, t, OVER_PILE, null);
    for (; t < 800; t += 16) game.update(16, t, OVER_HOPPER, null);
    expect(game.snapshot().phase).toBe('pressing');
    expect(game.snapshot().hopperFill).toBe(2);
    for (; t < 1300; t += 16) game.update(16, t, REST, null);
    expect(game.snapshot().pedestalSlideT).toBe(1);
    // Leave chip: bottom-left, x 12..232, y 488..528.
    let left = false;
    game.onLeaveToHub = () => {
      left = true;
    };
    expect(game.pointerDownAt(100, 508, 1500)).toBe(true);
    expect(left).toBe(true);
    // Carried (0) + hopper (2) ore returns: 10 - 2 grabbed + 2 back.
    expect(inventory.count('ferrite-shale')).toBe(10);
    expect(game.snapshot().phase).toBe('pick');
    // Pedestals slide away over 400 ms after the leave (the leave
    // itself is at 1500; at 1700 the slide is partway, at 2000 done).
    for (; t < 1700; t += 16) game.update(16, t, REST, null);
    const slidingOut = game.snapshot().pedestalSlideT;
    expect(slidingOut).toBeGreaterThan(0);
    expect(slidingOut).toBeLessThan(1);
    for (; t < 2000; t += 16) game.update(16, t, REST, null);
    expect(game.snapshot().pedestalSlideT).toBe(0);
  });

  it('leaving mid-batch returns the ore (pointer: Leave to town)', () => {
    inventory.add('ferrite-shale', 10);
    const game = new RefinerGame(new SoundEffects());
    game.start();
    game.selectRecipe('refined-ferrite');
    const ctx = stubContext();
    game.render(ctx, 0, REST, null);
    let t = 0;
    for (; t < 300; t += 16) game.update(16, t, OVER_PILE, null);
    expect(game.snapshot().carrying).toBe(true);
    // Leave chip: bottom-left, x 12..232, y 488..528.
    let left = false;
    game.onLeaveToHub = () => {
      left = true;
    };
    expect(game.pointerDownAt(100, 508, 500)).toBe(true);
    expect(left).toBe(true);
    expect(inventory.count('ferrite-shale')).toBe(10);
    expect(game.snapshot().phase).toBe('pick');
  });

  it('renders picker and batch frames without throwing', () => {
    inventory.add('ferrite-shale', 5);
    const game = new RefinerGame(new SoundEffects());
    game.start();
    const ctx = stubContext();
    expect(() => game.render(ctx, 1000, null, null)).not.toThrow();
    game.selectRecipe('refined-ferrite');
    expect(() => game.render(ctx, 1000, REST, null)).not.toThrow();
    expect(() => game.render(ctx, 1000, OVER_PILE, null)).not.toThrow();
  });

  it('the Leave chip uses the shared game-button look: gradient, rounded corners, no flat fillRect (v3.3)', () => {
    const game = new RefinerGame(new SoundEffects());
    game.start();
    const rec = recordingContext();
    game.render(rec.ctx, 1000, null, null);
    // Leave chip: bottom-left, x 12..232, y 488..528.
    const chipGradient = rec.gradients.find((g) => g.args[1] === 488);
    expect(chipGradient).toBeDefined();
    expect(chipGradient?.stops).toEqual([
      { offset: 0, color: BUTTON_STYLES.secondary.top },
      { offset: 1, color: BUTTON_STYLES.secondary.bottom },
    ]);
    expect(rec.calls.some((c) => c.method === 'arcTo')).toBe(true);
    expect(
      rec.calls.some(
        (c) =>
          c.method === 'fillRect' &&
          c.args[0] === 12 &&
          c.args[1] === 488 &&
          c.args[2] === 220 &&
          c.args[3] === 40,
      ),
    ).toBe(false);
    expect(rec.fillStyles).toContain(BUTTON_STYLES.secondary.lip);
  });
});

/**
 * Pedestal rendering (v3.4): slide-in/out, button sink, forging-bar
 * squash — asserted against a recording context that captures every
 * fillRect with the fill style in force at the time.
 */
describe('RefinerGame pedestals + forging bar (v3.4)', () => {
  function fillRecordingContext(): {
    ctx: CanvasRenderingContext2D;
    fills: { x: number; y: number; w: number; h: number; style: string }[];
  } {
    const fills: { x: number; y: number; w: number; h: number; style: string }[] = [];
    let fillStyle = '';
    const target: Record<string, unknown> = {};
    const ctx = new Proxy(target, {
      get: (_t, prop) => {
        if (prop === 'canvas') return { width: 960, height: 540 };
        if (prop === 'fillRect') {
          return (x: number, y: number, w: number, h: number) => {
            fills.push({ x, y, w, h, style: fillStyle });
          };
        }
        if (prop === 'createLinearGradient') {
          return () => ({ addColorStop: () => {} });
        }
        if (prop === 'measureText') return () => ({ width: 0 });
        return () => undefined;
      },
      set: (t, prop, value) => {
        if (prop === 'fillStyle') fillStyle = String(value);
        t[prop as string] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, fills };
  }

  /** Drive a game to the press phase with pedestals fully up. */
  function gamePressing(): {
    game: RefinerGame;
    t: number;
    stepTo: (toMs: number, body: BodyState) => void;
    stepFnTo: (
      toMs: number,
      bodyFn: (elapsedMs: number) => BodyState,
      startMs: number,
    ) => void;
  } {
    inventory.reset();
    inventory.add('ferrite-shale', 20);
    const game = new RefinerGame(new SoundEffects());
    game.start();
    expect(game.selectRecipe('refined-ferrite')).toBe(true);
    let t = 0;
    const stepTo = (toMs: number, body: BodyState): void => {
      for (; t < toMs; t += 16) game.update(16, t, body, null);
    };
    const stepFnTo = (
      toMs: number,
      bodyFn: (elapsedMs: number) => BodyState,
      startMs: number,
    ): void => {
      for (; t < toMs; t += 16) game.update(16, t, bodyFn(t - startMs), null);
    };
    stepTo(300, OVER_PILE);
    stepTo(400, OVER_HOPPER);
    stepTo(700, OVER_PILE);
    stepTo(800, OVER_HOPPER);
    expect(game.snapshot().phase).toBe('pressing');
    stepTo(1300, REST);
    expect(game.snapshot().pedestalSlideT).toBe(1);
    return {
      game,
      get t() {
        return t;
      },
      stepTo,
      stepFnTo,
    };
  }

  it('pedestals draw only while pressing (not while carrying, not after slide-out)', () => {
    inventory.reset();
    inventory.add('ferrite-shale', 20);
    const game = new RefinerGame(new SoundEffects());
    game.start();
    expect(game.selectRecipe('refined-ferrite')).toBe(true);
    let t = 0;
    const stepTo = (toMs: number, body: BodyState): void => {
      for (; t < toMs; t += 16) game.update(16, t, body, null);
    };
    // Carrying: no pedestals.
    stepTo(300, OVER_PILE);
    let rec = fillRecordingContext();
    game.render(rec.ctx, t, REST, null);
    expect(
      rec.fills.filter((f) => f.style === PEDESTAL_STYLE.column),
    ).toHaveLength(0);
    // Pressing, fully up: two columns + two buttons.
    stepTo(400, OVER_HOPPER);
    stepTo(700, OVER_PILE);
    stepTo(800, OVER_HOPPER);
    stepTo(1300, REST);
    rec = fillRecordingContext();
    game.render(rec.ctx, 1300, REST, null);
    expect(
      rec.fills.filter((f) => f.style === PEDESTAL_STYLE.column),
    ).toHaveLength(2);
    expect(
      rec.fills.filter((f) => f.style === PEDESTAL_STYLE.button),
    ).toHaveLength(2);
    // Buttons sit at the detector's zones — computed from
    // `pressButtonZones` here, never hard-coded, so the expectation
    // follows the zones whatever size Worker A lands. Canvas x is
    // mirrored (video-left zone = canvas-right button).
    const zones = pressButtonZones(0.5, 0.55, 0.3);
    const zoneToCanvas = (z: { x: number; y: number; w: number; h: number }) => {
      const x1 = (1 - z.x) * 960;
      const x2 = (1 - (z.x + z.w)) * 960;
      return {
        x: Math.min(x1, x2),
        y: z.y * 540,
        w: Math.abs(x2 - x1),
        h: z.h * 540,
      };
    };
    const expectedButtons = [zones.left, zones.right]
      .map(zoneToCanvas)
      .sort((a, b) => a.x - b.x);
    const buttons = rec.fills
      .filter((f) => f.style === PEDESTAL_STYLE.button)
      .sort((a, b) => a.x - b.x);
    expect(buttons).toHaveLength(2);
    for (let i = 0; i < 2; i += 1) {
      expect(buttons[i]?.x).toBeCloseTo(expectedButtons[i]?.x ?? 0, 0);
      expect(buttons[i]?.y).toBeCloseTo(expectedButtons[i]?.y ?? 0, 0);
      expect(buttons[i]?.w).toBeCloseTo(expectedButtons[i]?.w ?? 0, 0);
      expect(buttons[i]?.h).toBeCloseTo(expectedButtons[i]?.h ?? 0, 0);
    }
    // Posts are narrower than their pads and centred under them.
    const posts = rec.fills
      .filter((f) => f.style === PEDESTAL_STYLE.column)
      .sort((a, b) => a.x - b.x);
    expect(posts).toHaveLength(2);
    for (let i = 0; i < 2; i += 1) {
      const button = buttons[i];
      const post = posts[i];
      if (button === undefined || post === undefined) continue;
      expect(post.w).toBeLessThan(button.w);
      expect(post.x).toBeGreaterThan(button.x);
      expect(post.x + post.w).toBeLessThan(button.x + button.w);
      expect(post.y).toBeCloseTo(button.y + button.h, 0);
      expect(post.y + post.h).toBeCloseTo(540, 0);
    }
  });

  it('the forging bar squashes one step per press', () => {
    const ctx = gamePressing();
    // Bar: gold fill in the hopper (y > 330 separates it from the
    // buttons at y ~273). Full height at 0 presses: 0.3 * 162 = 48.6.
    const barHeights = (): number[] => {
      const rec = fillRecordingContext();
      ctx.game.render(rec.ctx, ctx.t, REST, null);
      return rec.fills
        .filter((f) => f.style === PEDESTAL_STYLE.bar && f.y > 330)
        .map((f) => f.h);
    };
    const expectBarHeight = (expected: number): void => {
      const heights = barHeights();
      expect(heights).toHaveLength(1);
      expect(heights[0]).toBeCloseTo(expected, 0);
    };
    expectBarHeight(48.6);
    ctx.stepFnTo(ctx.t + 900, pressBody, ctx.t);
    expect(ctx.game.snapshot().pressesDone).toBe(1);
    expectBarHeight(32.4);
    ctx.stepTo(ctx.t + 600, REST);
    ctx.stepFnTo(ctx.t + 900, pressBody, ctx.t);
    expect(ctx.game.snapshot().pressesDone).toBe(2);
    expectBarHeight(16.2);
  });

  it('the button sinks while a press hold is in progress, and rises at rest', () => {
    const ctx = gamePressing();
    const buttonYs = (nowMs: number, body: BodyState): number[] => {
      const rec = fillRecordingContext();
      ctx.game.render(rec.ctx, nowMs, body, null);
      return rec.fills
        .filter((f) => f.style === PEDESTAL_STYLE.button)
        .map((f) => f.y);
    };
    // At rest the buttons sit at their zones.
    const zones = pressButtonZones(0.5, 0.55, 0.3);
    const restY = zones.left.y * 540;
    const buttonH = zones.left.h * 540;
    // Full sink: PRESS.pressDepthTorsoFrac, capped at half the pad
    // height so the small v3.5 pad never vanishes into its post.
    const sinkPx = Math.min(
      PRESS.pressDepthTorsoFrac * 0.3 * 540,
      buttonH * 0.5,
    );
    const atRest = buttonYs(ctx.t, REST);
    expect(atRest).toHaveLength(2);
    for (const y of atRest) expect(y).toBeCloseTo(restY, 0);
    // Mid-hold the buttons are sunk by the full press depth once
    // the hold completes.
    ctx.stepFnTo(ctx.t + 600, pressBody, ctx.t);
    const midHold = buttonYs(ctx.t, pressBody(600));
    expect(midHold).toHaveLength(2);
    for (const y of midHold) expect(y).toBeCloseTo(restY + sinkPx, 0);
    // Hands off again: the buttons rise back to their zones.
    ctx.stepTo(ctx.t + 600, REST);
    const risen = buttonYs(ctx.t, REST);
    expect(risen).toHaveLength(2);
    for (const y of risen) expect(y).toBeCloseTo(restY, 0);
  });
});

/**
 * Full pipeline, no camera: MouseSource -> BodyStateTracker ->
 * RefinerGame. This is the exact path a player uses with
 * "Play Without Camera".
 */
describe('RefinerGame via mouse sim', () => {
  function setup() {
    inventory.reset();
    inventory.add('ferrite-shale', 20);
    const mouse = new MouseSource();
    const tracker = new BodyStateTracker();
    const game = new RefinerGame(new SoundEffects());
    mouse.start(0);
    game.start();
    expect(game.selectRecipe('refined-ferrite')).toBe(true);
    return { mouse, tracker, game };
  }

  function step(
    ctx: ReturnType<typeof setup>,
    fromMs: number,
    toMs: number,
  ): void {
    for (let t = fromMs + 16; t <= toMs; t += 16) {
      const frame = ctx.mouse.frameAt(t);
      if (frame === null) continue;
      const body = ctx.tracker.update(frame);
      ctx.game.update(16, t, body, frame.landmarks);
    }
  }

  /**
   * Grab one ore in the sim: hold A+D to latch the clasp, release
   * (hands rest together at waist height on the midline), move the
   * pointer over the pile, dwell past 200 ms. Returns the end time.
   */
  function grabInSim(ctx: ReturnType<typeof setup>, t: number): number {
    const pileVideo = toVideo(PILE.x + PILE.w / 2, PILE.y + PILE.h / 2);
    ctx.mouse.setKeyArm('left', true);
    ctx.mouse.setKeyArm('right', true);
    step(ctx, t, t + 150);
    ctx.mouse.setKeyArm('left', false);
    ctx.mouse.setKeyArm('right', false);
    ctx.mouse.setPointer(pileVideo, false);
    step(ctx, t + 150, t + 700);
    return t + 700;
  }

  function dropInSim(ctx: ReturnType<typeof setup>, t: number): number {
    const hopperVideo = toVideo(HOPPER.x + HOPPER.w / 2, HOPPER.y + HOPPER.h / 2);
    ctx.mouse.setPointer(hopperVideo, false);
    step(ctx, t, t + 400);
    return t + 400;
  }

  it('grab + carry + drop works in the sim (hopper 1/2)', () => {
    const ctx = setup();
    const t = grabInSim(ctx, 0);
    expect(ctx.game.snapshot().carrying).toBe(true);
    dropInSim(ctx, t);
    expect(ctx.game.snapshot().hopperFill).toBe(1);
    expect(ctx.game.snapshot().carrying).toBe(false);
  });

  it('second grab + drop fills the hopper 2/2 and enters the press phase', () => {
    const ctx = setup();
    let t = grabInSim(ctx, 0);
    t = dropInSim(ctx, t);
    t = grabInSim(ctx, t);
    expect(ctx.game.snapshot().carrying).toBe(true);
    dropInSim(ctx, t);
    expect(ctx.game.snapshot().hopperFill).toBe(2);
    expect(ctx.game.snapshot().phase).toBe('pressing');
  });

  it('sim full batch: grab x2, drop x2, 3 presses with P -> +1 refined, +15 XP', () => {
    const ctx = setup();
    let t = grabInSim(ctx, 0);
    t = dropInSim(ctx, t);
    t = grabInSim(ctx, t);
    t = dropInSim(ctx, t);
    expect(ctx.game.snapshot().phase).toBe('pressing');
    // Pedestals slide in over 400 ms — the detector only runs once
    // they are fully up, so wait them out before pressing.
    step(ctx, t, t + 500);
    t += 500;
    for (let i = 0; i < 3; i++) {
      // Hold P ~1200 ms: the press animates down over 240 ms, then
      // the 300 ms hold completes and the press counts.
      ctx.mouse.setPressing(true);
      step(ctx, t, t + 1200);
      t += 1200;
      // The 3rd press completes the batch, which resets pressesDone
      // to 0 — so it reads as batchesDone 1, not pressesDone 3.
      if (i < 2) expect(ctx.game.snapshot().pressesDone).toBe(i + 1);
      else expect(ctx.game.snapshot().batchesDone).toBe(1);
      ctx.mouse.setPressing(false);
      // Hands back to the centre (A+D clasp) between presses, so the
      // detector re-arms: releasing P returns the wrists to their
      // hanging rest, which sits at (or just inside) the small v3.5
      // button zones, so merely letting go of P may leave the
      // detector disarmed. A real player's hands re-arm by lifting
      // off the buttons between presses — the clasp step is the
      // sim's version of that lift, not a game rule.
      ctx.mouse.setKeyArm('left', true);
      ctx.mouse.setKeyArm('right', true);
      step(ctx, t, t + 300);
      t += 300;
      ctx.mouse.setKeyArm('left', false);
      ctx.mouse.setKeyArm('right', false);
      step(ctx, t, t + 700);
      t += 700;
    }
    expect(ctx.game.snapshot().batchesDone).toBe(1);
    expect(inventory.count('refined-ferrite')).toBe(1);
    expect(inventory.xp('refining')).toBe(15);
  });
});

/**
 * Recipe picker cards + one instruction surface (v3.2, Nov 4 playtest):
 * the v3.1 chips were translucent (avatar showing through) and the
 * gate overlay drew on top of them; the instruction appeared three
 * times (canvas event line + canvas hint + HUD).
 */
describe('RefinerGame picker cards (v3.2)', () => {
  beforeEach(() => {
    inventory.reset();
  });

  /** Recording stub: captures text, fills (with style) and images. */
  function recordingContext(): {
    ctx: CanvasRenderingContext2D;
    fillTexts: { text: string; x: number; y: number }[];
    strokeTexts: { text: string; x: number; y: number }[];
    fills: { x: number; y: number; w: number; h: number; style: string }[];
    strokes: { x: number; y: number; w: number; h: number; width: number }[];
    drawImages: number;
  } {
    const fillTexts: { text: string; x: number; y: number }[] = [];
    const strokeTexts: { text: string; x: number; y: number }[] = [];
    const fills: {
      x: number;
      y: number;
      w: number;
      h: number;
      style: string;
    }[] = [];
    const strokes: {
      x: number;
      y: number;
      w: number;
      h: number;
      width: number;
    }[] = [];
    let fillStyle = '';
    let lineWidth = 1;
    let drawImages = 0;
    const target: Record<string, unknown> = {};
    const stub = new Proxy(target, {
      get: (_t, prop) => {
        if (prop === 'canvas') return { width: 960, height: 540 };
        if (prop === 'fillText') {
          return (text: string, x: number, y: number) => {
            fillTexts.push({ text, x, y });
          };
        }
        if (prop === 'strokeText') {
          return (text: string, x: number, y: number) => {
            strokeTexts.push({ text, x, y });
          };
        }
        if (prop === 'fillRect') {
          return (x: number, y: number, w: number, h: number) => {
            fills.push({ x, y, w, h, style: fillStyle });
          };
        }
        if (prop === 'strokeRect') {
          return (x: number, y: number, w: number, h: number) => {
            strokes.push({ x, y, w, h, width: lineWidth });
          };
        }
        if (prop === 'drawImage') {
          return () => {
            drawImages += 1;
          };
        }
        if (prop === 'measureText') {
          return (text: string) => ({ width: text.length * 11 });
        }
        return () => undefined;
      },
      set: (t, prop, value) => {
        if (prop === 'fillStyle') fillStyle = String(value);
        if (prop === 'lineWidth') lineWidth = Number(value);
        t[prop as string] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx: stub, fillTexts, strokeTexts, fills, strokes, drawImages };
  }

  function renderPicker(game: RefinerGame): ReturnType<typeof recordingContext> {
    const rec = recordingContext();
    game.render(rec.ctx, 1000, null, null);
    return rec;
  }

  it('picker cards are opaque, 640x96, and carry the recipe details', () => {
    inventory.add('ferrite-shale', 5);
    const game = new RefinerGame(new SoundEffects());
    game.start();
    const rec = renderPicker(game);
    const layout = pickerCardLayout(960, 540);
    expect(layout.cards).toHaveLength(2);
    for (const card of layout.cards) {
      expect(card.w).toBe(640);
      expect(card.h).toBe(PICKER_CARD.h);
      expect(card.h).toBe(96);
    }
    expect(layout.cards[1]?.y).toBe(
      (layout.cards[0]?.y ?? 0) + PICKER_CARD.h + PICKER_CARD.gap,
    );
    // Every card fill is a solid hex colour — nothing shows through.
    for (const card of layout.cards) {
      const fill = rec.fills.find(
        (f) => f.x === card.x && f.y === card.y && f.w === card.w && f.h === card.h,
      );
      expect(fill).toBeDefined();
      expect(fill?.style).toMatch(/^#[0-9a-f]{6}$/);
      expect(fill?.style).not.toMatch(/rgba/);
    }
    const texts = rec.fillTexts.map((t) => t.text).join('\n');
    expect(texts).toContain('Refined Ferrite');
    expect(texts).toContain('→');
    expect(texts).toContain('+15 XP');
    expect(texts).toContain('own 5');
    expect(texts).toContain('🔒 Galvanic Stock');
    expect(texts).toContain('Unlocks at Refining 5');
  });

  it('the gate banner zone never covers the cards or the Leave chip', () => {
    const layout = pickerCardLayout(960, 540);
    const banner = gateBannerRect(960, 30 * 11);
    expect(banner.y + banner.h).toBe(GATE_BANNER.top + GATE_BANNER.height);
    for (const card of layout.cards) {
      expect(card.y).toBeGreaterThan(banner.y + banner.h);
    }
    expect(layout.leave.y).toBeGreaterThan(banner.y + banner.h);
    // Cards and Leave never overlap each other either.
    for (const card of layout.cards) {
      const overlapsLeave =
        card.x < layout.leave.x + layout.leave.w &&
        layout.leave.x < card.x + card.w &&
        card.y < layout.leave.y + layout.leave.h &&
        layout.leave.y < card.y + card.h;
      expect(overlapsLeave).toBe(false);
    }
  });

  it('tap once selects, tap again starts; locked cards never start', () => {
    inventory.add('ferrite-shale', 5);
    const game = new RefinerGame(new SoundEffects());
    game.start();
    renderPicker(game);
    const layout = pickerCardLayout(960, 540);
    const first = layout.cards[0];
    const second = layout.cards[1];
    if (first === undefined || second === undefined) {
      throw new Error('picker layout missing cards');
    }
    // First tap selects, batch does NOT start.
    expect(
      game.pointerDownAt(first.x + first.w / 2, first.y + first.h / 2, 1000),
    ).toBe(true);
    expect(game.snapshot().phase).toBe('pick');
    expect(game.selectedRecipeId).toBe('refined-ferrite');
    // Second tap on the selected card starts the batch.
    expect(
      game.pointerDownAt(first.x + first.w / 2, first.y + first.h / 2, 1100),
    ).toBe(true);
    expect(game.snapshot().phase).toBe('carrying');
    // Back to the picker: the last recipe stays selected.
    game.backToPicker(1200);
    expect(game.snapshot().phase).toBe('pick');
    expect(game.selectedRecipeId).toBe('refined-ferrite');
    renderPicker(game);
    // Locked card (Galvanic Stock at Refining 1): tap does nothing.
    expect(
      game.pointerDownAt(second.x + second.w / 2, second.y + second.h / 2, 1300),
    ).toBe(true);
    expect(game.snapshot().phase).toBe('pick');
    expect(game.selectedRecipeId).toBe('refined-ferrite');
  });

  it('the selected card is highlighted (thick gold border + ✓)', () => {
    inventory.add('ferrite-shale', 5);
    const game = new RefinerGame(new SoundEffects());
    game.start();
    renderPicker(game);
    const layout = pickerCardLayout(960, 540);
    const first = layout.cards[0];
    if (first === undefined) throw new Error('picker layout missing cards');
    game.pointerDownAt(first.x + first.w / 2, first.y + first.h / 2, 1000);
    const rec = renderPicker(game);
    const border = rec.strokes.find(
      (s) => s.x === first.x && s.y === first.y && s.w === first.w && s.h === first.h,
    );
    expect(border).toBeDefined();
    expect(border?.width).toBe(4);
    const texts = rec.fillTexts.map((t) => t.text).join('\n');
    expect(texts).toContain('✓ Refined Ferrite');
  });

  it('the instruction appears once, in the HUD — never on the canvas', () => {
    inventory.add('ferrite-shale', 20);
    const game = new RefinerGame(new SoundEffects());
    game.start();
    expect(game.selectRecipe('refined-ferrite')).toBe(true);
    // Grab one ore so a last-event message exists too.
    let t = 0;
    for (; t < 300; t += 16) game.update(16, t, OVER_PILE, null);
    expect(game.snapshot().carrying).toBe(true);
    const rec = recordingContext();
    game.render(rec.ctx, 400, REST, null);
    const canvasTexts = [
      ...rec.fillTexts.map((x) => x.text),
      ...rec.strokeTexts.map((x) => x.text),
    ];
    const hint = game.snapshot().hint;
    expect(canvasTexts.join('\n')).not.toContain(hint);
    expect(canvasTexts.join('\n')).not.toContain('Got one!');
    expect(canvasTexts.join('\n')).not.toContain('🔨');
    expect(canvasTexts.join('\n')).not.toContain('Presses:');
    // The title banner is the one canvas text allowed up top.
    expect(
      rec.fillTexts.filter((x) => x.text === '🔥 Refined Ferrite'),
    ).toHaveLength(1);
    // The HUD carries the hint exactly once.
    const hud = game.hudHtml();
    expect(hud.split(hint).length - 1).toBe(1);
  });

  it('a batch-complete announcement replaces the title in the banner zone', () => {
    inventory.add('ferrite-shale', 20);
    const game = new RefinerGame(new SoundEffects());
    game.start();
    expect(game.selectRecipe('refined-ferrite')).toBe(true);
    let t = 0;
    const stepTo = (toMs: number, body: BodyState): void => {
      for (; t < toMs; t += 16) {
        game.update(16, t, body, null);
      }
    };
    const stepFnTo = (
      toMs: number,
      bodyFn: (elapsedMs: number) => BodyState,
      startMs: number,
    ): void => {
      for (; t < toMs; t += 16) {
        game.update(16, t, bodyFn(t - startMs), null);
      }
    };
    stepTo(300, OVER_PILE);
    stepTo(400, OVER_HOPPER);
    stepTo(700, OVER_PILE);
    stepTo(800, OVER_HOPPER);
    expect(game.snapshot().phase).toBe('pressing');
    stepTo(1300, REST);
    stepFnTo(2200, pressBody, 1300);
    stepTo(2800, REST);
    stepFnTo(3700, pressBody, 2800);
    stepTo(4300, REST);
    stepFnTo(5200, pressBody, 4300);
    expect(game.snapshot().batchesDone).toBe(1);
    const rec = recordingContext();
    game.render(rec.ctx, 3000, REST, null);
    const at58 = rec.fillTexts.filter((x) => x.y === 58);
    expect(at58).toHaveLength(1);
    expect(at58[0]?.text).toBe('✨ Refined Ferrite made! +15 Refining XP');
    expect(rec.fillTexts.map((x) => x.text)).not.toContain(
      '🔥 Refined Ferrite',
    );
  });
});

/**
 * Pile / hopper pulled toward the centre (v3.2, Brandon's idea, Nov 4
 * playtest): the far-left / far-right zones made the player lean and
 * shift side to side, sliding hips/knees out of frame and tripping
 * the gate mid-refine. The zones move inward — but not so far that
 * they crowd the avatar, and the hands must still reach them from a
 * centred stance without bending forward.
 */
describe('RefinerGame zones pulled inward (v3.2)', () => {
  const W = 960;
  const H = 540;

  it('pile and hopper sit in the centred band (0.30w / 0.70w), not the far edges', () => {
    const pile = pileZoneForStage(W, H);
    const hopper = hopperZoneForStage(W, H);
    const pileCentreX = pile.x + pile.w / 2;
    const hopperCentreX = hopper.x + hopper.w / 2;
    expect(pileCentreX / W).toBeCloseTo(0.3, 2);
    expect(hopperCentreX / W).toBeCloseTo(0.7, 2);
    expect(pileCentreX / W).toBeGreaterThanOrEqual(0.25);
    expect(pileCentreX / W).toBeLessThanOrEqual(0.38);
    expect(hopperCentreX / W).toBeGreaterThanOrEqual(0.62);
    expect(hopperCentreX / W).toBeLessThanOrEqual(0.75);
    // A clear gap between the zones for the avatar to stand in.
    expect(hopper.x - (pile.x + pile.w)).toBeGreaterThanOrEqual(0.1 * W);
  });

  it('the zones clear the central body column', () => {
    const pile = pileZoneForStage(W, H);
    const hopper = hopperZoneForStage(W, H);
    // Shoulders in canvas space: torso centred (0.5w), half-width =
    // SIM.shoulderWidth (video x-units) * stage width / 2.
    const shoulderHalfPx = (SIM.shoulderWidth * W) / 2;
    const torsoLeft = W / 2 - shoulderHalfPx;
    const torsoRight = W / 2 + shoulderHalfPx;
    // The pile's right edge stays left of the torso; the hopper's
    // left edge stays right of it.
    expect(pile.x + pile.w).toBeLessThanOrEqual(torsoLeft + 30);
    expect(hopper.x).toBeGreaterThanOrEqual(torsoRight - 30);
    // The zones never overlap the avatar's centre line.
    expect(pile.x + pile.w).toBeLessThan(W / 2);
    expect(hopper.x).toBeGreaterThan(W / 2);
  });

  it('both zones are reachable from a centred stance, at waist height', () => {
    const pile = pileZoneForStage(W, H);
    const hopper = hopperZoneForStage(W, H);
    // Shoulders (video space, centred stance): torso 0.5, half-width
    // SIM.shoulderWidth / 2. Zone centres to video space via the
    // same mirror the game uses (toVideo above).
    const shoulderHalf = SIM.shoulderWidth / 2;
    const leftShoulder = 0.5 - shoulderHalf;
    const rightShoulder = 0.5 + shoulderHalf;
    const pileCentreVideo = toVideo(pile.x + pile.w / 2, 0).x;
    const hopperCentreVideo = toVideo(hopper.x + hopper.w / 2, 0).x;
    const pileReach = Math.min(
      Math.abs(pileCentreVideo - leftShoulder),
      Math.abs(pileCentreVideo - rightShoulder),
    );
    const hopperReach = Math.min(
      Math.abs(hopperCentreVideo - leftShoulder),
      Math.abs(hopperCentreVideo - rightShoulder),
    );
    // Arm length is SIM.armLength (0.32, video units): both zones
    // are well inside it — a short side reach, no torso lean.
    expect(pileReach).toBeLessThanOrEqual(SIM.armLength);
    expect(hopperReach).toBeLessThanOrEqual(SIM.armLength);
    expect(pileReach).toBeLessThan(SIM.armLength / 2);
    expect(hopperReach).toBeLessThan(SIM.armLength / 2);
    // Waist height, no bending: the hands at rest hang at ~0.57 of
    // stage height, inside the zones' vertical span (0.44..0.74h).
    expect(pile.y / H).toBeCloseTo(0.44, 2);
    expect((pile.y + pile.h) / H).toBeCloseTo(0.74, 2);
    expect(0.57).toBeGreaterThanOrEqual(pile.y / H);
    expect(0.57).toBeLessThanOrEqual((pile.y + pile.h) / H);
  });
});

/**
 * Pedestal press, v3.5 (Nov 4 playtest): the v3.4 pedestals were
 * two GIANT gold slabs at the far bottom corners (~1/4 stage width
 * each) that covered the "Hopper: 2/2" label and the top edge of
 * the "Leave to town" chip, with no distinct button — the whole
 * slab WAS the button. v3.5 makes each pedestal a slim post with a
 * small pad that IS the detection zone, at resting-hand height
 * beside the body, and moves the pile/hopper labels above their
 * zones so the full-height posts never cross a label.
 */
describe('RefinerGame pedestals v3.5 (slim posts, small pads)', () => {
  const W = 960;
  const H = 540;

  /** Canvas rect of a video-space zone (mirrored x, like toCanvas). */
  function zoneToCanvas(z: { x: number; y: number; w: number; h: number }): {
    x: number;
    y: number;
    w: number;
    h: number;
  } {
    const x1 = (1 - z.x) * W;
    const x2 = (1 - (z.x + z.w)) * W;
    return {
      x: Math.min(x1, x2),
      y: z.y * H,
      w: Math.abs(x2 - x1),
      h: z.h * H,
    };
  }

  it('the rendered pads equal the detection zones (same helper, one source)', () => {
    // Pure helper: pad rect == mirrored pressButtonZones rect.
    for (const hip of [
      { x: 0.5, y: 0.55 },
      { x: 0.45, y: 0.55 },
    ]) {
      const zones = pressButtonZones(hip.x, hip.y, 0.3);
      const rects = pedestalRectsForStage(W, H, hip.x, hip.y, 0.3);
      for (const [zone, pad] of [
        [zones.left, rects.left.button],
        [zones.right, rects.right.button],
      ] as const) {
        const expected = zoneToCanvas(zone);
        expect(pad.x).toBeCloseTo(expected.x, 0);
        expect(pad.y).toBeCloseTo(expected.y, 0);
        expect(pad.w).toBeCloseTo(expected.w, 0);
        expect(pad.h).toBeCloseTo(expected.h, 0);
      }
      // Posts are narrower than their pads, centred under them.
      for (const side of [rects.left, rects.right]) {
        expect(side.post.w).toBeLessThan(side.button.w);
        expect(side.post.x).toBeGreaterThan(side.button.x);
        expect(side.post.x + side.post.w).toBeLessThan(
          side.button.x + side.button.w,
        );
      }
    }
    // Rendered fills: the gold pad fills in a recording context are
    // exactly the zone rects too — the draw path uses the helper.
    inventory.reset();
    inventory.add('ferrite-shale', 20);
    const game = new RefinerGame(new SoundEffects());
    game.start();
    expect(game.selectRecipe('refined-ferrite')).toBe(true);
    let t = 0;
    const stepTo = (toMs: number, body: BodyState): void => {
      for (; t < toMs; t += 16) game.update(16, t, body, null);
    };
    stepTo(300, OVER_PILE);
    stepTo(400, OVER_HOPPER);
    stepTo(700, OVER_PILE);
    stepTo(800, OVER_HOPPER);
    stepTo(1300, REST);
    expect(game.snapshot().pedestalSlideT).toBe(1);
    const fills: { x: number; y: number; w: number; h: number; style: string }[] = [];
    let fillStyle = '';
    const target: Record<string, unknown> = {};
    const ctx = new Proxy(target, {
      get: (_t, prop) => {
        if (prop === 'canvas') return { width: W, height: H };
        if (prop === 'fillRect') {
          return (x: number, y: number, w: number, h: number) => {
            fills.push({ x, y, w, h, style: fillStyle });
          };
        }
        if (prop === 'createLinearGradient') {
          return () => ({ addColorStop: () => {} });
        }
        if (prop === 'measureText') return () => ({ width: 0 });
        return () => undefined;
      },
      set: (tt, prop, value) => {
        if (prop === 'fillStyle') fillStyle = String(value);
        tt[prop as string] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    game.render(ctx, 1300, REST, null);
    const zones = pressButtonZones(0.5, 0.55, 0.3);
    const expected = [zones.left, zones.right]
      .map(zoneToCanvas)
      .sort((a, b) => a.x - b.x);
    const pads = fills
      .filter((f) => f.style === PEDESTAL_STYLE.button)
      .sort((a, b) => a.x - b.x);
    expect(pads).toHaveLength(2);
    for (let i = 0; i < 2; i += 1) {
      expect(pads[i]?.x).toBeCloseTo(expected[i]?.x ?? 0, 0);
      expect(pads[i]?.y).toBeCloseTo(expected[i]?.y ?? 0, 0);
      expect(pads[i]?.w).toBeCloseTo(expected[i]?.w ?? 0, 0);
      expect(pads[i]?.h).toBeCloseTo(expected[i]?.h ?? 0, 0);
    }
  });

  it('no pedestal rect intersects the pile label, hopper label, Leave chip, or torso box', () => {
    // Worst-case labels: a full pile ("10 shown") with a two-digit
    // owned count is the widest the pile label gets.
    const pileLabel = pileLabelRect(W, H, 10, 99);
    const hopperLabel = hopperLabelRect(W, H, 2, 2);
    const leave = leaveChipRect(W, H);
    const torso = simTorsoBox(W, H);
    for (const slideT of [1, 0.5]) {
      const rects = pedestalRectsForStage(W, H, 0.5, 0.55, 0.3, slideT);
      for (const side of [rects.left, rects.right]) {
        for (const part of [side.button, side.post]) {
          expect(rectsIntersect(part, pileLabel)).toBe(false);
          expect(rectsIntersect(part, hopperLabel)).toBe(false);
          expect(rectsIntersect(part, leave)).toBe(false);
          expect(rectsIntersect(part, torso)).toBe(false);
        }
      }
    }
    // The labels sit above their zones, clear of the pedestals'
    // whole vertical run; the Leave chip is far left of both posts.
    expect(pileLabel.y + pileLabel.h).toBeLessThanOrEqual(240);
    expect(hopperLabel.y + hopperLabel.h).toBeLessThanOrEqual(240);
    expect(leave.x + leave.w).toBeLessThan(300);
  });

  it('the pile/hopper labels sit above their zones (v3.5), not below them', () => {
    const pile = pileZoneForStage(W, H);
    const hopper = hopperZoneForStage(W, H);
    const pileLabel = pileLabelRect(W, H, 10, 20);
    const hopperLabel = hopperLabelRect(W, H, 2, 2);
    expect(pileLabel.y + pileLabel.h).toBeLessThanOrEqual(pile.y);
    expect(hopperLabel.y + hopperLabel.h).toBeLessThanOrEqual(hopper.y);
    expect(pileLabel.x + pileLabel.w / 2).toBeCloseTo(pile.x + pile.w / 2, 0);
    expect(hopperLabel.x + hopperLabel.w / 2).toBeCloseTo(
      hopper.x + hopper.w / 2,
      0,
    );
  });

  it('a press does not count when the wrists are at the OLD v3.4 far-out positions', () => {
    inventory.reset();
    inventory.add('ferrite-shale', 20);
    const game = new RefinerGame(new SoundEffects());
    game.start();
    expect(game.selectRecipe('refined-ferrite')).toBe(true);
    let t = 0;
    const stepTo = (toMs: number, body: BodyState): void => {
      for (; t < toMs; t += 16) game.update(16, t, body, null);
    };
    const stepFnTo = (
      toMs: number,
      bodyFn: (elapsedMs: number) => BodyState,
      startMs: number,
    ): void => {
      for (; t < toMs; t += 16) game.update(16, t, bodyFn(t - startMs), null);
    };
    stepTo(300, OVER_PILE);
    stepTo(400, OVER_HOPPER);
    stepTo(700, OVER_PILE);
    stepTo(800, OVER_HOPPER);
    expect(game.snapshot().phase).toBe('pressing');
    stepTo(1300, REST);
    // Are the old far-out wrists inside the LIVE zones? If Worker
    // A's shrink has not landed yet, they are — the old positions
    // ARE the zones, so the same hold counts one press. Once the
    // zones shrink, the old wrists sit outside them and nothing
    // counts. The expectation follows the live zones either way.
    const zones = pressButtonZones(0.5, 0.55, 0.3);
    const oldInside =
      0.26 >= zones.left.x &&
      0.26 <= zones.left.x + zones.left.w &&
      0.586 >= zones.left.y &&
      0.586 <= zones.left.y + zones.left.h;
    stepFnTo(3300, oldPressBody, 1300);
    expect(game.snapshot().pressesDone).toBe(oldInside ? 1 : 0);
    expect(game.snapshot().batchesDone).toBe(0);
  });

  it('sim P key puts the wrists on the live button centres (tripwire for the mouseSource retarget)', () => {
    // The P-key animation lives in sim/mouseSource.ts (not the
    // refiner): it must animate the wrists to pressButtonZones,
    // not to hard-coded v3.4 numbers. This test reads the live
    // zones and checks the sim lands on them — it goes red if the
    // zones move and the sim animation is not retargeted with them.
    inventory.reset();
    const mouse = new MouseSource();
    const tracker = new BodyStateTracker();
    mouse.start(0);
    mouse.setPointer({ x: 0.5, y: SIM.standingHipY }, false);
    mouse.setPressing(true);
    let body: BodyState | null = null;
    for (let t = 16; t <= 600; t += 16) {
      const frame = mouse.frameAt(t);
      if (frame !== null) body = tracker.update(frame);
    }
    expect(body).not.toBeNull();
    if (body === null) throw new Error('no sim body');
    const zones = pressButtonZones(
      body.torsoX,
      body.torsoY,
      body.torsoLength,
    );
    expect(body.leftWristX).toBeCloseTo(
      zones.left.x + zones.left.w / 2,
      1,
    );
    expect(body.rightWristX).toBeCloseTo(
      zones.right.x + zones.right.w / 2,
      1,
    );
    // Pressed depth: hip line + press depth, clamped inside the zone.
    const pressedY = Math.min(
      zones.left.y + zones.left.h,
      body.torsoY + PRESS.pressDepthTorsoFrac * body.torsoLength,
    );
    expect(body.leftWristY).toBeCloseTo(pressedY, 1);
    expect(body.rightWristY).toBeCloseTo(pressedY, 1);
  });
});
