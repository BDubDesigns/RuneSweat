/**
 * Space Invaders — body-controlled, for Lara (age 5).
 *
 * Move the ship by moving your body left/right (torsoX). Raise either arm
 * (straight + extended) to fire ONE missile at that arm's angle — straight
 * up when the arm is near vertical, angled otherwise. Lower the arm to
 * reload. Enemies march across, step down at the edges, and shoot back
 * slowly; clear the formation to level up.
 *
 * The game owns only its simulation + canvas drawing + HUD string. It never
 * touches landmarks directly, the camera, or the DOM. All tuning lives in
 * `core/config.ts` (INVADERS / BODY); this file only reads it.
 */

import { BODY, INVADERS, RENDER, SOURCE } from '../../core/config';
import type { SoundEffects } from '../../core/audio';
import { armCanFire, armDirectionCanvas } from '../../core/bodyState';
import type { ArmSide, ArmState, BodyState } from '../../core/bodyState';
import { clamp, lerp } from '../../render/stage';
import type { Game } from '../game';
import type { NormalizedLandmark } from '../../tracking/poseTypes';

/** Ship geometry (px, canvas space). */
const SHIP_WIDTH_PX = 64;
const SHIP_HEIGHT_PX = 28;
/** Ship sits this far above the bottom edge. */
const SHIP_Y_OFFSET_PX = 70;

/** Enemy geometry (px, canvas space). */
const ENEMY_WIDTH_PX = 44;
const ENEMY_HEIGHT_PX = 32;
const ENEMY_SPACING_X_PX = 64;
const ENEMY_SPACING_Y_PX = 50;
/** How close an enemy may get to a side edge before the row reverses. */
const ENEMY_EDGE_MARGIN_PX = 16;

const BULLET_RADIUS_PX = 5;
/** "Level N!" banner length, in ms. No enemy fire while it shows. */
const LEVEL_BANNER_MS = 1500;
/** "Reloaded!" flash length in the HUD, in ms. */
const RELOAD_FLASH_MS = 1200;

