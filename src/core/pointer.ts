/**
 * The hand pointer (v3.6): two hands, fixed split — left hand points,
 * right hand confirms (see `POINTER` in `core/config.ts`).
 *
 * The left wrist drives the cursor. Hovering a selectable thing
 * highlights it (the owning screen draws the highlight — the hub
 * reuses its button hover state, the refiner picker gets a glow ring
 * from `main.ts`); the highlight must be visible BEFORE the confirm
 * lands, so the player always knows what they are about to click.
 *
 * The right hand dwells on the top-right action circle
 * (`core/actionButton.ts`) to click the highlighted thing. If the
 * pointer leaves the thing before the confirm lands, the highlight
 * clears and nothing clicks. Dwelling the circle with nothing
 * highlighted does nothing — except town mode in an activity, where
 * it goes to town.
 *
 * Pure + stateful: the controller owns only "what is hovered". The
 * dwell lives in `ActionButtonDwell`; the firing lives in `main.ts`,
 * which knows the screens. Selectable things: hub activity buttons
 * (Mine, Refiner, Bix, Back), recipe cards in the picker, Bix shop
 * actions (Sell 1 / Sell all). The action circle itself is NOT
 * pointer-selectable — it is the confirm target.
 */

import { POINTER } from './config';
import type { BodyState } from './bodyState';

/** One hoverable / confirmable thing, in canvas space. */
export interface Selectable {
  /** Stable id the owner activates on confirm, e.g. 'mine' or 'recipe:refined-ferrite'. */
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** True when canvas point (x, y) is inside the selectable (edge counts). */
export function pointInSelectable(
  x: number,
  y: number,
  selectable: Selectable,
): boolean {
  return (
    x >= selectable.x &&
    x <= selectable.x + selectable.w &&
    y >= selectable.y &&
    y <= selectable.y + selectable.h
  );
}

/**
 * Canvas-space point of one hand's wrist, from a BodyState.
 * `hand` comes from `POINTER` — the logic reads the config, never a
 * hardcoded side, so flipping the split is a one-line config change.
 */
export function handPoint(
  body: BodyState,
  hand: 'left' | 'right',
): { x: number; y: number } {
  return hand === 'left'
    ? { x: body.leftWristX, y: body.leftWristY }
    : { x: body.rightWristX, y: body.rightWristY };
}

/** Canvas-space point of the pointer hand (config: left). */
export function pointerHandPoint(body: BodyState): { x: number; y: number } {
  return handPoint(body, POINTER.pointerHand);
}

/** Canvas-space point of the confirm hand (config: right). */
export function confirmHandPoint(body: BodyState): { x: number; y: number } {
  return handPoint(body, POINTER.confirmHand);
}

/**
 * Hover tracker: which selectable (if any) the pointer is over.
 * `update` returns true when the hovered thing changed. The first
 * selectable containing the point wins; a null point (no body) or a
 * point over nothing clears the hover.
 */
export class PointerController {
  private hovered: Selectable | null = null;

  /** Id of the hovered selectable, or null. */
  public get hoveredId(): string | null {
    return this.hovered === null ? null : this.hovered.id;
  }

  /** The hovered selectable itself, or null. */
  public get hoveredSelectable(): Selectable | null {
    return this.hovered;
  }

  public update(
    point: { x: number; y: number } | null,
    selectables: readonly Selectable[],
  ): boolean {
    const next =
      point === null
        ? null
        : (selectables.find((s) => pointInSelectable(point.x, point.y, s)) ??
          null);
    const changed = (next?.id ?? null) !== (this.hovered?.id ?? null);
    this.hovered = next;
    return changed;
  }

  /** Clear the hover (pointer left, screen changed, no body). */
  public clear(): void {
    this.hovered = null;
  }
}
