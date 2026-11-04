/**
 * Dance Pose Drop — Guitar Hero for dance poses.
 *
 * A target stickman falls from the top of the screen. When it reaches the
 * glowing zone near the bottom, the player copies its pose: hold the pose
 * within `DANCE.matchThreshold` for `BODY.poseHoldSeconds` (0.6s) and the
 * round scores — Perfect if the match is strong and the target is centred
 * in the zone, otherwise Good. Let the target fall through the zone
 * unscored and it is a Miss. `DANCE.roundsPerGame` rounds, then results.
 *
 * The player's live skeleton is drawn by the hub — this game only draws
 * the zone, the falling target, the pose name, a small live match meter
 * (so Lara can see how close she is), feedback text, and results.
 *
 * TWO NOTES ON THE BRIEF
 * ----------------------
 * 1. Miss rule. The brief says a round is a Miss when "the target's
 *    bottom passes the zone's bottom". The target box (45% of canvas
 *    height) is taller than the zone (140px), so the bottom crosses the
 *    zone's bottom while the target's centre is still above the zone's
 *    middle 50% — a Miss would fire a few pixels before Perfect could
 *    ever trigger, making Perfect unreachable. A round is therefore a
 *    Miss once the target has fallen completely through the zone (its
 *    top passes the zone's bottom), which is also when it can no longer
 *    be scored.
 * 2. Canvas size. `update()` gets no canvas, so the playfield height is
 *    cached from `render()` (which runs every frame) with `SOURCE` as
 *    the fallback before the first render. The canvas is a fixed size in
 *    practice, so the cached value is stable.
 */

import { BODY, DANCE, RENDER, SOURCE } from '../../core/config';
import { poseMatchScore } from '../../core/bodyState';
import type { SoundEffects } from '../../core/audio';
import type { BodyState } from '../../core/bodyState';
import { drawStickmanInRect } from '../../render/renderer';
import { clamp } from '../../render/stage';
import type { NormalizedLandmark } from '../../tracking/poseTypes';
import type { Game } from '../game';
import { POSES, pickNextPose, type DancePose } from './poses';

/** Gap between the scoring zone's bottom edge and the canvas bottom, px. */
const ZONE_BOTTOM_MARGIN_PX = 16;
/** Target stickman box height, as a fraction of canvas height. */
const TARGET_HEIGHT_FRAC = 0.45;
/** Target box width, as a fraction of its height. */
const TARGET_WIDTH_FRAC = 0.6;
/** How long feedback text shows after a round is scored, in ms. */
const FEEDBACK_MS = 1000;

/** Outcome of one round. */
export type RoundGrade = 'perfect' | 'good' | 'miss';

/** The scoring zone band, in canvas pixels. */
export interface ZoneGeometry {
  top: number;
  bottom: number;
  height: number;
}

/** The falling target's box, in canvas pixels. */
export interface TargetBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fall speed for a round (0-based): base speed + per-round bump. */
export function fallSpeedForRound(roundIndex: number): number {
  return DANCE.fallSpeedPxPerSec + DANCE.fallSpeedAddPerRound * roundIndex;
}

/** The scoring zone: a `DANCE.zoneHeightPx` band near the canvas bottom. */
export function zoneGeometry(canvasHeight: number): ZoneGeometry {
  const bottom = canvasHeight - ZONE_BOTTOM_MARGIN_PX;
  return { top: bottom - DANCE.zoneHeightPx, bottom, height: DANCE.zoneHeightPx };
}

/** The falling target's box: centred, ~45% of canvas height tall. */
export function targetBox(
  canvasWidth: number,
  canvasHeight: number,
  targetTopY: number,
): TargetBox {
  const height = canvasHeight * TARGET_HEIGHT_FRAC;
  const width = height * TARGET_WIDTH_FRAC;
  return { x: (canvasWidth - width) / 2, y: targetTopY, width, height };
}

/**
 * Grade a completed hold. Perfect needs a strong match AND the target's
 * centre inside the middle 50% of the zone; anything else held long
 * enough is Good.
 */
export function gradeHold(
  score: number,
  targetCenterY: number,
  zoneTop: number,
  zoneBottom: number,
): 'perfect' | 'good' {
  const zoneHeight = zoneBottom - zoneTop;
  const middleTop = zoneTop + zoneHeight * 0.25;
  const middleBottom = zoneBottom - zoneHeight * 0.25;
  const centred = targetCenterY >= middleTop && targetCenterY <= middleBottom;
  return score >= DANCE.perfectThreshold && centred ? 'perfect' : 'good';
}

/**
 * Hold-time accumulator: how long the player's pose has matched the
 * target continuously. Accumulates while the score is at or above the
 * match threshold, resets the moment it dips below. Returns true once
 * the hold reaches `BODY.poseHoldSeconds`.
 */