interface Missile {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Enemy {
  x: number;
  y: number;
  row: number;
  col: number;
  alive: boolean;
}

interface EnemyBullet {
  x: number;
  y: number;
}

/** Per-arm fire state: `ready` = can fire on the next raise. */
export type ArmFireState = 'ready' | 'fired';

export interface ArmFireStep {
  /** A missile was fired on this step. */
  fired: boolean;
  /** The arm was lowered after firing: reload happened on this step. */
  reloaded: boolean;
  state: ArmFireState;
}

/**
 * Pure per-arm fire state machine. `ready` -> `fired` on the rising edge of
 * `armCanFire(arm)`; holding the arm up never refires; lowering the arm
 * after firing reloads back to `ready`.
 */
export function nextArmFireState(
  prev: ArmFireState,
  arm: ArmState,
): ArmFireStep {
  if (prev === 'ready') {
    if (armCanFire(arm)) {
      return { fired: true, reloaded: false, state: 'fired' };
    }
    return { fired: false, reloaded: false, state: 'ready' };
  }
  // prev === 'fired'
  if (!arm.raised) {
    return { fired: false, reloaded: true, state: 'ready' };
  }
  return { fired: false, reloaded: false, state: 'fired' };
}

/** Ship target x (px) for a torso position in normalized video space. */
export function shipTargetX(torsoX: number, width: number): number {
  const frac = lerp(INVADERS.shipMinX, INVADERS.shipMaxX, clamp(torsoX, 0, 1));
  return frac * width;
}

/** Enemy horizontal speed (px/s) at a level. */
export function levelEnemySpeed(level: number): number {
  return (
    INVADERS.enemySpeedPxPerSec *
    Math.pow(INVADERS.levelSpeedMultiplier, level - 1)
  );
}

/** Enemy bullet speed (px/s) at a level. */
export function levelBulletSpeed(level: number): number {
  return (
    INVADERS.enemyBulletSpeedPxPerSec +
    INVADERS.levelBulletSpeedAdd * (level - 1)
  );
}

/** Seconds between enemy volleys at a level. */
export function levelFireInterval(level: number): number {
  return (
    INVADERS.enemyFireIntervalSec /
    Math.pow(INVADERS.levelSpeedMultiplier, level - 1)
  );
}

/**
 * Canvas-space unit direction for a missile fired from an arm at
 * `angleDeg` (video space, 0 = straight up). Snaps to straight up inside
 * the tolerance; otherwise follows the arm, clamped at the max fire angle
 * by {@link armDirectionCanvas}.
 */
export function missileDirection(angleDeg: number): { x: number; y: number } {
  if (Math.abs(angleDeg) <= BODY.straightUpToleranceDeg) {
    return { x: 0, y: -1 };
  }
  return armDirectionCanvas(angleDeg);
}

/** Circle (missile / bullet) vs axis-aligned rect overlap test. */
export function circleRectHit(
  cx: number,
  cy: number,
  r: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  const nx = clamp(cx, rx, rx + rw);
  const ny = clamp(cy, ry, ry + rh);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

/** Read-only snapshot of the live state, for the debug HUD and tests. */
export interface SpaceInvadersSnapshot {
  score: number;
  lives: number;
  level: number;
  gameOver: boolean;
  paused: boolean;
  shipX: number;
  shipY: number;
  /** +1 while marching right, -1 while marching left. */
  enemyDir: number;
  /** True while a hit-grace window is active (ship blinks). */
  invulnerable: boolean;
  enemiesAlive: number;
  enemies: readonly { x: number; y: number; row: number; col: number }[];
  missiles: readonly { x: number; y: number }[];
  bullets: readonly { x: number; y: number }[];
  leftArm: ArmFireState;
  rightArm: ArmFireState;
}

export class SpaceInvadersGame implements Game {
  public readonly id = 'space-invaders';
  public readonly title = 'Space Invaders';
  public paused = false;

  private readonly sfx: SoundEffects;

  private score = 0;
  private lives: number = INVADERS.lives;
  private level = 1;
  private gameOver = false;

  /** Ship x as a fraction of the playfield width (0..1). */
  private shipXNorm = 0.5;
  /** Last canvas size seen in render(); update() runs before any render. */
  private lastWidth: number = SOURCE.width;
  private lastHeight: number = SOURCE.height;
  private lastNowMs = 0;

  private missiles: Missile[] = [];
  private enemies: Enemy[] = [];
  private enemyDir = 1;
  private bullets: EnemyBullet[] = [];
  private fireTimerSec = 0;
  private invulnerableUntilMs = 0;
  private levelBannerUntilMs = 0;
  private reloadFlashSide: ArmSide | null = null;
  private reloadFlashUntilMs = 0;
  private hasFiredEver = false;
  private leftArmState: ArmFireState = 'ready';
  private rightArmState: ArmFireState = 'ready';

  public constructor(sfx: SoundEffects) {
    this.sfx = sfx;
    this.buildFormation();
  }

  public start(): void {
    this.reset();
    this.paused = false;
  }

  public stop(): void {
    this.paused = true;
  }

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    this.paused = false;
  }

  public restart(): void {
    this.reset();
    this.paused = false;
  }

  public update(
    dtMs: number,
    nowMs: number,
    body: BodyState | null,
    _landmarks: readonly NormalizedLandmark[] | null,
  ): void {
    this.lastNowMs = nowMs;
    if (this.paused || this.gameOver) return;

    const dtSec = dtMs / 1000;
    const width = this.lastWidth;
    const height = this.lastHeight;
    const shipY = this.shipY(height);

    // Ship follows the torso (exponential approach toward the target).
    // No body -> the ship stays where it is.
    if (body !== null) {
      const targetNorm = shipTargetX(body.torsoX, width) / width;
      this.shipXNorm = lerp(
        this.shipXNorm,
        targetNorm,
        INVADERS.shipFollowRate,
      );
    }
    const shipX = this.shipXNorm * width;

    // Firing, one state machine per arm.
    if (body !== null) {
      this.stepArm('left', body.leftArm, shipX, shipY);
      this.stepArm('right', body.rightArm, shipX, shipY);
    }

    this.updateMissiles(dtSec, width);
    this.checkLevelClear(nowMs);

    // Enemies march + shoot, unless the level banner is showing.
    if (nowMs >= this.levelBannerUntilMs) {
      this.updateEnemies(dtSec, width, shipY);
    }

    this.updateBullets(dtSec, height, shipX, shipY, nowMs);
  }

  public render(
    ctx: CanvasRenderingContext2D,
    nowMs: number,
    body: BodyState | null,
    _landmarks: readonly NormalizedLandmark[] | null,
  ): void {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    this.lastWidth = width;
    this.lastHeight = height;
    const shipX = this.shipXNorm * width;
    const shipY = this.shipY(height);

    for (const enemy of this.enemies) {
      if (enemy.alive) this.drawEnemy(ctx, enemy);
    }

    ctx.save();
    ctx.fillStyle = '#ff5252';
    for (const bullet of this.bullets) {
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, BULLET_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    for (const missile of this.missiles) {
      this.drawMissile(ctx, missile);
    }

    // Ship blinks while invulnerable after a hit.
    const invulnerable = nowMs < this.invulnerableUntilMs;
    const blinkOff = invulnerable && Math.floor(nowMs / 150) % 2 === 0;
    if (!blinkOff) this.drawShip(ctx, shipX, shipY);

    if (this.gameOver) {
      this.drawCenterLines(ctx, width, height, [
        { text: 'Game Over!', size: 48 },
        { text: `Score ${this.score}`, size: 28 },
        { text: 'Press Restart to play again', size: 24 },
      ]);
    } else if (nowMs < this.levelBannerUntilMs) {
      this.drawCenterLines(ctx, width, height, [
        { text: `Level ${this.level}!`, size: 48 },
      ]);
    } else if (!this.hasFiredEver) {
      this.drawCenterLines(ctx, width, height, [
        {
          text:
            body !== null ? 'Raise an arm to shoot!' : 'Step into frame!',
          size: 32,
        },
      ]);
    }
  }

  public hudHtml(): string {
    const hearts =
      '❤️'.repeat(Math.max(0, this.lives)) +
      '🖤'.repeat(Math.max(0, INVADERS.lives - this.lives));
    return (
      `<span>⭐ Score ${this.score}</span> &nbsp; ` +
      `<span>${hearts}</span> &nbsp; ` +
      `<span>🚀 Level ${this.level}</span> &nbsp; ` +
      `<span>🔫 Left: ${this.armStatus('left')} · Right: ${this.armStatus('right')}</span>`
    );
  }

  /** Read-only snapshot of the live state, for the debug HUD and tests. */
  public snapshot(): SpaceInvadersSnapshot {
    return {
      score: this.score,
      lives: this.lives,
      level: this.level,
      gameOver: this.gameOver,
      paused: this.paused,
      shipX: this.shipXNorm * this.lastWidth,
      shipY: this.shipY(this.lastHeight),
      enemyDir: this.enemyDir,
      invulnerable: this.lastNowMs < this.invulnerableUntilMs,
      enemiesAlive: this.enemies.filter((e) => e.alive).length,
      enemies: this.enemies
        .filter((e) => e.alive)
        .map((e) => ({ x: e.x, y: e.y, row: e.row, col: e.col })),
      missiles: this.missiles.map((m) => ({ x: m.x, y: m.y })),
      bullets: this.bullets.map((b) => ({ x: b.x, y: b.y })),
      leftArm: this.leftArmState,
      rightArm: this.rightArmState,
    };
  }

  private shipY(height: number): number {
    return height - SHIP_Y_OFFSET_PX;
  }

  private reset(): void {
    this.score = 0;
    this.lives = INVADERS.lives;
    this.level = 1;
    this.gameOver = false;
    this.shipXNorm = 0.5;
    this.missiles = [];
    this.bullets = [];
    this.fireTimerSec = 0;
    this.invulnerableUntilMs = 0;
    this.levelBannerUntilMs = 0;
    this.reloadFlashSide = null;
    this.reloadFlashUntilMs = 0;
    this.hasFiredEver = false;
    this.leftArmState = 'ready';
    this.rightArmState = 'ready';
    this.buildFormation();
  }

  private buildFormation(): void {
    const { rows, cols } = INVADERS;
    const startX =
      (this.lastWidth - (cols - 1) * ENEMY_SPACING_X_PX) / 2;
    const startY = 64;
    this.enemies = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        this.enemies.push({
          x: startX + col * ENEMY_SPACING_X_PX,
          y: startY + row * ENEMY_SPACING_Y_PX,
          row,
          col,
          alive: true,
        });
      }
    }
    this.enemyDir = 1;
  }

