import { beforeEach, describe, expect, it } from 'vitest';
import { SoundEffects } from '../../core/audio';
import { SIM } from '../../core/config';
import type { BodyState } from '../../core/bodyState';
import { BodyStateTracker } from '../../core/bodyState';
import { inventory } from '../../core/inventory';
import { MouseSource } from '../../sim/mouseSource';
import {
  PICKER_CARD,
  RefinerGame,
  hopperZoneForStage,
  pickerCardLayout,
  pileZoneForStage,
} from './refiner';
import { GATE_BANNER, gateBannerRect } from '../../render/renderer';

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

  it('sim star jumps count with the X legs-wide input (v3.1 integration)', () => {
    const ctx = setup();
    let t = grabInSim(ctx, 0);
    t = dropInSim(ctx, t);
    t = grabInSim(ctx, t);
    t = dropInSim(ctx, t);
    expect(ctx.game.snapshot().phase).toBe('jumping');
    // W (jump) + Q+E (arms wide) + X (legs wide): all three detector
    // conditions hold, so the star jumps count in the sim now.
    ctx.mouse.setJumping(true);
    ctx.mouse.setKeyArmAngled('left', true);
    ctx.mouse.setKeyArmAngled('right', true);
    ctx.mouse.setLegsWide(true);
    step(ctx, t, t + 1000);
    ctx.mouse.setJumping(false);
    ctx.mouse.setKeyArmAngled('left', false);
    ctx.mouse.setKeyArmAngled('right', false);
    ctx.mouse.setLegsWide(false);
    expect(ctx.game.snapshot().jumpsDone).toBeGreaterThanOrEqual(1);
  });

  it('sim star jumps do NOT count without the legs-wide input', () => {
    const ctx = setup();
    let t = grabInSim(ctx, 0);
    t = dropInSim(ctx, t);
    t = grabInSim(ctx, t);
    t = dropInSim(ctx, t);
    expect(ctx.game.snapshot().phase).toBe('jumping');
    // W (jump) + Q+E (arms wide): the jump + arms conditions hold,
    // but the sim's ankles stay at hip width (~0.59 torso), below
    // the detector's 0.85 legs-apart line. Hold X to spread them.
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
    expect(canvasTexts.join('\n')).not.toContain('⭐');
    expect(canvasTexts.join('\n')).not.toContain('Star jumps:');
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
    stepTo(300, OVER_PILE);
    stepTo(400, OVER_HOPPER);
    stepTo(700, OVER_PILE);
    stepTo(800, OVER_HOPPER);
    expect(game.snapshot().phase).toBe('jumping');
    stepTo(1400, STAR_JUMP_BODY);
    stepTo(1500, REST);
    stepTo(2100, STAR_JUMP_BODY);
    stepTo(2200, REST);
    stepTo(2800, STAR_JUMP_BODY);
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