export class PoseHoldTracker {
  private holdMs = 0;

  public get holdSeconds(): number {
    return this.holdMs / 1000;
  }

  public update(score: number, dtMs: number): boolean {
    if (score >= DANCE.matchThreshold) {
      this.holdMs += dtMs;
    } else {
      this.holdMs = 0;
    }
    return this.holdMs >= BODY.poseHoldSeconds * 1000;
  }

  public reset(): void {
    this.holdMs = 0;
  }
}

export class DanceDropGame implements Game {
  public readonly id = 'dance-drop';
  public readonly title = 'Dance Pose Drop';

  private readonly sfx: SoundEffects;
  private readonly holdTracker = new PoseHoldTracker();
  private started = false;
  private isPaused = false;
  private phase: 'playing' | 'results' = 'playing';
  private roundIndex = 0;
  private pose: DancePose = POSES[0];
  private targetTopY = 0;
  private score = 0;
  private perfectCount = 0;
  private goodCount = 0;
  private missCount = 0;
  private feedback: { text: string; kind: RoundGrade; untilMs: number } | null =
    null;
  private canvasHeight: number = SOURCE.height;

  public constructor(sfx: SoundEffects) {
    this.sfx = sfx;
  }

  public get paused(): boolean {
    return this.isPaused;
  }

  /** The pose the current round asks the player to copy (tests + debug). */
  public get currentPose(): DancePose {
    return this.pose;
  }

  public start(): void {
    this.started = true;
    this.isPaused = false;
    this.phase = 'playing';
    this.score = 0;
    this.perfectCount = 0;
    this.goodCount = 0;
    this.missCount = 0;
    this.feedback = null;
    this.beginRound(0);
  }

  public stop(): void {
    this.started = false;
  }

  public pause(): void {
    if (this.started) {
      this.isPaused = true;
    }
  }

  public resume(): void {
    this.isPaused = false;
  }

  public restart(): void {
    this.start();
  }