  private stepArm(
    side: ArmSide,
    arm: ArmState,
    shipX: number,
    shipY: number,
  ): void {
    const prev = side === 'left' ? this.leftArmState : this.rightArmState;
    const step = nextArmFireState(prev, arm);
    if (side === 'left') {
      this.leftArmState = step.state;
    } else {
      this.rightArmState = step.state;
    }
    if (step.fired) {
      const dir = missileDirection(arm.angleDeg);
      this.missiles.push({
        x: shipX,
        y: shipY - 24,
        vx: dir.x * INVADERS.missileSpeedPxPerSec,
        vy: dir.y * INVADERS.missileSpeedPxPerSec,
      });
      this.sfx.shoot();
      this.hasFiredEver = true;
    }
    if (step.reloaded) {
      this.sfx.reload();
      this.reloadFlashSide = side;
      this.reloadFlashUntilMs = this.lastNowMs + RELOAD_FLASH_MS;
    }
  }

  private updateMissiles(dtSec: number, width: number): void {
    const remaining: Missile[] = [];
    for (const missile of this.missiles) {
      missile.x += missile.vx * dtSec;
      missile.y += missile.vy * dtSec;
      if (missile.y < -20 || missile.x < -20 || missile.x > width + 20) {
        continue;
      }
      let hit = false;
      for (const enemy of this.enemies) {
        if (!enemy.alive) continue;
        if (
          circleRectHit(
            missile.x,
            missile.y,
            INVADERS.missileRadiusPx,
            enemy.x - ENEMY_WIDTH_PX / 2,
            enemy.y - ENEMY_HEIGHT_PX / 2,
            ENEMY_WIDTH_PX,
            ENEMY_HEIGHT_PX,
          )
        ) {
          enemy.alive = false;
          this.score += INVADERS.pointsPerEnemy;
          hit = true;
          break;
        }
      }
      if (!hit) remaining.push(missile);
    }
    this.missiles = remaining;
  }

