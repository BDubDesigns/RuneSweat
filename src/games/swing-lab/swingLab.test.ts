import { describe, expect, it } from 'vitest';
import { SoundEffects } from '../../core/audio';
import type { BodyState } from '../../core/bodyState';
import { BodyStateTracker } from '../../core/bodyState';
import { MouseSource } from '../../sim/mouseSource';
import {
  cracksForHits,
  miningLevel,
  nodeCenterForBody,
  nodeRadiiForStage,
  pickaxeAnchorForBody,
  SwingLabGame,
  xpIntoLevel,
} from './swingLab';

/** Pure Mining XP / level / node math. */
describe('Swing Lab math', () => {
  it('starts at level 1 and levels every 100 XP', () => {
    expect(miningLevel(0)).toBe(1);
    expect(miningLevel(99)).toBe(1);
    expect(miningLevel(100)).toBe(2);
    expect(miningLevel(250)).toBe(3);
  });

  it('reports XP inside the current level', () => {
    expect(xpIntoLevel(0)).toBe(0);
    expect(xpIntoLevel(99)).toBe(99);
    expect(xpIntoLevel(100)).toBe(0);
    expect(xpIntoLevel(150)).toBe(50);
  });

  it('draws at most 3 crack lines', () => {
    expect(cracksForHits(0)).toBe(0);
    expect(cracksForHits(1)).toBe(1);
    expect(cracksForHits(3)).toBe(3);
    expect(cracksForHits(5)).toBe(3);
  });
});

/**
 * Full pipeline, no camera: MouseSource -> BodyStateTracker -> SwingLabGame.
 * Hold A+D to raise both arms, release to drop them fast. This is the
 * exact path a player uses with "Play Without Camera".
 */
