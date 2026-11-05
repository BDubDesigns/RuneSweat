/**
 * Tests for Space Invaders (src/games/space-invaders/spaceInvaders.ts).
 *
 * Pure helpers are tested directly; the game class is driven through its
 * public update() with fake bodies — no canvas, no camera, no MediaPipe.
 * The fixed timestep is 1000/60 ms per step, exactly like the real loop.
 */

import { describe, expect, it, vi } from 'vitest';
import { BODY, INVADERS, STAGE } from '../../core/config';
import type { SoundEffects } from '../../core/audio';
import type { ArmState, BodyState } from '../../core/bodyState';
import {
  circleRectHit,
  levelBulletSpeed,
  levelEnemySpeed,
  levelFireInterval,
  missileDirection,
  nextArmFireState,
  shipTargetX,
  SpaceInvadersGame,
  type ArmFireState,
} from './spaceInvaders';

const DT_MS = 1000 / 60;
/** The game's pre-render playfield size is the fixed STAGE, not the video. */
const WIDTH = STAGE.width;

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

function makeSfx(): {
  sfx: SoundEffects;
  calls: { shoot: number; reload: number; hit: number; win: number };
} {
  const calls = { shoot: 0, reload: 0, hit: 0, win: 0 };
  const sfx = {
    shoot: (): void => {
      calls.shoot += 1;
    },
    reload: (): void => {
      calls.reload += 1;
    },
    hit: (): void => {
      calls.hit += 1;
    },
    win: (): void => {
      calls.win += 1;
    },
  } as unknown as SoundEffects;
  return { sfx, calls };
}

function makeArm(overrides: Partial<ArmState> & { side: ArmState['side'] }): ArmState {
  return {
    raised: false,
    extended: false,
    angleDeg: 0,
    angleDegRaw: 0,
    lengthTorsoFrac: 1,
    ...overrides,
  };
}

function makeBody(
  torsoX: number,
  left: ArmState,
  right: ArmState,
): BodyState {
  return {
    present: true,
    inFrame: true,
    bodyUsable: true,
    landmarkVisibility: {
      leftShoulder: 0.99,
      rightShoulder: 0.99,
      leftHip: 0.99,
      rightHip: 0.99,
      leftKnee: 0.99,
      rightKnee: 0.99,
    },
    kneesVisible: true,
    shoulderY: 0.25,
    leftWristX: 0.39,
    rightWristX: 0.61,
    leftWristY: 0.56,
    rightWristY: 0.56,
    leftWristVelY: 0,
    rightWristVelY: 0,
    torsoX,
    torsoY: 0.5,
    torsoLength: 0.3,
    shoulderWidthTorsoFrac: 0.22 / 0.3,
    noseOffsetTorsoFrac: 0,
    wristLatchSwapped: false,
    visibilityScore: 1,
    leftArm: left,
    rightArm: right,
    jumping: false,
    ducking: false,
    hipBaselineY: 0.55,
    timestampMs: 0,
  };
}

/** Raised + extended arm, straight up. */
function raisedArm(side: ArmState['side']): ArmState {
  return makeArm({ side, raised: true, extended: true, angleDeg: 0 });
}

/** Lowered arm. */
function loweredArm(side: ArmState['side']): ArmState {
  return makeArm({ side, raised: false, extended: false, angleDeg: 0 });
}

/** A running game with its own clock, driven step by step. */
function makeDriver(): {
  game: SpaceInvadersGame;
  calls: { shoot: number; reload: number; hit: number; win: number };
  step: (n: number, body: BodyState | null) => void;
} {
  const { sfx, calls } = makeSfx();
  const game = new SpaceInvadersGame(sfx);
  game.start();
  let now = 0;
  return {
    game,
    calls,
    step(n: number, body: BodyState | null): void {
      for (let i = 0; i < n; i++) {
        now += DT_MS;
        game.update(DT_MS, now, body, null);
      }
    },
  };
}

function idleBody(torsoX = 0.5): BodyState {
  return makeBody(torsoX, loweredArm('left'), loweredArm('right'));
}

