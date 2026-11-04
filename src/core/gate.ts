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
  | 'failed'
  /**
   * Camera source, landmarker loaded but inference has stopped (repeated
   * inference errors — Worker A's `inferenceStopped` flag). The model is
   * not loading and not failed at init; it ran and then died, so the gate
   * needs its own reason and message, not the init-failure one.
   */
  | 'inference-stopped';

export type GateReason =
  | 'open'
  | 'model-loading'
  | 'model-failed'
  | 'no-body'
  | 'stale-frame'
  | 'inference-stopped';

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
  /**
   * Age of the latest pose frame in ms, from the hub (nowMs minus the
   * last inference frame's timestamp). When defined and above
   * `GATE.staleFrameMs` the gate closes with 'stale-frame' — and that
   * beats the grace period, so a frozen feed can never stay open via
   * grace. Undefined means "unknown" and behavior is unchanged, so
   * callers that cannot measure frame age (sim / replay) keep passing.
   */
  frameAgeMs?: number;
  /**
   * The last inference error message, when the source stopped with one.
   * Shown (truncated) in the 'inference-stopped' message so a playtest
   * can tell what died. Omit when the stop had no error attached.
   */
  inferenceError?: string;
}

/** Truncate a message to `maxChars`, with an ellipsis when cut. */
function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/**
 * Decide the gate for one frame.
 *
 * - Model failed / loading / inference-stopped: gated, regardless of body
 *   state.
 * - Stale frame (frameAgeMs > GATE.staleFrameMs): gated with
 *   'stale-frame', regardless of body state and regardless of the grace
 *   period — a frozen feed must never keep the game running.
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
  if (modelState === 'inference-stopped') {
    return {
      gated: true,
      reason: 'inference-stopped',
      message:
        options.inferenceError === undefined
          ? 'Pose detection stopped — tap Retry'
          : `Pose detection stopped — ${truncate(options.inferenceError, 60)}`,
      lastUsableMs,
    };
  }

  // A frozen feed closes the gate even when the last frame's body looked
  // usable, and even inside the grace period: the Nov 4 playtest ran
  // 142 s off one inference frame and never paused because nothing here
  // checked the frame's age.
  if (
    options.frameAgeMs !== undefined &&
    options.frameAgeMs > GATE.staleFrameMs
  ) {
    return {
      gated: true,
      reason: 'stale-frame',
      message: 'Pose feed frozen — tap Retry',
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
