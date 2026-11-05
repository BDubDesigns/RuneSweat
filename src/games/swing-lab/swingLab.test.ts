import { describe, expect, it } from 'vitest';
import { SoundEffects } from '../../core/audio';
import type { BodyState } from '../../core/bodyState';
import { BodyStateTracker } from '../../core/bodyState';
import { MouseSource } from '../../sim/mouseSource';
import {
  cracksForHits,
  miningLevel,
  nodeCenterForBody,
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

  it('hold-then-release produces a HIT: +1 ore, +10 XP', () => {
    const ctx = setup();
    const end = doSwing(ctx, 0);
    void end;
    const snap = ctx.game.snapshot();
    expect(snap.swings).toBe(1);
    expect(snap.ore).toBe(1);
    expect(snap.xp).toBe(10);
    expect(snap.level).toBe(1);
    expect(snap.nodeHits).toBe(1);
    expect(snap.cracks).toBe(1);
    expect(snap.lastEvent?.kind).toBe('hit');
    expect(snap.lastHandedness).toBe('two-handed');
  });

  it('five hits break the node and spawn a new one', () => {
    const ctx = setup();
    let t = 0;
    for (let i = 0; i < 5; i += 1) {
      t = doSwing(ctx, t);
      // Wait out the 700ms hit cooldown before the next swing.
      step(ctx, t, t + 800);
      t += 800;
    }
    const snap = ctx.game.snapshot();
    expect(snap.swings).toBe(5);
    expect(snap.ore).toBe(5);
    expect(snap.xp).toBe(50);
    expect(snap.nodesBroken).toBe(1);
    expect(snap.nodeHits).toBe(0);
    expect(snap.cracks).toBe(0);
  });

  it('ten hits reach Mining level 2', () => {
    const ctx = setup();
    let t = 0;
    for (let i = 0; i < 10; i += 1) {
      t = doSwing(ctx, t);
      step(ctx, t, t + 800);
      t += 800;
    }
    const snap = ctx.game.snapshot();
    expect(snap.xp).toBe(100);
    expect(snap.level).toBe(2);
    expect(snap.xpIntoLevel).toBe(0);
  });

  it('a second swing inside the cooldown does not count', () => {
    const ctx = setup();
    let t = doSwing(ctx, 0);
    expect(ctx.game.snapshot().swings).toBe(1);
    // Swing again immediately (the first hit landed ~740ms in, so the
    // 700ms cooldown runs to ~1440ms — this swing's hold and drop fall
    // inside it and are ignored).
    t = doSwing(ctx, t);
    expect(ctx.game.snapshot().swings).toBe(1);
    // After waiting out the cooldown, a swing counts again.
    step(ctx, t, t + 800);
    t = doSwing(ctx, t + 800);
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

  it('hudHtml shows level, XP, ore and swing phase', () => {
    const ctx = setup();
    doSwing(ctx, 0);
    const html = ctx.game.hudHtml();
    expect(html).toContain('Mining Lv 1');
    expect(html).toContain('10/100 XP');
    expect(html).toContain('Ore 1');
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

  it('node sits at the hip-centre x, rock-top around waist height', () => {
    const body = fakeBody({ torsoX: 0.4, torsoY: 0.55 });
    const { x, y } = nodeCenterForBody(body, 960, 540);
    // Mirrored hip x: (1 - 0.4) * 960 = 576.
    expect(x).toBeCloseTo(576, 6);
    // Rock radius is 0.15 * 540 = 81; centre is half a radius below the hips.
    expect(y).toBeCloseTo(0.55 * 540 + 81 * 0.5, 6);
  });

  it('node follows the body when the player moves sideways', () => {
    const left = nodeCenterForBody(fakeBody({ torsoX: 0.65 }), 960, 540);
    const right = nodeCenterForBody(fakeBody({ torsoX: 0.35 }), 960, 540);
    expect(left.x).toBeLessThan(right.x);
    expect(left.x).toBeCloseTo((1 - 0.65) * 960, 6);
    expect(right.x).toBeCloseTo((1 - 0.35) * 960, 6);
  });

  it('node falls back to stage centre with no body', () => {
    expect(nodeCenterForBody(null, 960, 540)).toEqual({
      x: 480,
      y: 540 * 0.62,
    });
    expect(nodeCenterForBody(fakeBody({ present: false }), 960, 540)).toEqual({
      x: 480,
      y: 540 * 0.62,
    });
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
