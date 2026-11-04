/**
 * ALL tunable constants for Lara's Pose Games live in this file.
 *
 * Nothing here is measured or derived at runtime. Every knob a parent or
 * developer will tune after a playtest with Lara — arm thresholds, ship
 * speed, enemy speed, pose-match tolerance, audio — is a literal in this
 * module so tuning never means hunting through game code.
 *
 * Follows the same convention as BDubDesigns/spiderman-game `src/config.ts`:
 * grouped `as const` objects, one per subsystem.
 *
 * Coordinate discipline (same as the Spider-Man repo, PLAN §8):
 * - Landmarks live in **video space**: normalized `[0,1]`, origin top-left,
 *   **unmirrored**. Mirroring happens exactly once, in `toCanvas()`.
 * - `z` is model passthrough. Never use it for screen position.
 * - Landmark indices are named in `tracking/poseTypes.ts`; never use raw
 *   numbers in geometry code.
 */

/** Placeholder source ("video") intrinsic size when no camera is running. */
export const SOURCE = {
  width: 640,
  height: 480,
} as const;

/** Fixed-timestep loop constants. */
export const LOOP = {
  /** Simulation timestep, fixed, in ms — independent of render rate. */
  fixedDtMs: 1000 / 60,
  /** Clamp a single frame's measured elapsed time (tab backgrounded, stall). */
  maxFrameMs: 250,
  /** Hard cap on update steps per rendered frame. */
  maxUpdatesPerFrame: 5,
  /** How many render timestamps the FPS readout averages over. */
  fpsWindowFrames: 60,
} as const;

/** Canvas drawing constants. */
export const RENDER = {
  stageColor: '#14141f',
  landmarkRadiusPx: 4,
  skeletonLineWidthPx: 3,
  skeletonColor: '#ffd166',
  leftColor: '#4ea1ff',
  rightColor: '#ff7a59',
  torsoColor: '#e8e8f0',
  hudColor: '#e8e8f0',
  hudBackdropColor: 'rgba(11, 11, 18, 0.72)',
  hudFont: '13px ui-monospace, SFMono-Regular, Menlo, monospace',
  hudPaddingPx: 8,
  hudLineHeightPx: 17,
  /** Big kid-friendly game font (system stack — no webfont download). */
  gameFont: "'Baloo 2', 'Comic Sans MS', 'Chalkboard SE', system-ui, sans-serif",
  gameFontFallback: "system-ui, sans-serif",
} as const;

/**
 * PoseLandmarker configuration.
 *
 * Model choice (Nov 4, 2026, searched same day): MediaPipe PoseLandmarker,
 * 33 landmarks, BlazePose-based, via `@mediapipe/tasks-vision`.
 * Default is LITE for speed on the Pixel 10 Pro XL — ToyStage measured
 * full-body pose at ~8.7 Hz / 78.6 ms inference on that phone, so inference
 * is decoupled from render: render runs at 60 fps, inference at whatever it
 * sustains. Switch `variant` to `'full'` to A/B on-device.
 *
 * MoveNet was considered and rejected for v1: staying on the same MediaPipe
 * stack as the Spider-Man repo keeps 33 landmarks for dance-pose matching
 * and one dependency to learn. See PLAN.md §"Model choice".
 *
 * Model + WASM are self-hosted under `public/` — nothing is fetched from a
 * CDN at runtime. `scripts/download-model.sh` fetches them; see README.
 */
export const POSE = {
  /** Active model variant. `'lite'` (default) or `'full'`. */
  variant: 'lite' as 'lite' | 'full',
  /** Filenames under `public/models/`. */
  liteModelFile: 'pose_landmarker_lite.task',
  fullModelFile: 'pose_landmarker_full.task',
  /** Canonical download URLs (Google storage, verified Nov 4, 2026). */
  liteModelUrl:
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  fullModelUrl:
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  /** WASM lives under `public/wasm/`, copied from the installed package. */
  wasmPath: '/wasm',
  /** One person in frame for v1 (single-player practice). */
  numPoses: 1,
  /** GPU first; the MediaPipe source falls back to CPU if GPU init fails. */
  delegate: 'GPU' as 'GPU' | 'CPU',
  /** Minimum time between inference calls, in ms. Render never waits on this. */
  inferenceMinIntervalMs: 0,
  /** Landmark `visibility` below this counts as "not confidently seen". */
  minVisibility: 0.5,
  /** Torso must be inside this x-range (video space) to count as in frame. */
  inFrameMarginX: 0.08,
} as const;