  private checkLevelClear(nowMs: number): void {
    if (this.enemies.some((e) => e.alive)) return;
    this.score += INVADERS.pointsPerLevel;
    this.sfx.win();
    this.level += 1;
    this.levelBannerUntilMs = nowMs + LEVEL_BANNER_MS;
    this.fireTimerSec = 0;
    this.buildFormation();
  }

  private updateEnemies(dtSec: number, width: number, shipY: number): void {
    const speed = levelEnemySpeed(this.level);
    for (const enemy of this.enemies) {
      if (enemy.alive) enemy.x += this.enemyDir * speed * dtSec;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      minX = Math.min(minX, enemy.x);
      maxX = Math.max(maxX, enemy.x);
    }
    if (
      Number.isFinite(minX) &&
      (minX - ENEMY_WIDTH_PX / 2 <= ENEMY_EDGE_MARGIN_PX ||
        maxX + ENEMY_WIDTH_PX / 2 >= width - ENEMY_EDGE_MARGIN_PX)
    ) {
      this.enemyDir = -this.enemyDir;
      for (const enemy of this.enemies) {
        if (enemy.alive) enemy.y += INVADERS.enemyStepDownPx;
      }
    }

    this.fireTimerSec += dtSec;
    const interval = levelFireInterval(this.level);
    if (this.fireTimerSec >= interval) {
      this.fireTimerSec -= interval;
      this.fireEnemyBullet();
    }

    for (const enemy of this.enemies) {
      if (enemy.alive && enemy.y + ENEMY_HEIGHT_PX / 2 >= shipY) {
        this.endGame();
        return;
      }
    }
  }