describe('SwingLabGame via mouse sim', () => {
  function setup() {
    const mouse = new MouseSource();
    const tracker = new BodyStateTracker();
    const game = new SwingLabGame(new SoundEffects());
    mouse.start(0);
    game.start();
    return { mouse, tracker, game };
  }

  /** Step the pipeline from `fromMs` (exclusive) to `toMs` (inclusive). */
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
   * One hold-then-release swing starting at `t`: hold both arms up for
   * 500ms, release, then let the drop finish. Returns the end time.
   * The 500ms hold matters: v1 misread a settled windup's first fast
   * drop frames (wrists still above the windup line) as a flick and
   * swallowed the swing — a 300ms hold never settled long enough to
   * trip it, so the regression only shows at a real hold length.
   */
  function doSwing(ctx: ReturnType<typeof setup>, t: number): number {
    ctx.mouse.setKeyArm('left', true);
    ctx.mouse.setKeyArm('right', true);
    step(ctx, t, t + 500);
    ctx.mouse.setKeyArm('left', false);
    ctx.mouse.setKeyArm('right', false);
    step(ctx, t + 500, t + 900);
    return t + 900;
  }

  it('hold-then-release produces a HIT: +1 ore, +15 XP (Ferrite Shale)', () => {
    const ctx = setup();
    const end = doSwing(ctx, 0);
    void end;
    const snap = ctx.game.snapshot();
    expect(snap.swings).toBe(1);
    expect(snap.ore).toBe(1);
    expect(snap.xp).toBe(15);
    expect(snap.level).toBe(1);
    expect(snap.nodeHits).toBe(1);
    expect(snap.cracks).toBe(1);
    expect(snap.lastEvent?.kind).toBe('hit');
    expect(snap.lastHandedness).toBe('two-handed');
    expect(snap.tierId).toBe('ferrite-shale');
    expect(snap.tierName).toBe('Ferrite Shale');
  });

  it('five hits break the node into pieces (respawn follows after 3 s)', () => {
    const ctx = setup();
    let t = 0;
    for (let i = 0; i < 4; i += 1) {
      t = doSwing(ctx, t);
      // Wait out the 700ms hit cooldown before the next swing.
      step(ctx, t, t + 800);
      t += 800;
    }
    // 5th swing: sample the pieces the moment the node breaks — they
    // fall off the bottom within ~1 s, so a late snapshot sees few.
    let maxPieces = 0;
    ctx.mouse.setKeyArm('left', true);
    ctx.mouse.setKeyArm('right', true);
    step(ctx, t, t + 500);
    ctx.mouse.setKeyArm('left', false);
    ctx.mouse.setKeyArm('right', false);
    for (let s = t + 516; s <= t + 900; s += 16) {
      const frame = ctx.mouse.frameAt(s);
      if (frame === null) continue;
      const body = ctx.tracker.update(frame);
      ctx.game.update(16, s, body, frame.landmarks);
      maxPieces = Math.max(maxPieces, ctx.game.snapshot().nodePieces);
    }
    t += 900;
    step(ctx, t, t + 800);
    const snap = ctx.game.snapshot();
    expect(snap.swings).toBe(5);
    expect(snap.ore).toBe(5);
    expect(snap.xp).toBe(75);
    expect(snap.nodesBroken).toBe(1);
    expect(snap.nodeHits).toBe(0);
    expect(snap.cracks).toBe(0);
    // The node broke apart instead of popping out of existence: 6 pieces
    // spawned at the break, and the respawn wait is running.
    expect(maxPieces).toBe(6);
    expect(snap.nodeGone).toBe(true);
    expect(snap.respawnProgress).toBeLessThan(1);
  });

  it('seven hits reach Mining level 2 (7 x 15 XP = 105)', () => {
    const ctx = setup();
    let t = 0;
    for (let i = 0; i < 7; i += 1) {
      t = doSwing(ctx, t);
      step(ctx, t, t + 800);
      t += 800;
      // The 5th hit breaks the node: the next node only arrives after
      // the 3 s respawn wait, so swings during the wait would not count.
      if (i === 4) {
        step(ctx, t, t + 3600);
        t += 3600;
      }
    }
    const snap = ctx.game.snapshot();
    expect(snap.xp).toBe(105);
    expect(snap.level).toBe(2);
    expect(snap.xpIntoLevel).toBe(5);
  });

  it('a second swing inside the cooldown does not count', () => {
    const ctx = setup();
    // First swing: hold, release, and step until the hit actually lands
    // (the hit time moves with the machine's strike line, so the test
    // keys off the hit instead of assuming an absolute time).
    ctx.mouse.setKeyArm('left', true);
    ctx.mouse.setKeyArm('right', true);
    let hitAt: number | null = null;
    let released = false;
    for (let t = 16; t <= 2000; t += 16) {
      if (!released && t >= 500) {
        ctx.mouse.setKeyArm('left', false);
        ctx.mouse.setKeyArm('right', false);
        released = true;
      }
      const frame = ctx.mouse.frameAt(t);
      if (frame === null) continue;
      const body = ctx.tracker.update(frame);
      ctx.game.update(16, t, body, frame.landmarks);
      if (ctx.game.snapshot().swings === 1) {
        hitAt = t;
        break;
      }
    }
    expect(hitAt).not.toBeNull();
    const start = hitAt ?? 0;
    // Second swing immediately: raise again, hold 300ms, release — the
    // drop crosses the strike line ~500ms after the hit, well inside the
    // 700ms cooldown. It must not count.
    ctx.mouse.setKeyArm('left', true);
    ctx.mouse.setKeyArm('right', true);
    step(ctx, start, start + 300);
    ctx.mouse.setKeyArm('left', false);
    ctx.mouse.setKeyArm('right', false);
    step(ctx, start + 300, start + 700);
    expect(ctx.game.snapshot().swings).toBe(1);
    // After waiting out the cooldown, a swing counts again.
    step(ctx, start + 700, start + 1500);
    const t = doSwing(ctx, start + 1500);
    void t;
    expect(ctx.game.snapshot().swings).toBe(2);
  });

  it('a single-arm swing does NOT count: "Both hands together!"', () => {
    const ctx = setup();
    ctx.mouse.setKeyArm('left', true);
    step(ctx, 0, 500);
    ctx.mouse.setKeyArm('left', false);
    step(ctx, 500, 900);
    const snap = ctx.game.snapshot();
    expect(snap.swings).toBe(0);
    expect(snap.ore).toBe(0);
    expect(snap.xp).toBe(0);
    expect(snap.lastEvent).toEqual({
      kind: 'weak',
      reason: 'hands-apart',
      message: 'Both hands together!',
    });
  });

  it('no swing happens while the arms stay down', () => {
    const ctx = setup();
    step(ctx, 0, 1000);
    expect(ctx.game.snapshot().swings).toBe(0);
    expect(ctx.game.snapshot().xp).toBe(0);
  });

  it('restart resets ore, XP and swings', () => {
    const ctx = setup();
    doSwing(ctx, 0);
    expect(ctx.game.snapshot().swings).toBe(1);
    ctx.game.restart();
    const snap = ctx.game.snapshot();
    expect(snap.swings).toBe(0);
    expect(snap.ore).toBe(0);
    expect(snap.xp).toBe(0);
    expect(snap.nodesBroken).toBe(0);
  });

  it('hudHtml shows level, XP, ore image and swing phase', () => {
    const ctx = setup();
    doSwing(ctx, 0);
    const html = ctx.game.hudHtml();
    expect(html).toContain('Mining Lv 1');
    expect(html).toContain('15/100 XP');
    expect(html).toContain('Ore 1');
    expect(html).toContain('Ferrite Shale');
    // The Ore counter shows the real RuneSpace ore art, base-relative
    // (never a leading-slash absolute path — the Nov 4 path bug).
    expect(html).toContain('item-art/ferrite-shale.webp');
    expect(html).not.toContain('"/item-art/');
    expect(html).toContain('Phase:');
  });
});

