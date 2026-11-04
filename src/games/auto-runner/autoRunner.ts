/**
 * Auto Runner — STUB ONLY (PLAN.md §"Not in v1").
 *
 * The design is documented in PLAN.md: lane switching (torso left/centre/
 * right), jump (hip rise) and duck (hip drop + knee bend) to dodge obstacles
 * to the end of a level. The game itself is NOT built in v1 — this stub
 * exists so the hub registry and the Game interface have a registered
 * placeholder, and so the design note has a code home to point at.
 */

import type { SoundEffects } from '../../core/audio';
import type { BodyState } from '../../core/bodyState';
import type { NormalizedLandmark } from '../../tracking/poseTypes';
import type { Game } from '../game';

export class AutoRunnerStub implements Game {
  public readonly id = 'auto-runner';
  public readonly title = 'Auto Runner';
  public readonly paused = false;

  public constructor(_sfx: SoundEffects) {
    // Stub: no state yet. See PLAN.md for the design.
  }

  public start(): void {
    // Not built in v1.
  }

  public stop(): void {
    // Not built in v1.
  }

  public pause(): void {
    // Not built in v1.
  }

  public resume(): void {
    // Not built in v1.
  }

  public restart(): void {
    // Not built in v1.
  }

  public update(
    _dtMs: number,
    _nowMs: number,
    _body: BodyState | null,
    _landmarks: readonly NormalizedLandmark[] | null,
  ): void {
    // Not built in v1.
  }

  public render(
    ctx: CanvasRenderingContext2D,
    _nowMs: number,
    _body: BodyState | null,
    _landmarks: readonly NormalizedLandmark[] | null,
  ): void {
    ctx.save();
    ctx.fillStyle = '#e8e8f0';
    ctx.font = '28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      '🏃 Auto Runner — coming soon!',
      ctx.canvas.width / 2,
      ctx.canvas.height / 2,
    );
    ctx.restore();
  }

  public hudHtml(): string {
    return '🏃 Auto Runner — coming soon.';
  }
}
