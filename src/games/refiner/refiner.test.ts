import { beforeEach, describe, expect, it } from 'vitest';
import { SoundEffects } from '../../core/audio';
import type { BodyState } from '../../core/bodyState';
import { BodyStateTracker } from '../../core/bodyState';
import { inventory } from '../../core/inventory';
import { MouseSource } from '../../sim/mouseSource';
import { hopperZoneForStage, pileZoneForStage, RefinerGame } from './refiner';

const PILE = pileZoneForStage(960, 540);
const HOPPER = hopperZoneForStage(960, 540);

/** Canvas point -> normalized video coords (toCanvas is mirrored in x). */
function toVideo(canvasX: number, canvasY: number): { x: number; y: number } {
  return { x: 1 - canvasX / 960, y: canvasY / 540 };
}

/**
 * Synthetic body for the game: both wrists at one canvas point
 * (hands together), or a star-jump shape. The game only reads wrist
 * X/Y + shoulder Y + torso length + jumping + ankle spread, so a
 * fake body is exact here.
 */
function makeBody(options: {
  handCanvas?: { x: number; y: number };
  starJump?: boolean;
} = {}): BodyState {
  const hand = options.handCanvas ?? { x: 480, y: 300 };
  const video = toVideo(hand.x, hand.y);
  const torsoLength = 0.3;
  if (options.starJump === true) {
    return {
      present: true,
      torsoLength,
      shoulderY: 0.25,
      leftWristX: 0.3,
      rightWristX: 0.7,
      leftWristY: 0.2,
      rightWristY: 0.2,
      jumping: true,
      ankleSpreadTorsoFrac: 1.2,
    } as unknown as BodyState;
  }
  return {
    present: true,
    torsoLength,
    shoulderY: 0.25,
    leftWristX: video.x,
    rightWristX: video.x,
    leftWristY: video.y,
    rightWristY: video.y,
    jumping: false,
    ankleSpreadTorsoFrac: 0.59,
  } as unknown as BodyState;
}

const REST = makeBody();
const OVER_PILE = makeBody({
  handCanvas: { x: PILE.x + PILE.w / 2, y: PILE.y + PILE.h / 2 },
});
const OVER_HOPPER = makeBody({
  handCanvas: { x: HOPPER.x + HOPPER.w / 2, y: HOPPER.y + HOPPER.h / 2 },
});
const STAR_JUMP_BODY = makeBody({ starJump: true });

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

  it('full batch via synthetic bodies: grab, carry, drop x2, 3 star jumps -> +1 refined, +15 XP', () => {
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
    // Grab 1: hold both hands over the pile past the 200 ms dwell.
    stepTo(300, OVER_PILE);
    expect(game.snapshot().carrying).toBe(true);
    expect(inventory.count('ferrite-shale')).toBe(19);
    // Carry to the hopper.
    stepTo(400, OVER_HOPPER);
    expect(game.snapshot().hopperFill).toBe(1);
    // Grab 2 + drop 2.
    stepTo(700, OVER_PILE);
    expect(game.snapshot().carrying).toBe(true);
    stepTo(800, OVER_HOPPER);
    expect(game.snapshot().hopperFill).toBe(2);
    expect(game.snapshot().phase).toBe('jumping');
    // 3 star jumps (land between jumps so the detector re-arms).
    stepTo(1400, STAR_JUMP_BODY);
    expect(game.snapshot().jumpsDone).toBe(1);
    stepTo(1500, REST);
    stepTo(2100, STAR_JUMP_BODY);
    expect(game.snapshot().jumpsDone).toBe(2);
    stepTo(2200, REST);
    stepTo(2800, STAR_JUMP_BODY);
    expect(game.snapshot().jumpsDone).toBe(0);
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

  it('second grab + drop fills the hopper 2/2 and enters the jump phase', () => {
    const ctx = setup();
    let t = grabInSim(ctx, 0);
    t = dropInSim(ctx, t);
    t = grabInSim(ctx, t);
    expect(ctx.game.snapshot().carrying).toBe(true);
    dropInSim(ctx, t);
    expect(ctx.game.snapshot().hopperFill).toBe(2);
    expect(ctx.game.snapshot().phase).toBe('jumping');
  });

  it('sim star jumps do NOT count yet — the sim cannot spread its ankles (known gap)', () => {
    const ctx = setup();
    let t = grabInSim(ctx, 0);
    t = dropInSim(ctx, t);
    t = grabInSim(ctx, t);
    t = dropInSim(ctx, t);
    expect(ctx.game.snapshot().phase).toBe('jumping');
    // W (jump) + Q+E (arms wide): the jump + arms conditions hold,
    // but the sim's ankles stay at hip width (~0.59 torso), below
    // the detector's 0.85 legs-apart line. Remove / adjust this test
    // when the coordinator adds a sim leg-spread input.
    ctx.mouse.setJumping(true);
    ctx.mouse.setKeyArmAngled('left', true);
    ctx.mouse.setKeyArmAngled('right', true);
    step(ctx, t, t + 1000);
    ctx.mouse.setJumping(false);
    ctx.mouse.setKeyArmAngled('left', false);
    ctx.mouse.setKeyArmAngled('right', false);
    expect(ctx.game.snapshot().jumpsDone).toBe(0);
    expect(ctx.game.snapshot().batchesDone).toBe(0);
  });
});
