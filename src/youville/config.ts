/**
 * YouVille 0.1 tuning. Everything the on-device playtest may need to
 * adjust lives here (the lever thresholds stay in `core/config.ts`
 * as `LEVER_CONFIRM`, from draft PR #2).
 *
 * Gesture geometry is body-relative: wrist offsets are measured from
 * the shoulder midpoint in torso lengths, so the same numbers work
 * for a child and an adult, near and far from the camera.
 */

/** The fixed logical world every room is authored in (canvas pixels). */
export const WORLD = {
  width: 960,
  height: 540,
  /** y of the floor line avatars stand on. */
  floorY: 452,
} as const;

/** Door interaction (proximity, cooldown, pose freshness). */
export const DOOR_INTERACTION = {
  /** After any transition / intent, no new intent for this long. */
  cooldownMs: 1400,
  /** A pose frame older than this is "stale": recognizers reset. */
  poseMaxAgeMs: 600,
} as const;

/** Lateral walking in a bounded room. */
export const WALK = {
  /**
   * After the pose (re)appears, wait this long before anchoring the
   * camera mapping: the tracker's smoothing is still catching up with
   * a body that just came back, and anchoring early would drag the
   * avatar.
   */
  resumeSettleMs: 350,
  /** Camera mode: world px moved per 1.0 of normalized torso shift. */
  cameraGainPx: 2300,
  /** Ignore torso jitter smaller than this (normalized units). */
  deadZone: 0.004,
  /** Smoothing time constant toward the target, ms. */
  smoothingTauMs: 110,
  /** Hard cap on avatar speed from the camera, px/s. */
  maxCameraSpeedPxPerSec: 520,
  /** Touch / keyboard walking speed, px/s. */
  touchSpeedPxPerSec: 280,
} as const;

/** Reusable fade between rooms. */
export const TRANSITION = {
  fadeOutMs: 320,
  holdMs: 90,
  fadeInMs: 320,
} as const;

/**
 * Disco / Travolta: one hand makes two deliberate diagonal passes
 * across the torso. Sequence: UP zone (hand high and out to one side)
 * -> LOW zone (hand low and across the midline, opposite side) -> UP
 * zone again. Coordinates are (wrist - shoulderMid) / torsoLength,
 * y down.
 */
export const TRAVOLTA = {
  /** Hand is "up" when its y offset is at or above this (negative = above). */
  upMaxY: -0.25,
  /** ...and at least this far out to one side of the midline. */
  upMinAbsX: 0.45,
  /** Hand is "low" when its y offset is at or below this... */
  lowMinY: 0.45,
  /** ...and at least this far across the midline, opposite the up side. */
  lowMinAbsX: 0.08,
  /**
   * Minimum time to travel between zones. Low on purpose: at the
   * Pixel's ~9 Hz inference a fast real swing is ONE frame (~110 ms)
   * between zones. Glitch spikes are rejected by `totalMinMs` instead.
   */
  legMinMs: 50,
  /** Maximum time to travel between zones. */
  legMaxMs: 950,
  /** First departure to completing the second pass. */
  totalMaxMs: 2400,
  /** Two passes cannot honestly be faster than this (rejects 1-2 frame glitches). */
  totalMinMs: 360,
  /** Wrists this close (torso lengths) while a hand is above `crossedMaxY` = crossed/clasped hands. */
  crossedWristsTorso: 0.4,
  crossedMaxY: 0.6,
} as const;

/**
 * T-drop: hold both arms out horizontally (a T), then bring both
 * arms down beside the body inside a finite window.
 */
export const T_DROP = {
  horizontalMinDeg: 70,
  horizontalMaxDeg: 110,
  /** Hold the T this long before it counts as the deliberate start pose. */
  holdMs: 350,
  /** Both arms are "down" at or beyond this |angle|. */
  downMinDeg: 145,
  /** Hold both arms down this long to confirm. */
  downHoldMs: 90,
  /** Leaving the T to both-arms-down must finish within this. */
  dropMaxMs: 1100,
  /** One arm leaving the T while the other stays out longer than this = accident. */
  asymmetryMs: 450,
} as const;

/** Closet creator layout and feedback. */
export const CREATOR = {
  /** Pointer ring radius for the hover cursor, px. */
  cursorRadiusPx: 22,
  /** "Locked in!" feedback duration, ms. */
  confirmFlashMs: 700,
} as const;
