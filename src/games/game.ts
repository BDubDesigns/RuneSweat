/**
 * The Game interface: the one contract every pose game implements.
 *
 * The hub (`main.ts`) owns the camera, the pose source, the fixed-timestep
 * loop, the video/skeleton rendering and the DOM. A game owns only its own
 * simulation + its own canvas drawing + its HUD string. A game never touches
 * landmarks directly except through the `landmarks` argument (Dance Drop
 * needs raw landmarks for pose matching) and never touches the camera, the
 * loop, or the DOM.
 *
 * Lifecycle: `start()` once when the player picks the game, `update()` on
 * every fixed step, `render()` on every displayed frame (after the video and
 * skeleton have been drawn), `pause()` / `resume()` / `restart()` from the
 * hub buttons, `stop()` when leaving the game.
 */

import type { SoundEffects } from '../core/audio';
import type { BodyState } from '../core/bodyState';
import type { NormalizedLandmark } from '../tracking/poseTypes';

export interface Game {
  readonly id: string;
  readonly title: string;
  readonly paused: boolean;
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  restart(): void;
  /**
   * Advance the simulation by exactly `dtMs`. `body` is the latest derived
   * body state, or `null` when no person is detected. `landmarks` is the
   * latest raw pose (or `null`) — only Dance Drop reads it, for pose
   * matching. Never called while paused.
   */
  update(
    dtMs: number,
    nowMs: number,
    body: BodyState | null,
    landmarks: readonly NormalizedLandmark[] | null,
  ): void;
  /**
   * Draw the game's entities on top of the video + skeleton. Canvas space,
   * unmirrored. `ctx.canvas.width/height` is the playfield size.
   */
  render(
    ctx: CanvasRenderingContext2D,
    nowMs: number,
    body: BodyState | null,
    landmarks: readonly NormalizedLandmark[] | null,
  ): void;
  /** Small HTML string for the DOM HUD line (score, lives, level, hints). */
  hudHtml(): string;
}

/** Shared constructor shape: games only need sound effects. */
export type GameConstructor = new (sfx: SoundEffects) => Game;
