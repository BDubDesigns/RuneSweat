/**
 * Swing Lab — Active RuneSpace Mining prototype (Slice 1).
 *
 * One ore node on screen, one mechanic: a pickaxe swing is a hit. The
 * miner is the player's own live skeleton (drawn by the hub) plus a
 * pickaxe anchored at the wrists. Raise both arms overhead (windup),
 * chop down fast through chest level (strike) — the node cracks, +1 ore,
 * +Mining XP. Five hits break the node and a new one spawns.
 *
 * The game owns only its simulation + canvas drawing + HUD string. It
 * never touches landmarks for gameplay: the swing is decided by
 * `SwingMachine` from `BodyState` only. All tuning lives in `SWING`
 * (`core/config.ts`).
 */

import { RENDER, STAGE, SWING } from '../../core/config';
import type { SoundEffects } from '../../core/audio';
import {
  armDirectionCanvas,
  type BodyState,
} from '../../core/bodyState';
import { clamp, toCanvas } from '../../render/stage';
import { PoseLandmark, type NormalizedLandmark } from '../../tracking/poseTypes';
import type { Game } from '../game';
import {
  SwingMachine,
  type SwingEvent,
  type SwingHandedness,
  type SwingPhase,
  type SwingSnapshot,
} from './swingMachine';

/** Mining level for total XP: 100 XP per level, starting at level 1. */
export function miningLevel(xp: number): number {
  return Math.floor(Math.max(0, xp) / SWING.xpPerLevel) + 1;
}

/** XP earned inside the current level (0..xpPerLevel-1). */
export function xpIntoLevel(xp: number): number {
  return Math.max(0, xp) % SWING.xpPerLevel;
}

/** Crack lines drawn on the node for `hits` hits on it (max 3). */
export function cracksForHits(hits: number): number {
  return Math.min(3, Math.max(0, hits));
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  untilMs: number;
  color: string;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  untilMs: number;
}

/** Read-only snapshot of the live state, for the debug HUD and tests. */
export interface SwingLabSnapshot {
  ore: number;
  xp: number;
  level: number;
  xpIntoLevel: number;
  nodeHits: number;
  swings: number;
  nodesBroken: number;
  cracks: number;
  phase: SwingPhase;
  lastEvent: SwingEvent | null;
  lastHandedness: SwingHandedness | null;
  particles: number;
}

const PHASE_LINES: Record<SwingPhase, string> = {
  ready: 'Raise your arms overhead!',
  windup: 'Now SWING DOWN! ⬇️',
  strike: 'STRIKE! ⛏️',
  recover: '⛏️ HIT!',
};

const HANDEDNESS_LABELS: Record<SwingHandedness, string> = {
  'two-handed': 'Two-handed!',
  left: 'Left arm!',
  right: 'Right arm!',
};

export class SwingLabGame implements Game {
  public readonly id = 'swing-lab';
  public readonly title = 'Swing Lab';
  public paused = false;

  private readonly sfx: SoundEffects;
  private readonly machine = new SwingMachine();

  private ore = 0;
  private xp = 0;
  private nodeHits = 0;
  private swings = 0;
  private nodesBroken = 0;
  private lastHandedness: SwingHandedness | null = null;
  private lastSnapshot: SwingSnapshot | null = null;
  private prevPhase: SwingPhase = 'ready';

  private shakeUntilMs = 0;
  private flashUntilMs = 0;
  private breakBannerUntilMs = 0;
  private levelBannerUntilMs = 0;
  private lastWidth: number = STAGE.width;
  private lastHeight: number = STAGE.height;
  private particles: Particle[] = [];
  private floaters: Floater[] = [];

  public constructor(sfx: SoundEffects) {
    this.sfx = sfx;
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
    if (this.paused) return;
    const dtSec = dtMs / 1000;

    const event = this.machine.update(body, nowMs);
    const phase = this.machine.currentPhase;
    if (phase === 'strike' && this.prevPhase !== 'strike') {
      this.sfx.whoosh();
    }
    this.prevPhase = phase;
    this.lastSnapshot = this.machine.snapshot();

    if (event !== null) this.applyEvent(event, nowMs);
    this.updateParticles(dtSec, nowMs);
    this.floaters = this.floaters.filter((f) => nowMs < f.untilMs);
  }

