/**
 * Pose tracking types for Lara's Pose Games.
 *
 * These types are OURS. They deliberately do not import MediaPipe types, so
 * that `tracking/` and `sim/` stay pure and so the real tracker, the replay
 * harness and the mouse simulator can all satisfy one contract with the same
 * game code unchanged — the same seam as the Spider-Man repo, but for the
 * 33-point full-body pose instead of 21-point hands.
 *
 * Model-output discipline: the model exposes exactly one thing we consume —
 * `landmarks`, 33 normalized points. It does NOT expose per-person detection
 * confidence as an observable output; `minVisibility` in config is a
 * configuration input, not an output. `visibility` on each landmark IS a
 * model output and is the only confidence-like value in these types.
 *
 * Any continuity, gesture or staleness value is a **game-computed heuristic**
 * derived from observations, and is named so it cannot be mistaken for model
 * output.
 */

/**
 * MediaPipe PoseLandmarker landmark indices, in the model's documented order.
 * Named here because raw numeric indices in geometry code are unreadable
 * and a mis-indexed joint is a silent bug.
 */
export const PoseLandmark = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

/** Union of the valid landmark indices. */
export type PoseLandmarkIndex = (typeof PoseLandmark)[keyof typeof PoseLandmark];

/** The model's fixed landmark count per person. */
export const POSE_LANDMARK_COUNT = 33;

/**
 * A single normalized landmark, in **video space**.
 * - `x` is `[0,1]` across the source's intrinsic width, origin at the
 *   **left**, as captured and therefore **unmirrored**. Mirroring happens
 *   exactly once, in `toCanvas()`.
 * - `y` is `[0,1]` down the source's intrinsic height, origin at the top.
 * - `z` is the model's raw relative depth passthrough. Never use `z` for
 *   screen position. Nothing reads it.
 * - `visibility` is the model's own per-landmark visibility estimate.
 */
export interface NormalizedLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

/** Skeleton connections, as pairs of named landmark indices. */
export const SKELETON_CONNECTIONS: ReadonlyArray<
  readonly [PoseLandmarkIndex, PoseLandmarkIndex]
> = [
  [PoseLandmark.NOSE, PoseLandmark.LEFT_EYE_INNER],
  [PoseLandmark.LEFT_EYE_INNER, PoseLandmark.LEFT_EYE],
  [PoseLandmark.LEFT_EYE, PoseLandmark.LEFT_EYE_OUTER],
  [PoseLandmark.LEFT_EYE_OUTER, PoseLandmark.LEFT_EAR],
  [PoseLandmark.NOSE, PoseLandmark.RIGHT_EYE_INNER],
  [PoseLandmark.RIGHT_EYE_INNER, PoseLandmark.RIGHT_EYE],
  [PoseLandmark.RIGHT_EYE, PoseLandmark.RIGHT_EYE_OUTER],
  [PoseLandmark.RIGHT_EYE_OUTER, PoseLandmark.RIGHT_EAR],
  [PoseLandmark.MOUTH_LEFT, PoseLandmark.MOUTH_RIGHT],
  [PoseLandmark.LEFT_SHOULDER, PoseLandmark.RIGHT_SHOULDER],
  [PoseLandmark.LEFT_SHOULDER, PoseLandmark.LEFT_ELBOW],
  [PoseLandmark.LEFT_ELBOW, PoseLandmark.LEFT_WRIST],
  [PoseLandmark.RIGHT_SHOULDER, PoseLandmark.RIGHT_ELBOW],
  [PoseLandmark.RIGHT_ELBOW, PoseLandmark.RIGHT_WRIST],
  [PoseLandmark.LEFT_SHOULDER, PoseLandmark.LEFT_HIP],
  [PoseLandmark.RIGHT_SHOULDER, PoseLandmark.RIGHT_HIP],
  [PoseLandmark.LEFT_HIP, PoseLandmark.RIGHT_HIP],
  [PoseLandmark.LEFT_HIP, PoseLandmark.LEFT_KNEE],
  [PoseLandmark.LEFT_KNEE, PoseLandmark.LEFT_ANKLE],
  [PoseLandmark.LEFT_ANKLE, PoseLandmark.LEFT_HEEL],
  [PoseLandmark.LEFT_HEEL, PoseLandmark.LEFT_FOOT_INDEX],
  [PoseLandmark.RIGHT_HIP, PoseLandmark.RIGHT_KNEE],
  [PoseLandmark.RIGHT_KNEE, PoseLandmark.RIGHT_ANKLE],
  [PoseLandmark.RIGHT_ANKLE, PoseLandmark.RIGHT_HEEL],
  [PoseLandmark.RIGHT_HEEL, PoseLandmark.RIGHT_FOOT_INDEX],
];

/** Where a frame's data came from. */
export type FrameProvenance =
  /** Produced by a real detector on a real frame. */
  | 'observed'
  /** Advanced between detections for rendering only. Never classify these. */
  | 'interpolated'
  /** Produced by a simulator or replay fixture, not by a detector. */
  | 'simulated';

/** One frame of pose data from any source. */
export interface RawPoseFrame {
  /** Monotonic timestamp on the render loop's clock, in ms. */
  timestampMs: number;
  /**
   * Exactly `POSE_LANDMARK_COUNT` entries when a person is detected,
   * `null` when no person is in frame. Order is the model's order.
   */
  landmarks: NormalizedLandmark[] | null;
  /** Which source produced this frame, for the debug HUD. */
  sourceId: string;
  provenance: FrameProvenance;
}

/**
 * The one interface every pose-data source implements.
 *
 * `frameAt()` is pulled by the render loop rather than pushed, which keeps
 * the source free of timers and DOM and keeps render decoupled from any
 * inference loop: the MediaPipe source runs inference on its own cadence
 * and `frameAt()` returns the latest result.
 */
export interface PoseFrameSource {
  /** Stable identifier, surfaced in the debug HUD. */
  readonly id: string;
  /** Provenance reported on every frame this source emits. */
  readonly provenance: FrameProvenance;
  /** Begin producing frames. `nowMs` is the render loop's monotonic clock. */
  start(nowMs: number): void;
  /** Stop producing frames. `frameAt()` must return `null` until restarted. */
  stop(): void;
  /**
   * The frame for this instant, or `null` if no frame is available.
   * Implementations may advance internal animation state, so `nowMs` must be
   * monotonically non-decreasing. The same `nowMs` with unchanged inputs must
   * yield the same frame, which is what makes these sources unit-testable
   * without a browser.
   */
  frameAt(nowMs: number): RawPoseFrame | null;
}

/** True when a frame carries a complete 33-landmark pose. */
export function isCompletePose(frame: RawPoseFrame): boolean {
  return frame.landmarks !== null && frame.landmarks.length === POSE_LANDMARK_COUNT;
}
