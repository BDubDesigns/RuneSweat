/**
 * Body-visible gate: the pure decision function the hub runs on.
 *
 * A game must not run while no usable full-body pose is present. This
 * module decides that from a `BodyState` + clock only — no DOM, no game —
 * so it is unit-testable. The hub owns the side effects (pause/resume,
 * overlay, DOM indicator).
 *
 * Model state is a separate axis from body state, on purpose: a model
 * that never loaded must show the model-failure overlay, NOT the
 * "step back" message. The next playtest must be able to tell
 * "model didn't load" from "body not seen" from "body seen, game wrong".
 */

import { GATE } from './config';
import type { BodyState } from './bodyState';

/** Where the pose data stands, from the hub's point of view. */
export type ModelState =
  /** No camera source (mouse sim / replay): the model is not in play. */
  | 'not-applicable'
  /** Camera source, landmarker still initialising. */
  | 'loading'
  /** Camera source, landmarker ready. */
  | 'ready'
  /** Camera source, landmarker init failed (model/WASM did not load). */
  | 'failed';

export type GateReason = 'open' | 'model-loading' | 'model-failed' | 'no-body';

export interface GateState {
  /** True when the game must stay paused / must not start yet. */
  gated: boolean;
  reason: GateReason;
  /** Kid-readable line for the overlay + DOM indicator. */
  message: string;
  /**
   * Last ms a usable body was seen (null when never). The hub feeds this
   * back in on the next call so the grace period survives across frames.
   */
  lastUsableMs: number | null;
}

export interface GateOptions {
  /** Override for tests; defaults to `GATE.gracePeriodMs`. */
  gracePeriodMs?: number;
}

/**
 * Decide the gate for one frame.
 *
 * - Model failed / loading: gated, regardless of body state.
 * - Body usable: open, and `lastUsableMs` advances to `nowMs`.
 * - Body not usable and never usable: gated immediately (a game started
 *   with no usable pose must not start its simulation).
 * - Body lost mid-game: gated only once `gracePeriodMs` has passed since
 *   the last usable frame, so one dropped inference frame never pauses.
 */
export function evaluateGate(
  body: BodyState | null,
  nowMs: number,
  lastUsableMs: number | null,
  modelState: ModelState,
  options: GateOptions = {},
): GateState {
  const gracePeriodMs = options.gracePeriodMs ?? GATE.gracePeriodMs;

  if (modelState === 'failed') {
    return {
      gated: true,
      reason: 'model-failed',
      message: 'Pose model failed to load — check your connection and reload',
      lastUsableMs,
    };
  }
  if (modelState === 'loading') {
    return {
      gated: true,
      reason: 'model-loading',
      message: 'Loading pose model…',
      lastUsableMs,
    };
  }

  if (body !== null && body.bodyUsable) {
    return { gated: false, reason: 'open', message: '', lastUsableMs: nowMs };
  }

  if (lastUsableMs === null) {
    return {
      gated: true,
      reason: 'no-body',
      message: 'Step back so I can see your whole body',
      lastUsableMs,
    };
  }
  if (nowMs - lastUsableMs <= gracePeriodMs) {
    return { gated: false, reason: 'open', message: '', lastUsableMs };
  }
  return {
    gated: true,
    reason: 'no-body',
    message: "Step back — I can't see your body",
    lastUsableMs,
  };
}