  public render(
    ctx: CanvasRenderingContext2D,
    nowMs: number,
    body: BodyState | null,
    landmarks: readonly NormalizedLandmark[] | null,
  ): void {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    this.lastWidth = width;
    this.lastHeight = height;
    const snap = this.lastSnapshot ?? this.machine.snapshot();

    ctx.save();
    if (nowMs < this.shakeUntilMs) {
      const m = SWING.shakePx;
      ctx.translate((Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m);
    }

    this.drawNode(ctx);
    this.drawParticles(ctx);
    this.drawPickaxe(ctx, body, snap, width, height);
    this.drawHelmet(ctx, landmarks, width, height);
    this.drawSwingMeter(ctx, snap, nowMs);
    this.drawPhaseText(ctx, snap, width);
    if (snap.phase === 'ready' && this.swings === 0) {
      this.drawGhostArc(ctx, width, height);
    }
    this.drawFloaters(ctx, nowMs);
    this.drawBanners(ctx, nowMs, width, height);
    ctx.restore();
  }

  public hudHtml(): string {
    const snap = this.lastSnapshot ?? this.machine.snapshot();
    const level = miningLevel(this.xp);
    return (
      `<span>⛏️ Mining Lv ${level} — ${xpIntoLevel(this.xp)}/${SWING.xpPerLevel} XP</span> &nbsp; ` +
      `<span>🪨 Ore ${this.ore}</span> &nbsp; ` +
      `<span>Swings ${this.swings}</span> &nbsp; ` +
      `<span>Node ${this.nodeHits}/${SWING.hitsPerNode}</span> &nbsp; ` +
      `<span>Phase: ${snap.phase} · L ${snap.leftVel.toFixed(1)} R ${snap.rightVel.toFixed(1)} torso/s</span>`
    );
  }

  /** Read-only snapshot of the live state, for the debug HUD and tests. */
  public snapshot(): SwingLabSnapshot {
    const snap = this.lastSnapshot ?? this.machine.snapshot();
    return {
      ore: this.ore,
      xp: this.xp,
      level: miningLevel(this.xp),
      xpIntoLevel: xpIntoLevel(this.xp),
      nodeHits: this.nodeHits,
      swings: this.swings,
      nodesBroken: this.nodesBroken,
      cracks: cracksForHits(this.nodeHits),
      phase: snap.phase,
      lastEvent: snap.lastEvent,
      lastHandedness: this.lastHandedness,
      particles: this.particles.length,
    };
  }

  private reset(): void {
    this.machine.reset();
    this.ore = 0;
    this.xp = 0;
    this.nodeHits = 0;
    this.swings = 0;
    this.nodesBroken = 0;
    this.lastHandedness = null;
    this.lastSnapshot = null;
    this.prevPhase = 'ready';
    this.shakeUntilMs = 0;
    this.flashUntilMs = 0;
    this.breakBannerUntilMs = 0;
    this.levelBannerUntilMs = 0;
    this.particles = [];
    this.floaters = [];
  }

  private applyEvent(event: SwingEvent, nowMs: number): void {
    if (event.kind === 'weak') {
      this.sfx.weakTick();
      return;
    }
    // Counted hit: ore + XP + a crack on the node.
    this.swings += 1;
    this.ore += SWING.orePerHit;
    const prevLevel = miningLevel(this.xp);
    this.xp += SWING.xpPerHit;
    this.nodeHits += 1;
    this.lastHandedness = event.handedness;
    this.sfx.crack();
    this.shakeUntilMs = nowMs + SWING.shakeMs;
    this.flashUntilMs = nowMs + 200;
    const { x, y } = this.nodeCenter();
    this.floaters.push({
      x,
      y: y - 95,
      text: `+${SWING.xpPerHit} XP`,
      untilMs: nowMs + SWING.floaterMs,
    });
    if (miningLevel(this.xp) > prevLevel) {
      this.levelBannerUntilMs = nowMs + 1400;
    }
    if (this.nodeHits >= SWING.hitsPerNode) {
      this.nodesBroken += 1;
      this.nodeHits = 0;
      this.sfx.win();
      this.breakBannerUntilMs = nowMs + SWING.breakBannerMs;
      this.spawnBreakParticles(nowMs);
    }
  }

  private nodeCenter(): { x: number; y: number } {
    return { x: this.lastWidth * 0.72, y: this.lastHeight * 0.62 };
  }

  private nodeRadius(): number {
    return Math.min(this.lastWidth, this.lastHeight) * 0.15;
  }

  private spawnBreakParticles(nowMs: number): void {
    const { x, y } = this.nodeCenter();
    const colors = ['#ffd166', '#fff7ae', '#7ee787', '#4ea1ff'];
    for (let i = 0; i < SWING.breakParticles; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 180;
      const color = colors[i % colors.length] ?? '#ffd166';
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        untilMs: nowMs + 500 + Math.random() * 300,
        color,
      });
    }
  }

  private updateParticles(dtSec: number, nowMs: number): void {
    const remaining: Particle[] = [];
    for (const p of this.particles) {
      if (nowMs >= p.untilMs) continue;
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.vy += 500 * dtSec;
      remaining.push(p);
    }
    this.particles = remaining;
  }

  // ------------------------------------------------------------- drawing ---

  private drawNode(ctx: CanvasRenderingContext2D): void {
    const { x, y } = this.nodeCenter();
    const r = this.nodeRadius();
    ctx.save();
    // Ground shadow.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.95, r * 1.05, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    // Boulder.
    ctx.fillStyle = '#8d7d6b';
    ctx.strokeStyle = '#5d5145';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Highlight.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.35, y - r * 0.4, r * 0.4, r * 0.25, -0.5, 0, Math.PI * 2);
    ctx.fill();
    // Gem glint.
    ctx.fillStyle = '#4dd8ff';
    ctx.beginPath();
    ctx.moveTo(x + r * 0.35, y - r * 0.55);
    ctx.lineTo(x + r * 0.5, y - r * 0.35);
    ctx.lineTo(x + r * 0.35, y - r * 0.15);
    ctx.lineTo(x + r * 0.2, y - r * 0.35);
    ctx.closePath();
    ctx.fill();
    // Cracks: jagged lines from the top, one per hit (max 3).
    const cracks = cracksForHits(this.nodeHits);
    ctx.strokeStyle = '#3a3128';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    const crackPaths: readonly (readonly [number, number][])[] = [
      [[0, -0.85], [0.08, -0.4], [-0.05, -0.05]],
      [[-0.55, -0.6], [-0.35, -0.25], [-0.45, 0.15]],
      [[0.55, -0.55], [0.3, -0.2], [0.45, 0.25]],
    ];
    for (let i = 0; i < cracks; i += 1) {
      const path = crackPaths[i];
      if (path === undefined) continue;
      ctx.beginPath();
      path.forEach(([dx, dy], j) => {
        const px = x + dx * r;
        const py = y + dy * r;
        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    // Node HP pips under the rock.
    ctx.font = `20px ${RENDER.gameFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8e8f0';
    const pips =
      '🪨'.repeat(this.nodeHits) + '⬜'.repeat(SWING.hitsPerNode - this.nodeHits);
    ctx.fillText(pips, x, y + r + 26);
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const p of this.particles) {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * The pickaxe, anchored at the wrists. Both arms raised: midpoint of
   * the two wrists, angled by the average arm angle. One arm raised:
   * that wrist. No arm raised: leaning on the rock. Canvas space —
   * wrist X is mirrored through `toCanvas` like the skeleton.
   */
  private drawPickaxe(
    ctx: CanvasRenderingContext2D,
    body: BodyState | null,
    snap: SwingSnapshot,
    width: number,
    height: number,
  ): void {
    const { x: rockX, y: rockY } = this.nodeCenter();
    const r = this.nodeRadius();
    if (body === null || !body.present) {
      // No body: pickaxe leaning on the rock, waiting for a miner.
      this.drawPickaxeShape(ctx, rockX - r - 8, rockY + r * 0.4, -0.5, -0.85);
      return;
    }
    const raised: { x: number; y: number; angleDeg: number }[] = [];
    if (snap.leftHeight > 0) {
      raised.push({
        x: body.leftWristX,
        y: body.leftWristY,
        angleDeg: body.leftArm.angleDeg,
      });
    }
    if (snap.rightHeight > 0) {
      raised.push({
        x: body.rightWristX,
        y: body.rightWristY,
        angleDeg: body.rightArm.angleDeg,
      });
    }
    if (raised.length === 0) {
      // Arms down: the miner holds the pickaxe at rest, head down by
      // the rock — draw it leaning, as when there is no body.
      this.drawPickaxeShape(ctx, rockX - r - 8, rockY + r * 0.4, -0.5, -0.85);
      return;
    }
    const midX =
      raised.reduce((sum, w) => sum + w.x, 0) / raised.length;
    const midY =
      raised.reduce((sum, w) => sum + w.y, 0) / raised.length;
    const angleDeg =
      raised.reduce((sum, w) => sum + w.angleDeg, 0) / raised.length;
    const anchor = toCanvas(
      { x: midX, y: midY, visibility: 1 },
      width,
      height,
    );
    const dir = armDirectionCanvas(angleDeg);
    this.drawPickaxeShape(ctx, anchor.x, anchor.y, dir.x, dir.y);
  }

  /** Handle + curved head along unit direction (`dirX`, `dirY`). */
  private drawPickaxeShape(
    ctx: CanvasRenderingContext2D,
    ax: number,
    ay: number,
    dirX: number,
    dirY: number,
  ): void {
    const hx = ax + dirX * 52;
    const hy = ay + dirY * 52;
    const bx = ax - dirX * 26;
    const by = ay - dirY * 26;
    ctx.save();
    ctx.lineCap = 'round';
    // Handle.
    ctx.strokeStyle = '#8d5a2b';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    // Curved steel head at the top end.
    const ang = Math.atan2(dirY, dirX);
    ctx.strokeStyle = '#c0c8d0';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(hx, hy, 17, ang - 2.4, ang + 0.9);
    ctx.stroke();
    // Hands grip.
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(ax, ay, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** A little yellow hard hat on the miner's head — the skeleton is the miner. */
  private drawHelmet(
    ctx: CanvasRenderingContext2D,
    landmarks: readonly NormalizedLandmark[] | null,
    width: number,
    height: number,
  ): void {
    if (landmarks === null) return;
    const nose = landmarks[PoseLandmark.NOSE];
    if (nose === undefined) return;
    const p = toCanvas(nose, width, height);
    ctx.save();
    ctx.fillStyle = '#ffd166';
    ctx.strokeStyle = '#d9a441';
    ctx.lineWidth = 2;
    // Dome.
    ctx.beginPath();
    ctx.arc(p.x, p.y - 6, 15, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Brim.
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - 6, 21, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Vertical windup meter on the left: fills as the wrists rise. */
  private drawSwingMeter(
    ctx: CanvasRenderingContext2D,
    snap: SwingSnapshot,
    nowMs: number,
  ): void {
    const x = 46;
    const top = 120;
    const h = 300;
    const w = 26;
    const progress = clamp(snap.windupProgress, 0, 1);
    const flashing =
      snap.phase === 'strike' || nowMs < this.flashUntilMs;
    ctx.save();
    ctx.font = `700 18px ${RENDER.gameFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8e8f0';
    ctx.fillText('SWING', x + w / 2, top - 22);
    ctx.font = `16px ${RENDER.gameFont}`;
    ctx.fillText('⬆ UP', x + w / 2, top - 44);
    // Track.
    ctx.fillStyle = 'rgba(11, 11, 18, 0.72)';
    ctx.fillRect(x, top, w, h);
    // Fill from the bottom.
    const fillH = h * progress;
    ctx.fillStyle = flashing
      ? '#ffd166'
      : progress >= 1
        ? '#ffd166'
        : '#7ee787';
    ctx.fillRect(x, top + h - fillH, w, fillH);
    if (flashing) {
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 4;
      ctx.strokeRect(x - 3, top - 3, w + 6, h + 6);
    } else {
      ctx.strokeStyle = 'rgba(232, 232, 240, 0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, top, w, h);
    }
    ctx.font = `16px ${RENDER.gameFont}`;
    ctx.fillStyle = '#e8e8f0';
    ctx.fillText('⬇ DOWN', x + w / 2, top + h + 22);
    ctx.restore();
  }

  private drawPhaseText(
    ctx: CanvasRenderingContext2D,
    snap: SwingSnapshot,
    width: number,
  ): void {
    const line = PHASE_LINES[snap.phase];
    const last = snap.lastEvent;
    const sub =
      last === null
        ? 'Tip: raise BOTH arms up, then chop down fast!'
        : last.kind === 'hit'
          ? `Last swing: HIT! ${HANDEDNESS_LABELS[last.handedness]}`
          : `Last swing: ${last.message}`;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 34px ${RENDER.gameFont}`;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 6;
    ctx.strokeText(line, width / 2, 58);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(line, width / 2, 58);
    ctx.font = `24px ${RENDER.gameFont}`;
    ctx.strokeText(sub, width / 2, 100);
    ctx.fillStyle = '#e8e8f0';
    ctx.fillText(sub, width / 2, 100);
    ctx.restore();
  }

  /** Ghost of the ideal swing arc, until the first hit lands. */
  private drawGhostArc(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    const cx = width * 0.5;
    const topY = height * 0.28;
    const botY = height * 0.62;
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    // Up arrow (left) + down arrow (right) + dashed connector on top.
    ctx.beginPath();
    ctx.moveTo(cx - 60, botY);
    ctx.lineTo(cx - 60, topY + 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 72, topY + 26);
    ctx.lineTo(cx - 60, topY);
    ctx.lineTo(cx - 48, topY + 26);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 60, topY + 14);
    ctx.lineTo(cx + 60, botY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 48, botY - 26);
    ctx.lineTo(cx + 60, botY);
    ctx.lineTo(cx + 72, botY - 26);
    ctx.closePath();
    ctx.fill();
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(cx - 60, topY + 14);
    ctx.quadraticCurveTo(cx, topY - 34, cx + 60, topY + 14);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `700 22px ${RENDER.gameFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('UP, then CHOP DOWN!', cx, topY - 48);
    ctx.restore();
  }

  private drawFloaters(ctx: CanvasRenderingContext2D, nowMs: number): void {
    ctx.save();
    ctx.font = `700 26px ${RENDER.gameFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.floaters) {
      const age = 1 - (f.untilMs - nowMs) / SWING.floaterMs;
      ctx.globalAlpha = clamp(1 - age, 0, 1);
      ctx.fillStyle = '#ffd166';
      ctx.fillText(f.text, f.x, f.y - age * 30);
    }
    ctx.restore();
  }

  private drawBanners(
    ctx: CanvasRenderingContext2D,
    nowMs: number,
    width: number,
    height: number,
  ): void {
    let text: string | null = null;
    if (nowMs < this.breakBannerUntilMs) {
      text = '⛏️ Node broken! New node!';
    } else if (nowMs < this.levelBannerUntilMs) {
      text = `Level up! Mining Lv ${miningLevel(this.xp)}!`;
    }
    if (text === null) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 40px ${RENDER.gameFont}`;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 7;
    ctx.strokeText(text, width / 2, height / 2 - 60);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, width / 2, height / 2 - 60);
    ctx.restore();
  }
}