/* ------------------------------------------------------------------ */
/* Missile direction                                                   */
/* ------------------------------------------------------------------ */

describe('missileDirection', () => {
  it('fires straight up at 0 degrees', () => {
    expect(missileDirection(0)).toEqual({ x: 0, y: -1 });
  });

  it('snaps to straight up inside the tolerance, both sides', () => {
    expect(missileDirection(BODY.straightUpToleranceDeg)).toEqual({
      x: 0,
      y: -1,
    });
    expect(missileDirection(-BODY.straightUpToleranceDeg)).toEqual({
      x: 0,
      y: -1,
    });
    expect(missileDirection(5)).toEqual({ x: 0, y: -1 });
  });

  it('angles with the arm outside the tolerance, mirrored to canvas space', () => {
    const dir = missileDirection(30);
    // Video-right is canvas-left, so x is negative; y stays up.
    expect(dir.x).toBeCloseTo(-Math.sin((30 * Math.PI) / 180), 10);
    expect(dir.y).toBeCloseTo(-Math.cos((30 * Math.PI) / 180), 10);
    expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1, 10);
  });

  it('clamps at the max fire angle', () => {
    expect(missileDirection(90)).toEqual(
      missileDirection(BODY.maxFireAngleDeg),
    );
    expect(missileDirection(-120)).toEqual(
      missileDirection(-BODY.maxFireAngleDeg),
    );
    const dir = missileDirection(90);
    expect(dir.x).toBeCloseTo(-Math.sin((60 * Math.PI) / 180), 10);
    expect(dir.y).toBeCloseTo(-Math.cos((60 * Math.PI) / 180), 10);
  });
});

/* ------------------------------------------------------------------ */
/* Ship mapping                                                        */
/* ------------------------------------------------------------------ */

describe('shipTargetX', () => {
  it('maps torsoX 0 to shipMinX and torsoX 1 to shipMaxX', () => {
    expect(shipTargetX(0, WIDTH)).toBeCloseTo(INVADERS.shipMinX * WIDTH, 10);
    expect(shipTargetX(1, WIDTH)).toBeCloseTo(INVADERS.shipMaxX * WIDTH, 10);
  });

  it('maps torsoX 0.5 to the middle of the playfield', () => {
    expect(shipTargetX(0.5, WIDTH)).toBeCloseTo(WIDTH / 2, 10);
  });

  it('clamps torsoX outside [0, 1]', () => {
    expect(shipTargetX(-0.5, WIDTH)).toBeCloseTo(
      INVADERS.shipMinX * WIDTH,
      10,
    );
    expect(shipTargetX(1.5, WIDTH)).toBeCloseTo(
      INVADERS.shipMaxX * WIDTH,
      10,
    );
  });
});

/* ------------------------------------------------------------------ */
/* Level scaling                                                       */
/* ------------------------------------------------------------------ */

describe('level scaling', () => {
  it('enemy speed grows by levelSpeedMultiplier per level', () => {
    expect(levelEnemySpeed(1)).toBeCloseTo(INVADERS.enemySpeedPxPerSec, 10);
    expect(levelEnemySpeed(2)).toBeCloseTo(
      INVADERS.enemySpeedPxPerSec * INVADERS.levelSpeedMultiplier,
      10,
    );
    expect(levelEnemySpeed(3)).toBeCloseTo(
      INVADERS.enemySpeedPxPerSec *
        INVADERS.levelSpeedMultiplier *
        INVADERS.levelSpeedMultiplier,
      10,
    );
  });

  it('bullet speed grows additively per level', () => {
    expect(levelBulletSpeed(1)).toBeCloseTo(
      INVADERS.enemyBulletSpeedPxPerSec,
      10,
    );
    expect(levelBulletSpeed(2)).toBeCloseTo(
      INVADERS.enemyBulletSpeedPxPerSec + INVADERS.levelBulletSpeedAdd,
      10,
    );
    expect(levelBulletSpeed(3)).toBeCloseTo(
      INVADERS.enemyBulletSpeedPxPerSec + 2 * INVADERS.levelBulletSpeedAdd,
      10,
    );
  });

  it('fire interval shrinks per level (enemies shoot more often)', () => {
    expect(levelFireInterval(1)).toBeCloseTo(
      INVADERS.enemyFireIntervalSec,
      10,
    );
    expect(levelFireInterval(2)).toBeCloseTo(
      INVADERS.enemyFireIntervalSec / INVADERS.levelSpeedMultiplier,
      10,
    );
    expect(levelFireInterval(2)).toBeLessThan(levelFireInterval(1));
  });
});