/** BodyState derivation thresholds. All lengths are in normalized video space. */
export const BODY = {
  /**
   * One Euro filter tuning for the torso + arm smoothing.
   * Lower minCutoff = smoother but laggier. These are the Spider-Man repo's
   * values; retune only after a real playtest with Lara.
   */
  oneEuroMinCutoff: 1.0,
  oneEuroBeta: 0.02,
  oneEuroDCutoff: 1.0,
  /**
   * An arm counts as RAISED when the wrist is above the shoulder by more
   * than this fraction of torso length (shoulder-mid to hip-mid distance).
   */
  raiseThresholdTorsoFrac: 0.25,
  /**
   * An arm counts as EXTENDED when shoulder->wrist distance exceeds this
   * fraction of torso length. A bent raised arm (elbow folded) must not fire.
   */
  extendThresholdTorsoFrac: 0.8,
  /**
   * Arm angle is measured from straight up, in degrees, 0 = straight up,
   * positive = pointing to video-right. Within this many degrees of 0 the
   * shot is straight up; outside it, the missile follows the arm angle.
   */
  straightUpToleranceDeg: 12,
  /** Hard clamp on a fired missile's angle from vertical, in degrees. */
  maxFireAngleDeg: 60,
  /** Hip-mid must rise this far (fraction of torso length) to count as a jump. */
  jumpThresholdTorsoFrac: 0.18,
  /** Hip-mid must drop this far to count as a duck (plus knee bend). */
  duckThresholdTorsoFrac: 0.12,
  /**
   * Knee angle (degrees, 180 = straight leg) below this counts as "bent"
   * for duck detection. A 5-year-old's squat reads around 90-120.
   */
  duckKneeAngleDeg: 140,
  /** Seconds a pose must be held inside tolerance to score in Dance Drop. */
  poseHoldSeconds: 0.6,
} as const;

/** Space Invaders tuning. */
export const INVADERS = {
  /** Ship speed is body-driven, so this is a smoothing rate, not px/s. */
  shipFollowRate: 0.35,
  /** Ship stays inside this x-range of the playfield (fraction of width). */
  shipMinX: 0.06,
  shipMaxX: 0.94,
  missileSpeedPxPerSec: 520,
  missileRadiusPx: 6,
  /** Enemy bullet speed at level 1, px/s. Multiplied by level scaling. */
  enemyBulletSpeedPxPerSec: 90,
  /** Seconds between enemy volleys at level 1. */
  enemyFireIntervalSec: 2.2,
  /** Enemy descent per level-clear, in px. */
  enemyStepDownPx: 18,
  /** Enemy horizontal speed at level 1, px/s. */
  enemySpeedPxPerSec: 26,
  /** Per-level multiplier applied to enemy speed + fire rate. */
  levelSpeedMultiplier: 1.15,
  /** Per-level additive bump to enemy bullet speed. */
  levelBulletSpeedAdd: 12,
  lives: 3,
  /** Rows x cols of the starting formation. */
  rows: 3,
  cols: 5,
  /** Points per enemy ship. */
  pointsPerEnemy: 100,
  /** Points per cleared level. */
  pointsPerLevel: 250,
  /** Grace period after a hit before the next enemy bullet can hurt, in sec. */
  hitGraceSec: 1.5,
} as const;