/**
 * Front-center node + right-hand pickaxe geometry (pure helpers, Nov 4
 * playtest redesign). The node sits in front of the avatar at
 * chair/waist height; the pickaxe never leaves the right hand.
 */
describe('Swing Lab node + pickaxe geometry', () => {
  /** Minimal BodyState — the helpers read only a few fields. */
  function fakeBody(fields: {
    present?: boolean;
    torsoX?: number;
    torsoY?: number;
    rightWristX?: number;
    rightWristY?: number;
    rightArmAngleDeg?: number;
  }): BodyState {
    return {
      present: fields.present ?? true,
      torsoX: fields.torsoX ?? 0.5,
      torsoY: fields.torsoY ?? 0.55,
      rightWristX: fields.rightWristX ?? 0.5,
      rightWristY: fields.rightWristY ?? 0.5,
      rightArm: { angleDeg: fields.rightArmAngleDeg ?? 0 },
    } as unknown as BodyState;
  }

  it('node sits at the hip-centre x, rock-top just below waist height', () => {
    const body = fakeBody({ torsoX: 0.4, torsoY: 0.55 });
    const { x, y, rx, ry } = nodeCenterForBody(body, 960, 540);
    // Mirrored hip x: (1 - 0.4) * 960 = 576.
    expect(x).toBeCloseTo(576, 6);
    // v3 radii: rx = 0.22 * 540 = 118.8, ry = 0.17 * 540 = 91.8.
    expect(rx).toBeCloseTo(118.8, 6);
    expect(ry).toBeCloseTo(91.8, 6);
    // Centre is 1.15 radii below the hips: 0.55 * 540 + 91.8 * 1.15.
    expect(y).toBeCloseTo(0.55 * 540 + 91.8 * 1.15, 6);
  });

  it('v3 node is bigger, wider and lower than v2 (not just rescaled)', () => {
    // v2: circle radius 0.15 * 540 = 81, centre half a radius below the
    // hips, so its top sat half a radius ABOVE the hips.
    const v2Radius = 0.15 * 540;
    const hipY = 0.55 * 540;
    const v2Top = hipY - v2Radius * 0.5;
    const v2Bottom = hipY + v2Radius * 1.5;
    const { y, rx, ry } = nodeCenterForBody(
      fakeBody({ torsoX: 0.5, torsoY: 0.55 }),
      960,
      540,
    );
    // Wider: half-width 118.8 vs v2's 81. Taller too (ry 91.8 > 81).
    expect(rx).toBeGreaterThan(v2Radius);
    expect(ry).toBeGreaterThan(v2Radius);
    // Lower: the top of the rock sits below the hips now (v2's top was
    // above them, covering upper body), and the bottom reaches further
    // down, covering more of the legs.
    expect(y - ry).toBeGreaterThan(hipY);
    expect(y - ry).toBeGreaterThan(v2Top);
    expect(y + ry).toBeGreaterThan(v2Bottom);
  });

  it('node radii scale with the smaller stage dimension', () => {
    expect(nodeRadiiForStage(960, 540)).toEqual({
      rx: 540 * 0.22,
      ry: 540 * 0.17,
    });
    expect(nodeRadiiForStage(800, 800)).toEqual({
      rx: 800 * 0.22,
      ry: 800 * 0.17,
    });
  });

  it('node follows the body when the player moves sideways', () => {
    const left = nodeCenterForBody(fakeBody({ torsoX: 0.65 }), 960, 540);
    const right = nodeCenterForBody(fakeBody({ torsoX: 0.35 }), 960, 540);
    expect(left.x).toBeLessThan(right.x);
    expect(left.x).toBeCloseTo((1 - 0.65) * 960, 6);
    expect(right.x).toBeCloseTo((1 - 0.35) * 960, 6);
  });

  it('node falls back to stage centre with no body', () => {
    const noBody = nodeCenterForBody(null, 960, 540);
    expect(noBody.x).toBe(480);
    expect(noBody.y).toBeCloseTo(540 * 0.62, 6);
    expect(noBody.rx).toBeCloseTo(540 * 0.22, 6);
    expect(noBody.ry).toBeCloseTo(540 * 0.17, 6);
    const absent = nodeCenterForBody(fakeBody({ present: false }), 960, 540);
    expect(absent.x).toBe(480);
    expect(absent.y).toBeCloseTo(540 * 0.62, 6);
  });

  it('pickaxe anchors at the right wrist, never the wrist midpoint', () => {
    const body = fakeBody({
      torsoX: 0.5,
      rightWristX: 0.62,
      rightWristY: 0.3,
    });
    const anchor = pickaxeAnchorForBody(body, 960, 540);
    expect(anchor.x).toBeCloseTo((1 - 0.62) * 960, 6);
    expect(anchor.y).toBeCloseTo(0.3 * 540, 6);
  });

  it('pickaxe handle follows the right forearm: up when raised, down at rest', () => {
    const raised = pickaxeAnchorForBody(
      fakeBody({ rightArmAngleDeg: 0 }),
      960,
      540,
    );
    expect(raised.dirX).toBeCloseTo(0, 6);
    expect(raised.dirY).toBeCloseTo(-1, 6);
    const resting = pickaxeAnchorForBody(
      fakeBody({ rightArmAngleDeg: 180 }),
      960,
      540,
    );
    expect(resting.dirX).toBeCloseTo(0, 6);
    expect(resting.dirY).toBeCloseTo(1, 6);
  });
});