/* ------------------------------------------------------------------ */
/* Collision helper                                                    */
/* ------------------------------------------------------------------ */

describe('circleRectHit', () => {
  it('hits when the circle centre is inside the rect', () => {
    expect(circleRectHit(50, 50, 6, 40, 40, 20, 20)).toBe(true);
  });

  it('hits when the circle overlaps an edge', () => {
    expect(circleRectHit(38, 50, 6, 40, 40, 20, 20)).toBe(true);
  });

  it('misses when the circle is clear of the rect', () => {
    expect(circleRectHit(10, 10, 6, 40, 40, 20, 20)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Arm fire state machine (pure)                                       */
/* ------------------------------------------------------------------ */

describe('nextArmFireState', () => {
  const canFire = makeArm({
    side: 'left',
    raised: true,
    extended: true,
    angleDeg: 0,
  });
  const held = canFire;
  const lowered = makeArm({ side: 'left', raised: false, extended: false });
  const bent = makeArm({
    side: 'left',
    raised: true,
    extended: false,
    angleDeg: 0,
  });

  it('ready + raised/extended fires once', () => {
    const step: { fired: boolean; reloaded: boolean; state: ArmFireState } =
      nextArmFireState('ready', canFire);
    expect(step).toEqual({ fired: true, reloaded: false, state: 'fired' });
  });

  it('holding the arm up does not refire', () => {
    const step = nextArmFireState('fired', held);
    expect(step).toEqual({ fired: false, reloaded: false, state: 'fired' });
  });

  it('lowering the arm after firing reloads', () => {
    const step = nextArmFireState('fired', lowered);
    expect(step).toEqual({ fired: false, reloaded: true, state: 'ready' });
  });

  it('raising again after a reload fires again', () => {
    const afterReload = nextArmFireState('fired', lowered);
    expect(afterReload.state).toBe('ready');
    const again = nextArmFireState(afterReload.state, canFire);
    expect(again).toEqual({ fired: true, reloaded: false, state: 'fired' });
  });

  it('a raised but bent arm never fires', () => {
    expect(nextArmFireState('ready', bent).fired).toBe(false);
    expect(nextArmFireState('ready', bent).state).toBe('ready');
  });

  it('a lowered arm never fires', () => {
    expect(nextArmFireState('ready', lowered).fired).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Game behaviour                                                      */
/* ------------------------------------------------------------------ */

describe('SpaceInvadersGame', () => {
  it('starts with 3 lives, level 1, score 0, 15 enemies, centred ship', () => {
    const d = makeDriver();
    const snap = d.game.snapshot();
    expect(snap.lives).toBe(3);
    expect(snap.level).toBe(1);
    expect(snap.score).toBe(0);
    expect(snap.enemiesAlive).toBe(INVADERS.rows * INVADERS.cols);
    expect(snap.shipX).toBeCloseTo(WIDTH / 2, 6);
    expect(snap.gameOver).toBe(false);
  });

  it('ship follows the torso and converges on the mapped target', () => {
    const d = makeDriver();
    d.step(60, idleBody(0.9));
    expect(d.game.snapshot().shipX).toBeCloseTo(shipTargetX(0.9, WIDTH), 1);
    d.step(60, idleBody(0.1));
    expect(d.game.snapshot().shipX).toBeCloseTo(shipTargetX(0.1, WIDTH), 1);
  });

  it('ship stays put when no body is detected', () => {
    const d = makeDriver();
    d.step(30, idleBody(0.9));
    const before = d.game.snapshot().shipX;
    d.step(30, null);
    expect(d.game.snapshot().shipX).toBeCloseTo(before, 10);
  });

  it('raise fires one missile, hold does not refire, lower reloads, raise fires again', () => {
    const d = makeDriver();
    const raised = makeBody(0.5, raisedArm('left'), loweredArm('right'));
    const lowered = idleBody(0.5);

    d.step(1, raised);
    expect(d.calls.shoot).toBe(1);
    expect(d.game.snapshot().missiles.length).toBe(1);

    d.step(30, raised);
    expect(d.calls.shoot).toBe(1);

    d.step(5, lowered);
    expect(d.calls.reload).toBe(1);
    expect(d.game.hudHtml()).toContain('Left: Reloaded!');

    d.step(1, raised);
    expect(d.calls.shoot).toBe(2);
    expect(d.game.snapshot().missiles.length).toBe(1);
  });

  it('each arm fires independently', () => {
    const d = makeDriver();
    const both = makeBody(0.5, raisedArm('left'), raisedArm('right'));
    d.step(1, both);
    expect(d.calls.shoot).toBe(2);
    expect(d.game.snapshot().missiles.length).toBe(2);
  });

  it('a missile hitting an enemy removes it and scores 100', () => {
    const d = makeDriver();
    // Ship centred under the middle column; straight-up shot.
    d.step(60, makeBody(0.5, raisedArm('left'), loweredArm('right')));
    const snap = d.game.snapshot();
    expect(snap.score).toBe(INVADERS.pointsPerEnemy);
    expect(snap.enemiesAlive).toBe(INVADERS.rows * INVADERS.cols - 1);
    expect(d.calls.shoot).toBe(1);
  });

  it('a missile fired wide of the formation scores nothing', () => {
    const d = makeDriver();
    // Move the ship hard left first (no firing), then fire: the missile
    // goes up from x=38, well left of the formation, and scores nothing.
    d.step(120, idleBody(0));
    d.step(120, makeBody(0, raisedArm('left'), loweredArm('right')));
    const snap = d.game.snapshot();
    expect(snap.score).toBe(0);
    expect(snap.enemiesAlive).toBe(INVADERS.rows * INVADERS.cols);
  });

  it('an enemy bullet hitting the ship costs a life and starts grace', () => {
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const d = makeDriver();
      let hitAtStep = -1;
      for (let i = 0; i < 500; i++) {
        const snap = d.game.snapshot();
        if (snap.lives < 3) {
          hitAtStep = i;
          break;
        }
        // Stand under the falling bullet once one exists, else centre.
        const bullet = snap.bullets[0];
        const torsoX = bullet !== undefined ? bullet.x / WIDTH : 0.5;
        d.step(1, idleBody(torsoX));
      }
      expect(hitAtStep).toBeGreaterThan(0);
      expect(d.calls.hit).toBe(1);
      const snap = d.game.snapshot();
      expect(snap.lives).toBe(2);
      expect(snap.invulnerable).toBe(true);
    } finally {
      randSpy.mockRestore();
    }
  });

  it('invulnerability expires after hitGraceSec', () => {
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const d = makeDriver();
      for (let i = 0; i < 500; i++) {
        const snap = d.game.snapshot();
        if (snap.lives < 3) break;
        const bullet = snap.bullets[0];
        const torsoX = bullet !== undefined ? bullet.x / WIDTH : 0.5;
        d.step(1, idleBody(torsoX));
      }
      expect(d.game.snapshot().invulnerable).toBe(true);
      // 1.5 s of grace = 90 steps; step a little past it.
      d.step(100, idleBody(0.5));
      expect(d.game.snapshot().invulnerable).toBe(false);
    } finally {
      randSpy.mockRestore();
    }
  });

  it('losing all lives ends the game and freezes the score', () => {
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const d = makeDriver();
      for (let i = 0; i < 3000; i++) {
        const snap = d.game.snapshot();
        if (snap.gameOver) break;
        // Chase every bullet: stand under it until it hits or passes.
        const bullet = snap.bullets[0];
        const torsoX = bullet !== undefined ? bullet.x / WIDTH : 0.5;
        d.step(1, idleBody(torsoX));
      }
      const snap = d.game.snapshot();
      expect(snap.gameOver).toBe(true);
      expect(snap.lives).toBe(0);
      const scoreAtEnd = snap.score;
      d.step(60, idleBody(0.5));
      expect(d.game.snapshot().score).toBe(scoreAtEnd);
    } finally {
      randSpy.mockRestore();
    }
  });

  it('restart() resets score, lives, level and enemies after game over', () => {
    const d = makeDriver();
    d.step(60, makeBody(0.5, raisedArm('left'), loweredArm('right')));
    expect(d.game.snapshot().score).toBeGreaterThan(0);
    d.game.restart();
    const snap = d.game.snapshot();
    expect(snap.score).toBe(0);
    expect(snap.lives).toBe(3);
    expect(snap.level).toBe(1);
    expect(snap.enemiesAlive).toBe(INVADERS.rows * INVADERS.cols);
    expect(snap.gameOver).toBe(false);
  });

  it('pause() freezes the simulation', () => {
    const d = makeDriver();
    d.step(30, idleBody(0.9));
    const before = d.game.snapshot();
    d.game.pause();
    expect(d.game.paused).toBe(true);
    d.step(60, idleBody(0.1));
    const after = d.game.snapshot();
    expect(after.shipX).toBeCloseTo(before.shipX, 10);
    expect(after.enemies[0]?.x).toBeCloseTo(before.enemies[0]?.x ?? 0, 10);
    d.game.resume();
    expect(d.game.paused).toBe(false);
  });

  it('clearing the formation levels up with the level bonus and a win jingle', () => {
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const d = makeDriver();
      let cleared = false;
      // Parked sniper: the ship never leaves x=57.6 (torsoX=0 -> shipMinX
      // 0.06 of the 960-wide stage). Enemy bullets come from the middle
      // column (mocked random), whose x stays in [166,794], so the far-left
      // edge is never under a bullet — the bot cannot die, and the test
      // measures the level-clear mechanic, not bot dodging skill. Fire
      // straight up only when an alive enemy is near-directly above (the
      // leftmost column's closest approach is x=38, ~20px from the ship,
      // so the window is 25px, not 10px); every column marches to the
      // left edge eventually.
      for (let i = 0; i < 12000; i++) {
        const snap = d.game.snapshot();
        if (snap.level === 2) {
          cleared = true;
          break;
        }
        if (snap.gameOver) break;
        const above = snap.enemies.some(
          (e) => Math.abs(e.x - snap.shipX) < 25,
        );
        const raise = snap.missiles.length === 0 && above;
        const body = makeBody(
          0,
          raise ? raisedArm('left') : loweredArm('left'),
          loweredArm('right'),
        );
        d.step(1, body);
      }
      expect(cleared).toBe(true);
      expect(d.calls.win).toBe(1);
      const snap = d.game.snapshot();
      expect(snap.level).toBe(2);
      expect(snap.score).toBeGreaterThanOrEqual(
        INVADERS.rows * INVADERS.cols * INVADERS.pointsPerEnemy +
          INVADERS.pointsPerLevel,
      );
      expect(snap.enemiesAlive).toBe(INVADERS.rows * INVADERS.cols);
    } finally {
      randSpy.mockRestore();
    }
  });

  it('hudHtml shows score, hearts, level and both arm states', () => {
    const d = makeDriver();
    const hud = d.game.hudHtml();
    expect(hud).toContain('Score 0');
    expect(hud).toContain('❤️❤️❤️');
    expect(hud).toContain('Level 1');
    expect(hud).toContain('Left: Ready');
    expect(hud).toContain('Right: Ready');
  });
});
