/**
 * The stage: canvas sizing and THE coordinate transform.
 *
 * Three spaces exist:
 *   1. **Video space**     — normalized `[0,1]`, origin top-left, unmirrored.
 *                            What the model emits and what `sim/` produces.
 *   2. **Canvas space**    — canvas pixels, origin top-left. The game's space.
 *   3. **CSS/screen space** — how the canvas is laid out. CSS only; no JS math.
 *
 * There is no second coordinate system. Aim vectors, target positions and
 * missile origins all live in canvas space.
 */

import type { NormalizedLandmark } from '../tracking/poseTypes';

/** A point in canvas space (or, where documented, in pixel space). */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * THE ONLY place normalized video space becomes canvas space.
 *
 * `1 - x` is the horizontal mirror. It is applied here, in code, and nowhere
 * else — specifically NOT with CSS `scaleX(-1)` on the canvas element, because
 * a CSS flip would also mirror HUD text and DOM UI layered above the canvas.
 *
 * `y` is not mirrored: video space and canvas space both grow downward.
 */
export function toCanvas(
  lm: NormalizedLandmark,
  canvasWidth: number,
  canvasHeight: number,
): Vec2 {
  return { x: (1 - lm.x) * canvasWidth, y: lm.y * canvasHeight };
}

/**
 * The exact inverse of {@link toCanvas}: canvas space back to normalized
 * video space. Permitted only where a subsystem genuinely needs normalized
 * space — the mouse simulator needs it because the pointer arrives in canvas
 * space and the sim's wire format is normalized.
 */
export function toNormalized(
  point: Vec2,
  canvasWidth: number,
  canvasHeight: number,
): Vec2 {
  return { x: 1 - point.x / canvasWidth, y: point.y / canvasHeight };
}

/**
 * The minimal canvas surface this module needs. Structural, so the real
 * `HTMLCanvasElement` satisfies it and tests do not need a DOM.
 */
export interface CanvasBackingStore {
  width: number;
  height: number;
}

/**
 * The canvas backing store equals the source's intrinsic dimensions.
 * Normalized -> canvas then stays a pure multiply, and there is no
 * letterboxing inside the canvas. Viewport fitting is CSS only.
 * Returns `true` when the store was resized.
 *
 * Caller contract: assigning `width`/`height` resets the 2D context. Anything
 * that established a transform must re-establish it after this returns `true`.
 */
export function syncCanvasBackingStore(
  canvas: CanvasBackingStore,
  sourceWidth: number,
  sourceHeight: number,
): boolean {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)) {
    throw new RangeError(
      `source dimensions must be finite, got ${sourceWidth}x${sourceHeight}`,
    );
  }
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new RangeError(
      `source dimensions must be positive, got ${sourceWidth}x${sourceHeight}`,
    );
  }
  const width = Math.round(sourceWidth);
  const height = Math.round(sourceHeight);
  if (canvas.width === width && canvas.height === height) {
    return false;
  }
  canvas.width = width;
  canvas.height = height;
  return true;
}

/** Clamp a value into `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
