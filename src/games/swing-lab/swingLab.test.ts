import { describe, expect, it } from 'vitest';
import { SoundEffects } from '../../core/audio';
import { BodyStateTracker } from '../../core/bodyState';
import { MouseSource } from '../../sim/mouseSource';
import {
  cracksForHits,
  miningLevel,
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
   * 300ms, release, then let the drop finish. Returns the end time.
   */
  function doSwing(ctx: ReturnType<typeof setup>, t: number): number {
    ctx.mouse.setKeyArm('left', true);
    ctx.mouse.setKeyArm('right', true);
    step(ctx, t, t + 300);
    ctx.mouse.setKeyArm('left', false);
    ctx.mouse.setKeyArm('right', false);
    step(ctx, t + 300, t + 700);
    return t + 700;
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
    // Swing again immediately (hit was ~450ms ago, cooldown is 700ms).
    t = doSwing(ctx, t);
    expect(ctx.game.snapshot().swings).toBe(1);
    // After waiting out the cooldown, a swing counts again.
    step(ctx, t, t + 800);
    t = doSwing(ctx, t + 800);
    void t;
    expect(ctx.game.snapshot().swings).toBe(2);
  });

  it('a single-arm swing counts (one-handed play works)', () => {
    const ctx = setup();
    ctx.mouse.setKeyArm('left', true);
    step(ctx, 0, 300);
    ctx.mouse.setKeyArm('left', false);
    step(ctx, 300, 700);
    const snap = ctx.game.snapshot();
    expect(snap.swings).toBe(1);
    expect(snap.lastHandedness).toBe('left');
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