/**
 * Render smoke test: the full draw path (node, pickaxe, meter, phase
 * text, ghost arc) runs against a stub context without throwing. It
 * proves the path runs, not what it looks like — the look needs a
 * real-device playtest.
 */
describe('SwingLabGame render smoke test', () => {
  function stubContext(): CanvasRenderingContext2D {
    const target: Record<string, unknown> = {};
    const stub = new Proxy(target, {
      get: (_t, prop) => {
        if (prop === 'canvas') return { width: 960, height: 540 };
        return () => undefined;
      },
      set: (t, prop, value) => {
        t[prop as string] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return stub;
  }

  it('renders a frame with a body and without one', () => {
    const mouse = new MouseSource();
    const tracker = new BodyStateTracker();
    const game = new SwingLabGame(new SoundEffects());
    mouse.start(0);
    game.start();
    const ctx = stubContext();
    // No body yet: node + leaning pickaxe still draw.
    expect(() => game.render(ctx, 1000, null, null)).not.toThrow();
    // Body present, arms down: pickaxe in the right hand at rest.
    const frame = mouse.frameAt(1016);
    if (frame === null) throw new Error('sim produced no frame');
    const body = tracker.update(frame);
    expect(() => game.render(ctx, 1016, body, frame.landmarks)).not.toThrow();
    // Arms raised: ghost arc + meter + phase text draw.
    mouse.setKeyArm('left', true);
    mouse.setKeyArm('right', true);
    const raised = mouse.frameAt(1032);
    if (raised === null) throw new Error('sim produced no frame');
    const raisedBody = tracker.update(raised);
    expect(() =>
      game.render(ctx, 1032, raisedBody, raised.landmarks),
    ).not.toThrow();
  });
});

/**
 * v3: ore drops + RuneSpace tiers + mine selector (Nov 4, 2026, second
 * playtest). XP rates are RuneSpace's own (`tiers.ts`): Ferrite Shale
 * 15/hit, Galvanite 25/hit, locked until Mining 5.
 */
describe('Swing Lab v3: ore drops and tiers', () => {
  function setup() {
    const mouse = new MouseSource();
    const tracker = new BodyStateTracker();
    const game = new SwingLabGame(new SoundEffects());
    mouse.start(0);
    game.start();
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

  function doSwing(ctx: ReturnType<typeof setup>, t: number): number {
    ctx.mouse.setKeyArm('left', true);
    ctx.mouse.setKeyArm('right', true);
    step(ctx, t, t + 500);
    ctx.mouse.setKeyArm('left', false);
    ctx.mouse.setKeyArm('right', false);
    step(ctx, t + 500, t + 900);
    return t + 900;
  }

  /** Swing `count` times with the cooldown waited out between each. */
  function doSwings(ctx: ReturnType<typeof setup>, count: number): number {
    let t = 0;
    for (let i = 0; i < count; i += 1) {
      // A break starts the 3 s respawn wait: swings during it do not
      // count, so wait the node back before the next swing.
      if (i > 0 && ctx.game.snapshot().nodeGone) {
        step(ctx, t, t + 3600);
        t += 3600;
      }
      t = doSwing(ctx, t);
      step(ctx, t, t + 800);
      t += 800;
    }
    return t;
  }

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

  it('a hit spawns one ore drop that flies for 800ms, then clears', () => {
    const ctx = setup();
    expect(ctx.game.snapshot().oreDrops).toBe(0);
    doSwing(ctx, 0);
    expect(ctx.game.snapshot().oreDrops).toBe(1);
    expect(ctx.game.snapshot().tierId).toBe('ferrite-shale');
    // Still flying 500ms after the hit landed (~740ms in), gone after
    // its 800ms flight.
    step(ctx, 900, 1400);
    expect(ctx.game.snapshot().oreDrops).toBe(1);
    step(ctx, 1400, 1800);
    expect(ctx.game.snapshot().oreDrops).toBe(0);
  });

  it('Galvanite stays locked below Mining 5: selectTier refuses it', () => {
    const ctx = setup();
    expect(ctx.game.selectTier('galvanite', 0)).toBe(false);
    expect(ctx.game.snapshot().tierId).toBe('ferrite-shale');
    expect(ctx.game.snapshot().tierName).toBe('Ferrite Shale');
    // Unknown ids refuse too, without changing the mine.
    expect(ctx.game.selectTier('no-such-ore', 0)).toBe(false);
    expect(ctx.game.snapshot().tierId).toBe('ferrite-shale');
  });

  it('at Mining 5 Galvanite unlocks, pays 25 XP per hit, and restart returns to Ferrite Shale', () => {
    const ctx = setup();
    // 27 swings x 15 XP = 405 XP: Mining 5 (400 XP) with 5 XP spare.
    const t = doSwings(ctx, 27);
    const before = ctx.game.snapshot();
    expect(before.level).toBe(5);
    expect(before.xp).toBe(405);
    expect(ctx.game.selectTier('galvanite', t)).toBe(true);
    const switched = ctx.game.snapshot();
    expect(switched.tierId).toBe('galvanite');
    expect(switched.tierName).toBe('Galvanite');
    // Switching mines starts a fresh node.
    expect(switched.nodeHits).toBe(0);
    const xpBefore = switched.xp;
    const oreBefore = switched.ore;
    doSwing(ctx, t);
    const after = ctx.game.snapshot();
    expect(after.xp).toBe(xpBefore + 25);
    expect(after.ore).toBe(oreBefore + 1);
    expect(after.oreDrops).toBe(1);
    // A fresh game starts at Mining 1, so it starts on the level 1 mine.
    ctx.game.restart();
    expect(ctx.game.snapshot().tierId).toBe('ferrite-shale');
    expect(ctx.game.snapshot().level).toBe(1);
  });

  it('mine-selector chips: tapping Ferrite selects it, tapping locked Galvanite refuses', () => {
    const ctx = setup();
    const stub = stubContext();
    ctx.game.render(stub, 1000, null, null);
    // Chips are bottom-right (x 618..948): Ferrite row y 444..482,
    // Galvanite row y 490..528.
    expect(ctx.game.pointerDownAt(700, 463, 1000)).toBe(true);
    expect(ctx.game.snapshot().tierId).toBe('ferrite-shale');
    expect(ctx.game.pointerDownAt(700, 509, 1000)).toBe(false);
    expect(ctx.game.snapshot().tierId).toBe('ferrite-shale');
    // A tap outside the chips does nothing.
    expect(ctx.game.pointerDownAt(100, 100, 1000)).toBe(false);
  });
});

/**
 * v3 (addition, same round): node break lifecycle — hit effects, pieces
 * that fall off-screen with cleanup, 3 s respawn progress bar, fade-in.
 */
describe('Swing Lab v3: node break lifecycle', () => {
  function setup() {
    const mouse = new MouseSource();
    const tracker = new BodyStateTracker();
    const game = new SwingLabGame(new SoundEffects());
    mouse.start(0);
    game.start();
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

  function doSwing(ctx: ReturnType<typeof setup>, t: number): number {
    ctx.mouse.setKeyArm('left', true);
    ctx.mouse.setKeyArm('right', true);
    step(ctx, t, t + 500);
    ctx.mouse.setKeyArm('left', false);
    ctx.mouse.setKeyArm('right', false);
    step(ctx, t + 500, t + 900);
    return t + 900;
  }

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

  it('a hit throws debris chips that clear within a second', () => {
    const ctx = setup();
    expect(ctx.game.snapshot().particles).toBe(0);
    doSwing(ctx, 0);
    // 8 debris chips from the hit (no break yet: 1 hit of 5).
    expect(ctx.game.snapshot().particles).toBe(8);
    expect(ctx.game.snapshot().nodePieces).toBe(0);
    step(ctx, 900, 2000);
    expect(ctx.game.snapshot().particles).toBe(0);
  });

  it('the 5th hit breaks the node into 6 pieces that fall and are cleaned up', () => {
    const ctx = setup();
    let t = 0;
    for (let i = 0; i < 4; i += 1) {
      t = doSwing(ctx, t);
      step(ctx, t, t + 800);
      t += 800;
    }
    // 5th swing: sample the pieces the moment the node breaks — they
    // fall off the bottom within ~1 s, so a late snapshot sees few.
    let maxPieces = 0;
    ctx.mouse.setKeyArm('left', true);
    ctx.mouse.setKeyArm('right', true);
    step(ctx, t, t + 500);
    ctx.mouse.setKeyArm('left', false);
    ctx.mouse.setKeyArm('right', false);
    for (let s = t + 516; s <= t + 900; s += 16) {
      const frame = ctx.mouse.frameAt(s);
      if (frame === null) continue;
      const body = ctx.tracker.update(frame);
      ctx.game.update(16, s, body, frame.landmarks);
      maxPieces = Math.max(maxPieces, ctx.game.snapshot().nodePieces);
    }
    t += 900;
    step(ctx, t, t + 800);
    t += 800;
    const snap = ctx.game.snapshot();
    expect(snap.nodesBroken).toBe(1);
    expect(snap.nodeGone).toBe(true);
    expect(maxPieces).toBe(6);
    expect(snap.respawnProgress).toBeLessThan(1);
    // Pieces fall off the bottom / expire within ~1.2 s.
    step(ctx, t, t + 2000);
    expect(ctx.game.snapshot().nodePieces).toBe(0);
    // Render smoke: broken state + respawn bar draw without throwing.
    const stub = stubContext();
    expect(() => ctx.game.render(stub, t + 2000, null, null)).not.toThrow();
  });

  it('swings during the respawn wait do not count; the node returns after 3 s', () => {
    const ctx = setup();
    let t = 0;
    for (let i = 0; i < 5; i += 1) {
      t = doSwing(ctx, t);
      step(ctx, t, t + 800);
      t += 800;
    }
    const broken = ctx.game.snapshot();
    expect(broken.swings).toBe(5);
    expect(broken.ore).toBe(5);
    expect(broken.nodeGone).toBe(true);
    // About a third through the wait right after the break + 800ms pause.
    expect(broken.respawnProgress).toBeGreaterThan(0.2);
    expect(broken.respawnProgress).toBeLessThan(0.5);
    // Swing right away, inside the 3 s wait: nothing counts.
    t = doSwing(ctx, t);
    const waited = ctx.game.snapshot();
    expect(waited.swings).toBe(5);
    expect(waited.ore).toBe(5);
    expect(waited.xp).toBe(75);
    // Still gone just after that swing, bar about two-thirds full.
    expect(waited.nodeGone).toBe(true);
    expect(waited.respawnProgress).toBeGreaterThan(0.5);
    expect(waited.respawnProgress).toBeLessThan(0.8);
    // After the wait the node is back and minable again.
    step(ctx, t, t + 3600);
    const back = ctx.game.snapshot();
    expect(back.nodeGone).toBe(false);
    expect(back.respawnProgress).toBe(1);
    doSwing(ctx, t + 3600);
    expect(ctx.game.snapshot().swings).toBe(6);
  });

  it('many breaks leave no accumulated pieces, particles or drops (bounded cleanup)', () => {
    const ctx = setup();
    let maxPieces = 0;
    let maxParticles = 0;
    let t = 0;
    for (let b = 0; b < 6; b += 1) {
      for (let i = 0; i < 5; i += 1) {
        t = doSwing(ctx, t);
        step(ctx, t, t + 800);
        t += 800;
        const snap = ctx.game.snapshot();
        maxPieces = Math.max(maxPieces, snap.nodePieces);
        maxParticles = Math.max(maxParticles, snap.particles);
      }
      // Wait the node back (respawn + fade-in) before the next node.
      step(ctx, t, t + 3600);
      t += 3600;
    }
    const snap = ctx.game.snapshot();
    expect(snap.nodesBroken).toBe(6);
    expect(snap.nodePieces).toBe(0);
    expect(snap.particles).toBe(0);
    expect(snap.oreDrops).toBe(0);
    // One break's pieces at a time, never an accumulation across nodes.
    expect(maxPieces).toBeLessThanOrEqual(6);
    // One hit's debris (8) + one break's sparkles (24), no pile-up.
    expect(maxParticles).toBeLessThanOrEqual(40);
  });
});
