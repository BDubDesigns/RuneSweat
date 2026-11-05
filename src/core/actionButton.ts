/**
 * The top-right action button (v3.6): one context-sensitive circle
 * that replaces the bottom-left "Leave to town" chip.
 *
 * The chip sat half-hidden behind the left press pad in every frame
 * of Brandon's v3.5 playtest video, so the chip is gone and this
 * circle is the only way out of an activity by hand (Space / the
 * Town button still work too).
 *
 * Two modes, and the icon change is the mode signal — make it
 * unmistakable:
 * - `town` (in an activity, nothing highlighted): houses icon, label
 *   "Town". A full dwell goes to town.
 * - `ok` (the pointer hovers a selectable thing): checkmark icon,
 *   label "OK". A full dwell clicks the highlighted thing.
 *
 * The same dwell logic serves both modes. A hand inside the circle
 * fills it up (radial progress, drawn by `render/renderer.ts`); a
 * 2 s hold fires the action. Leaving early resets the fill to zero
 * — no partial credit. After firing, the button disarms until the
 * hand leaves the circle: holding through a fire must not fire twice
 * (e.g. select a recipe, keep holding, accidentally start it).
 *
 * Pure + stateful, modelled on `core/pressDetector.ts`: timestamp
 * driven, one event per hold. The hand CIRCLE is the hitbox — the
 * caller tests the confirm hand's wrist point (or A's
 * `handCircleGeometry` centre when it lands) against
 * `pointInActionCircle`.
 */

import { ACTION_BUTTON } from './config';

/** The action button's two modes. */
export type ActionButtonMode = 'town' | 'ok';

/** Canvas-space circle geometry. */
export interface ActionButtonGeometry {
  cx: number;
  cy: number;
  r: number;
}

/**
 * Pure geometry: the circle for a stage. Centre is
 * (`width - centreMarginRightPx`, `centreYPx`), radius `radiusPx`
 * — top-right, out of the body's way. At 960×540: (888, 84), r 36.
 */
export function actionButtonGeometry(
  width: number,
  height: number,
): ActionButtonGeometry {
  void height;
  return {
    cx: width - ACTION_BUTTON.centreMarginRightPx,
    cy: ACTION_BUTTON.centreYPx,
    r: ACTION_BUTTON.radiusPx,
  };
}

/** True when canvas point (x, y) is inside the circle (edge counts). */
export function pointInActionCircle(
  x: number,
  y: number,
  geometry: ActionButtonGeometry,
): boolean {
  const dx = x - geometry.cx;
  const dy = y - geometry.cy;
  return dx * dx + dy * dy <= geometry.r * geometry.r;
}

/** Label under the circle for the mode. */
export function actionButtonLabel(mode: ActionButtonMode): string {
  return mode === 'ok' ? 'OK' : 'Town';
}

/**
 * Dwell-to-activate: hold the confirm hand inside the circle for
 * `dwellMs` to fire. `update` returns true exactly once per hold —
 * the frame the hold completes — and then disarms until the hand
 * leaves and re-enters. `progress` is 0..1 for the fill ring.
 */
export class ActionButtonDwell {
  private readonly dwellMs: number;
  /** ms the current hold started, or null when the hand is outside. */
  private insideSinceMs: number | null = null;
  /** False after a fire until the hand leaves the circle. */
  private armed = true;

  public constructor(dwellMs: number = ACTION_BUTTON.dwellMs) {
    this.dwellMs = dwellMs;
  }

  /**
   * Feed the hand state for `nowMs`. Returns true the frame the
   * hold completes (and only then). A hold that ends early resets
   * to zero — no partial credit carries over.
   */
  public update(inside: boolean, nowMs: number): boolean {
    if (!inside) {
      this.insideSinceMs = null;
      this.armed = true;
      return false;
    }
    if (!this.armed) return false;
    if (this.insideSinceMs === null) {
      this.insideSinceMs = nowMs;
      return false;
    }
    if (nowMs - this.insideSinceMs >= this.dwellMs) {
      this.insideSinceMs = null;
      this.armed = false;
      return true;
    }
    return false;
  }

  /** Fill 0..1 at `nowMs` (0 when the hand is outside or disarmed). */
  public progress(nowMs: number): number {
    if (this.insideSinceMs === null || !this.armed) return 0;
    return Math.min(
      1,
      Math.max(0, (nowMs - this.insideSinceMs) / this.dwellMs),
    );
  }

  /** Forget any in-progress hold (e.g. the circle hid). */
  public reset(): void {
    this.insideSinceMs = null;
    this.armed = true;
  }
}