  public update(
    dtMs: number,
    nowMs: number,
    _body: BodyState | null,
    landmarks: readonly NormalizedLandmark[] | null,
  ): void {
    if (!this.started || this.isPaused || this.phase !== 'playing') {
      return;
    }
    // Feedback breather between rounds: the target is frozen until the
    // feedback expires, then the next round begins.
    if (this.feedback !== null) {
      if (nowMs >= this.feedback.untilMs) {
        this.feedback = null;
        this.advance();
      }
      return;
    }

    const zone = zoneGeometry(this.canvasHeight);
    const height = this.canvasHeight * TARGET_HEIGHT_FRAC;
    this.targetTopY += (fallSpeedForRound(this.roundIndex) * dtMs) / 1000;
    const targetBottom = this.targetTopY + height;
    const inZone = targetBottom > zone.top && this.targetTopY < zone.bottom;
    if (inZone) {
      const score =
        landmarks === null
          ? 0
          : poseMatchScore(landmarks, this.pose.targetAngles);
      if (this.holdTracker.update(score, dtMs)) {
        const centerY = this.targetTopY + height / 2;
        this.scoreRound(gradeHold(score, centerY, zone.top, zone.bottom), nowMs);
        return;
      }
    }
    // Miss once the target has fallen completely through the zone — see
    // the header note for why this is the top edge, not the bottom.
    if (this.targetTopY >= zone.bottom) {
      this.scoreRound('miss', nowMs);
    }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    nowMs: number,
    _body: BodyState | null,
    landmarks: readonly NormalizedLandmark[] | null,
  ): void {
    this.canvasHeight = ctx.canvas.height;
    if (!this.started) {
      return;
    }
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    if (this.phase === 'results') {
      this.renderResults(ctx, width, height);
      return;
    }

    const zone = zoneGeometry(height);
    const box = targetBox(width, height, this.targetTopY);

    // Scoring zone band.
    ctx.save();
    ctx.fillStyle = 'rgba(255, 209, 102, 0.16)';
    ctx.fillRect(0, zone.top, width, zone.height);
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.65)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, zone.top, width, zone.height);
    ctx.fillStyle = '#ffd166';
    ctx.font = `bold 20px ${RENDER.gameFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🕺 DANCE HERE', width / 2, zone.top + zone.height / 2);
    ctx.restore();

    // Falling target stickman (default gold — reads clearly over the
    // translucent zone band).
    drawStickmanInRect(ctx, this.pose.template, box);

    // Pose name at the top (dark offset = cheap outline over the video).
    ctx.save();
    ctx.font = `bold 28px ${RENDER.gameFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const title = `Copy this pose: ${this.pose.emoji} ${this.pose.name}`;
    ctx.fillStyle = 'rgba(11, 11, 18, 0.8)';
    ctx.fillText(title, width / 2 + 2, 38);
    ctx.fillStyle = '#e8e8f0';
    ctx.fillText(title, width / 2, 36);
    ctx.restore();

    // Live match meter under the title, so Lara can see how close she is.
    if (landmarks !== null) {
      const score = poseMatchScore(landmarks, this.pose.targetAngles);
      const meterWidth = 220;
      const meterX = (width - meterWidth) / 2;
      const meterY = 62;
      const frac = clamp(score, 0, 1);
      ctx.save();
      ctx.fillStyle = 'rgba(11, 11, 18, 0.72)';
      ctx.fillRect(meterX - 4, meterY - 4, meterWidth + 8, 16);
      ctx.fillStyle = '#3a3a52';
      ctx.fillRect(meterX, meterY, meterWidth, 8);
      ctx.fillStyle =
        frac >= DANCE.perfectThreshold
          ? '#7ef0c1'
          : frac >= DANCE.matchThreshold
            ? '#ffd166'
            : '#ff7a59';
      ctx.fillRect(meterX, meterY, meterWidth * frac, 8);
      ctx.fillStyle = '#e8e8f0';
      ctx.fillRect(
        meterX + meterWidth * DANCE.matchThreshold - 1,
        meterY - 2,
        2,
        12,
      );
      ctx.restore();
    }

    // Feedback text while it is showing.
    if (this.feedback !== null && nowMs < this.feedback.untilMs) {
      ctx.save();
      ctx.font = `bold 44px ${RENDER.gameFont}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const color =
        this.feedback.kind === 'perfect'
          ? '#ffd166'
          : this.feedback.kind === 'good'
            ? '#7ef0c1'
            : '#ff9d9d';
      ctx.fillStyle = 'rgba(11, 11, 18, 0.8)';
      ctx.fillText(this.feedback.text, width / 2 + 2, height / 2 + 2);
      ctx.fillStyle = color;
      ctx.fillText(this.feedback.text, width / 2, height / 2);
      ctx.restore();
    }
  }

  public hudHtml(): string {
    const round = Math.min(this.roundIndex + 1, DANCE.roundsPerGame);
    return `⭐ Score ${this.score} &nbsp; 🎵 Round ${round}/${DANCE.roundsPerGame} &nbsp; ✨ Perfect x${this.perfectCount}`;
  }

  private beginRound(index: number): void {
    this.roundIndex = index;
    this.pose = pickNextPose(this.pose);
    this.targetTopY = -this.canvasHeight * TARGET_HEIGHT_FRAC;
    this.holdTracker.reset();
    this.feedback = null;
  }

  private advance(): void {
    if (this.roundIndex + 1 >= DANCE.roundsPerGame) {
      this.finish();
      return;
    }
    this.beginRound(this.roundIndex + 1);
  }

  private finish(): void {
    this.phase = 'results';
    if (this.perfectCount > 0) {
      this.sfx.win();
    }
  }

  private scoreRound(grade: RoundGrade, nowMs: number): void {
    if (grade === 'perfect') {
      this.score += DANCE.pointsPerfect;
      this.perfectCount += 1;
      this.sfx.feedback('perfect');
      this.feedback = {
        text: 'PERFECT! ⭐',
        kind: 'perfect',
        untilMs: nowMs + FEEDBACK_MS,
      };
    } else if (grade === 'good') {
      this.score += DANCE.pointsGood;
      this.goodCount += 1;
      this.sfx.feedback('good');
      this.feedback = {
        text: 'Good! 👍',
        kind: 'good',
        untilMs: nowMs + FEEDBACK_MS,
      };
    } else {
      this.missCount += 1;
      this.sfx.feedback('miss');
      this.feedback = {
        text: 'Miss — try again!',
        kind: 'miss',
        untilMs: nowMs + FEEDBACK_MS,
      };
    }
  }

  private renderResults(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    ctx.save();
    ctx.fillStyle = 'rgba(11, 11, 18, 0.82)';
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8e8f0';
    ctx.font = `bold 36px ${RENDER.gameFont}`;
    ctx.fillText('🎉 Dance complete!', width / 2, height / 2 - 64);
    ctx.font = `28px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffd166';
    ctx.fillText(`⭐ Score ${this.score}`, width / 2, height / 2 - 8);
    ctx.fillStyle = '#e8e8f0';
    ctx.fillText(
      `You did ${this.perfectCount} Perfect, ${this.goodCount} Good, ${this.missCount} Miss`,
      width / 2,
      height / 2 + 36,
    );
    ctx.font = `20px ${RENDER.gameFont}`;
    ctx.fillStyle = '#9d9db8';
    ctx.fillText('Press restart to dance again!', width / 2, height / 2 + 84);
    ctx.restore();
  }
}
