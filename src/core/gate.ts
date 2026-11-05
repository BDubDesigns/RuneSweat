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

import { GATE, GATE_ACTIVITIES } from './config';
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
   * What the active activity needs from the body (v3.2, Nov 4
   * playtest). When provided, the gate judges usability from the
   * activity's requirements instead of the global `bodyUsable`
   * (which always requires knees, the swing rule) — so the refiner
   * stays open while a knee dips during a reach, and the swing
   * keeps its strict rule. `null` means the gate does not apply at
   * all (the recipe picker: a mouse click needs no body) and
   * `evaluateGate` returns open. Undefined keeps the old behaviour
   * (global `bodyUsable`, swing grace) for callers that do not pass
   * requirements yet.
   */
  requirements?: GateRequirements | null;
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

/**
 * What one activity needs from the body, from `GATE_ACTIVITIES` in
 * `config.ts`. Shoulders + hips are required by every activity (the
 * frame anchor); `requireKnees` is the per-activity switch — the
 * swing needs the knees as a reference, the refiner does not. The
 * wrists (refiner carry) and buttons (pedestal presses) are the
 * games' own inputs — the grab logic needs both wrists together, the
 * press detector needs the wrists in the button zones — so the gate
 * does not also check them: `BodyState` does not carry wrist
 * visibility, and a gate that pretended to check them would be lying.
 */
export interface GateRequirements {
  /** Knees must each be at or above `GATE.minVisibility`. */
  requireKnees: boolean;
  /** Grace period in ms before a lost body closes the gate. */
  gracePeriodMs: number;
}

/** Activities with a gate preset in `GATE_ACTIVITIES`. */
export type GateActivity = keyof typeof GATE_ACTIVITIES;

/**
 * The gate requirements for an activity, or null when the activity
 * has no gate (the recipe picker). The hub passes the result as
 * `GateOptions.requirements`.
 */
export function gateRequirementsFor(
  activity: GateActivity,
): GateRequirements | null {
  return GATE_ACTIVITIES[activity];
}

/**
 * Usable for one activity: present, in frame, shoulders + hips each
 * at or above `GATE.minVisibility`, and knees too when the activity
 * requires them. This is the per-activity version of
 * `BodyState.bodyUsable` (which always requires knees, the swing
 * rule) — the refiner calls it with `requireKnees: false`, so a knee
 * dipping during a side reach does not close the gate.
 */
export function bodyUsableForActivity(
  body: BodyState | null,
  requirements: GateRequirements,
): boolean {
  if (body === null || !body.present || !body.inFrame) return false;
  const v = body.landmarkVisibility;
  const min = GATE.minVisibility;
  if (
    v.leftShoulder < min ||
    v.rightShoulder < min ||
    v.leftHip < min ||
    v.rightHip < min
  ) {
    return false;
  }
  if (
    requirements.requireKnees &&
    (v.leftKnee < min || v.rightKnee < min)
  ) {
    return false;
  }
  return true;
}

/** Body parts the gate cannot see, for the missing-landmark message. */
export function missingBodyParts(
  body: BodyState | null,
  requirements: GateRequirements | null,
): string[] {
  if (body === null || !body.present) return [];
  const v = body.landmarkVisibility;
  const min = GATE.minVisibility;
  const parts: string[] = [];
  if (v.leftShoulder < min || v.rightShoulder < min) parts.push('shoulders');
  if (v.leftHip < min || v.rightHip < min) parts.push('hips');
  if (
    requirements !== null &&
    requirements.requireKnees &&
    (v.leftKnee < min || v.rightKnee < min)
  ) {
    parts.push('knees');
  }
  return parts;
}