/** Dance Pose Drop tuning. */
export const DANCE = {
  /** Target stickman fall speed at the first song, px/s. */
  fallSpeedPxPerSec: 90,
  /** Per-round speed bump. */
  fallSpeedAddPerRound: 12,
  /** Height of the player's scoring zone, in px. */
  zoneHeightPx: 140,
  /** Pose-match score >= this counts as a match (0..1). */
  matchThreshold: 0.72,
  /** "Perfect" needs a score >= this AND the target centred in the zone. */
  perfectThreshold: 0.88,
  /** Rounds per game before the results screen. */
  roundsPerGame: 8,
  /** Points for Perfect / Good. */
  pointsPerfect: 300,
  pointsGood: 150,
} as const;

/** Web Audio synth SFX. All sounds are synthesized — no audio files. */
export const AUDIO = {
  enabled: true,
  /** Master gain 0..1. */
  masterGain: 0.5,
  /** Shoot: quick descending blip. */
  shootFreqHz: 880,
  shootEndFreqHz: 220,
  shootDurationSec: 0.12,
  /** Reload: two clicks, 90 ms apart. */
  reloadClickFreqHz: 1200,
  reloadGapSec: 0.09,
  /** Hit: low thud. */
  hitFreqHz: 140,
  hitDurationSec: 0.25,
  /** Win jingle: ascending notes. */
  winNotesHz: [523, 659, 784, 1047],
  winNoteSec: 0.12,
  /** Dance Drop: Perfect / Good / Miss. */
  perfectFreqHz: 1047,
  goodFreqHz: 784,
  missFreqHz: 220,
  feedbackDurationSec: 0.18,
} as const;

/** Mouse/touch simulator constants. The sim is a permanent fixture: it is
 *  the playable fallback when there is no camera, so its geometry is
 *  normalized exactly like the real pose math. */
export const SIM = {
  /** Shoulder width of the fake body, in normalized video-space units. */
  shoulderWidth: 0.22,
  /** Torso length (shoulder-mid to hip-mid), normalized units. */
  torsoLength: 0.3,
  /** Arm length shoulder->wrist when extended, normalized units. */
  armLength: 0.32,
  /** Leg length hip->ankle, normalized units. */
  legLength: 0.34,
  /** Time for an arm to animate between down and raised, in ms. */
  raiseMs: 120,
  /** Hip-mid y when standing, normalized units. */
  standingHipY: 0.55,
  /** How far the hips rise (normalized) while the sim is jumping. */
  jumpRise: 0.12,
  /** How far the hips drop (normalized) while the sim is ducking. */
  duckDrop: 0.1,
  /** Handedness/visibility the sim reports for every landmark. */
  visibility: 0.99,
} as const;

/** Replay harness constants. */
export const REPLAY = {
  /** Loop the clip when it reaches the end. */
  loop: true,
  /** Frame rate used when a fixture omits `fps`. */
  fallbackFps: 24,
} as const;

/** Camera. */
export const CAMERA = {
  /** Preferred capture size; the browser may give the nearest available. */
  width: 1280,
  height: 720,
  /** Front camera. */
  facingMode: 'user' as const,
} as const;

/** Game registry for the hub. `enabled: false` games show as "Coming soon". */
export const GAMES = {
  spaceInvaders: { id: 'space-invaders', title: 'Space Invaders', enabled: true },
  danceDrop: { id: 'dance-drop', title: 'Dance Pose Drop', enabled: true },
  autoRunner: { id: 'auto-runner', title: 'Auto Runner', enabled: false },
  lumberjack: { id: 'lumberjack', title: 'Lumberjack', enabled: false },
} as const;

/** Debug affordances. */
export const DEBUG = {
  /** Draw the FPS / source readout. */
  showHud: true,
  /** Draw the skeleton + landmarks over the video. */
  showSkeleton: true,
  /** Draw source-space corner markers that make mirroring obvious. */
  showSourceMarkers: false,
} as const;

/** How the input source is selected at startup. */
export const SOURCE_SELECTION = {
  /** `?source=mouse`, `?source=replay`, `?source=camera`. */
  queryParam: 'source',
  /** Used when the query parameter is absent or unrecognized. */
  defaultSource: 'camera',
} as const;