  /** One bullet, straight down, from a random bottom-row enemy. */
  private fireEnemyBullet(): void {
    const bottomByCol = new Map<number, Enemy>();
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const current = bottomByCol.get(enemy.col);
      if (current === undefined || enemy.y > current.y) {
        bottomByCol.set(enemy.col, enemy);
      }
    }
    const bottoms = [...bottomByCol.values()];
    if (bottoms.length === 0) return;
    const picked = bottoms[Math.floor(Math.random() * bottoms.length)];
    if (picked === undefined) return;
    this.bullets.push({ x: picked.x, y: picked.y + ENEMY_HEIGHT_PX / 2 });
  }

  private updateBullets(
    dtSec: number,
    height: number,
    shipX: number,
    shipY: number,
    nowMs: number,
  ): void {
    const speed = levelBulletSpeed(this.level);
    const remaining: EnemyBullet[] = [];
    for (const bullet of this.bullets) {
      bullet.y += speed * dtSec;
      if (bullet.y > height + 10) continue;
      if (
        nowMs >= this.invulnerableUntilMs &&
        circleRectHit(
          bullet.x,
          bullet.y,
          BULLET_RADIUS_PX,
          shipX - SHIP_WIDTH_PX / 2,
          shipY - SHIP_HEIGHT_PX / 2,
          SHIP_WIDTH_PX,
          SHIP_HEIGHT_PX,
        )
      ) {
        this.lives -= 1;
        this.sfx.hit();
        this.invulnerableUntilMs = nowMs + INVADERS.hitGraceSec * 1000;
        if (this.lives <= 0) {
          this.lives = 0;
          this.endGame();
        }
        continue;
      }
      remaining.push(bullet);
    }
    this.bullets = remaining;
  }

  private endGame(): void {
    this.gameOver = true;
  }

  private armStatus(side: ArmSide): string {
    if (
      this.reloadFlashSide === side &&
      this.lastNowMs < this.reloadFlashUntilMs
    ) {
      return 'Reloaded!';
    }
    const state = side === 'left' ? this.leftArmState : this.rightArmState;
    return state === 'fired' ? 'Fired — lower your arm' : 'Ready';
  }

  private drawShip(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
  ): void {
    ctx.save();
    // Rocket body: yellow triangle.
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(x, y - 22);
    ctx.lineTo(x - 20, y + 12);
    ctx.lineTo(x + 20, y + 12);
    ctx.closePath();
    ctx.fill();
    // Fins.
    ctx.fillStyle = '#ff7a59';
    ctx.beginPath();
    ctx.moveTo(x - 20, y + 2);
    ctx.lineTo(x - 30, y + 14);
    ctx.lineTo(x - 20, y + 12);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 20, y + 2);
    ctx.lineTo(x + 30, y + 14);
    ctx.lineTo(x + 20, y + 12);
    ctx.closePath();
    ctx.fill();
    // Window.
    ctx.fillStyle = '#4ea1ff';
    ctx.beginPath();
    ctx.arc(x, y - 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawMissile(
    ctx: CanvasRenderingContext2D,
    missile: Missile,
  ): void {
    const speed = Math.hypot(missile.vx, missile.vy) || 1;
    const ux = missile.vx / speed;
    const uy = missile.vy / speed;
    ctx.save();
    ctx.strokeStyle = '#ffe66d';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.shadowColor = '#ffe66d';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(missile.x - ux * 14, missile.y - uy * 14);
    ctx.lineTo(missile.x, missile.y);
    ctx.stroke();
    ctx.fillStyle = '#fff7ae';
    ctx.beginPath();
    ctx.arc(missile.x, missile.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    const color = enemy.row % 2 === 0 ? '#7ee787' : '#c792ea';
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(enemy.x, enemy.y, 22, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    // Antennae.
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(enemy.x - 8, enemy.y - 14);
    ctx.lineTo(enemy.x - 12, enemy.y - 22);
    ctx.moveTo(enemy.x + 8, enemy.y - 14);
    ctx.lineTo(enemy.x + 12, enemy.y - 22);
    ctx.stroke();
    // Eyes.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(enemy.x - 8, enemy.y - 2, 5, 0, Math.PI * 2);
    ctx.arc(enemy.x + 8, enemy.y - 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14141f';
    ctx.beginPath();
    ctx.arc(enemy.x - 8, enemy.y - 2, 2.5, 0, Math.PI * 2);
    ctx.arc(enemy.x + 8, enemy.y - 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawCenterLines(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    lines: readonly { text: string; size: number }[],
  ): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 6;
    ctx.fillStyle = '#ffffff';
    lines.forEach((line, i) => {
      ctx.font = `700 ${line.size}px ${RENDER.gameFont}`;
      const y = height / 2 + (i - (lines.length - 1) / 2) * 56;
      ctx.strokeText(line.text, width / 2, y);
      ctx.fillText(line.text, width / 2, y);
    });
    ctx.restore();
  }
}