/** "a, b and c" for the missing-parts list. */
function joinParts(parts: readonly string[]): string {
  if (parts.length === 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The 'no-body' message: names the missing landmarks when the gate
 * can see them (v3.2 — "Step back into frame" told the player nothing
 * about what was missing), otherwise the generic step-back line.
 * `hadUsableBefore` picks the never-seen phrasing ("so I can see
 * your whole body") vs the lost-it phrasing ("I can't see your body").
 */
function noBodyMessage(
  body: BodyState | null,
  requirements: GateRequirements | null,
  hadUsableBefore: boolean,
): string {
  if (body !== null && body.present) {
    const parts = missingBodyParts(body, requirements);
    if (parts.length > 0) {
      return `I can't see your ${joinParts(parts)} — step back`;
    }
    if (!body.inFrame) {
      return 'Step back so I can see your whole body';
    }
  }
  return hadUsableBefore
    ? "Step back — I can't see your body"
    : 'Step back so I can see your whole body';
}

/** Truncate a message to `maxChars`, with an ellipsis when cut. */
function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/**
 * Should a lost body show as a small top banner instead of the full
 * blocking overlay (v3.2, Nov 4 playtest)?
 *
 * - `reason === 'no-body'` AND an activity screen is up (a game is
 *   running, hub closed): banner. The full dim + ghost used to cover
 *   the recipe picker, the tier chips and the "Leave to town" control
 *   exactly when the player needed them — the banner keeps the screen
 *   usable while the game sits auto-paused behind it.
 * - Anything else: full overlay. Model problems (failed / loading /
 *   inference-stopped / stale-frame) need the loud surface, never a
 *   small banner — a player must not mistake "model died" for
 *   "step back". And with no activity screen up (empty stage) the
 *   ghost outline is the framing guide, so the overlay stays.
 *
 * The caller (`main.ts`) owns the rest of the contract: the banner is
 * never drawn over a manual pause, and the hub owns its own surface.
 */
export function shouldShowGateBanner(options: {
  reason: GateReason;
  /** True when a game screen is up and the hub is closed. */
  activityScreenUp: boolean;
}): boolean {
  return options.reason === 'no-body' && options.activityScreenUp;
}

/**
 * Decide the gate for one frame.
 *
 * - `requirements === null`: the gate does not apply (recipe picker)
 *   — always open, whatever the body or model state. Picking is a
 *   mouse click; the gate must not pause anything or draw anything
 *   over the chips. `lastUsableMs` is left untouched, so the grace
 *   clock still measures from the last real usable frame when the
 *   player leaves the picker.
 * - Model failed / loading / inference-stopped: gated, regardless of body
 *   state.
 * - Stale frame (frameAgeMs > GATE.staleFrameMs): gated with
 *   'stale-frame', regardless of body state and regardless of the grace
 *   period — a frozen feed must never keep the game running.
 * - Body usable for the activity: open, and `lastUsableMs` advances to
 *   `nowMs`. Usability is judged by `options.requirements` when
 *   provided (per-activity), otherwise by the global `bodyUsable`
 *   (swing rule: shoulders + hips + knees).
 * - Body not usable and never usable: gated immediately (a game started
 *   with no usable pose must not start its simulation).
 * - Body lost mid-game: gated only once the activity's grace period
 *   has passed since the last usable frame, so one dropped inference
 *   frame never pauses.
 *
 * The 'no-body' message names the missing landmarks when the gate can
 * see them (shoulders / hips / knees), so the player knows what to fix.
 */
export function evaluateGate(
  body: BodyState | null,
  nowMs: number,
  lastUsableMs: number | null,
  modelState: ModelState,
  options: GateOptions = {},
): GateState {
  // The picker has no gate at all (v3.2): no pause, no overlay, no
  // message — and the grace clock is not advanced by the picker, so
  // leaving it with a lost body still trips on the real grace.
  if (options.requirements === null) {
    return { gated: false, reason: 'open', message: '', lastUsableMs };
  }
  const requirements = options.requirements;
  const gracePeriodMs =
    options.gracePeriodMs ??
    requirements?.gracePeriodMs ??
    GATE.gracePeriodMs;

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

  const usable =
    requirements !== undefined
      ? bodyUsableForActivity(body, requirements)
      : (body !== null && body.bodyUsable);
  if (usable) {
    return { gated: false, reason: 'open', message: '', lastUsableMs: nowMs };
  }

  if (lastUsableMs === null) {
    return {
      gated: true,
      reason: 'no-body',
      message: noBodyMessage(body, requirements ?? null, false),
      lastUsableMs,
    };
  }
  if (nowMs - lastUsableMs <= gracePeriodMs) {
    return { gated: false, reason: 'open', message: '', lastUsableMs };
  }
  return {
    gated: true,
    reason: 'no-body',
    message: noBodyMessage(body, requirements ?? null, true),
    lastUsableMs,
  };
}
