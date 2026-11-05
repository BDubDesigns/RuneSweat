/**
 * ALL tunable constants for RuneSweat live in this file.
 *
 * Nothing here is measured or derived at runtime. Every knob a
 * developer will tune after a playtest — arm thresholds, swing
 * velocity, pose-match tolerance, audio — is a literal in this
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

/**
 * Fixed game stage. The canvas backing store is ALWAYS this size, never
 * the video's intrinsic dimensions — a portrait phone video must not make
 * a tall narrow game. Pose coordinates are normalized, so mapping via
 * `toCanvas(STAGE.width, STAGE.height)` still works for any capture size.
 * The camera video, when shown at all (calibration only), is letterboxed
 * into this stage preserving its aspect ratio.
 */
export const STAGE = {
  width: 960,
  height: 540,
} as const;

/**
 * Body-visible gate. A game must not run while no usable full-body pose
 * is present — otherwise the player can lose (as in the Nov 4 playtest:
 * Game Over, score 0) without ever having been seen.
 */
export const GATE = {
  /**
   * Minimum per-landmark visibility for shoulders + hips + knees. Reuses
   * `POSE.minVisibility`; the gate checks each landmark individually —
   * the mean `visibilityScore` can hide one bad landmark.
   */
  minVisibility: 0.5,
  /**
   * Knees are required for full-body swing games: a body counts as usable
   * only when shoulders + hips + knees are EACH at or above
   * `minVisibility`. The Nov 4, 2026 Swing Lab playtest showed "Body
   * found" while the knees were hidden, so the gate was trusting a
   * partial body. The grace period still covers mid-game knee flicker.
   */
  requireKnees: true,
  /**
   * A pose frame older than this (ms) counts as a frozen feed and closes
   * the gate, even inside the grace period. The Nov 4 playtest ran for
   * 142 s off a single inference frame and never paused — the gate
   * trusted `bodyUsable` with no age check. 2000 ms is far above the
   * ~110 ms cadence of ~9 Hz inference, so a healthy feed never trips it.
   */
  staleFrameMs: 2000,
  /**
   * Grace period in ms before the gate trips when a pose is lost mid-game,
   * so a single dropped inference frame does not pause the game. A game
   * started with no usable pose ever is gated immediately (no grace).
   * Staleness (see `staleFrameMs`) beats the grace period: a frozen frame
   * must not stay open via grace.
   *
   * This is the DEFAULT (swing) grace. Activities with their own grace
   * live in `GATE_ACTIVITIES` below — the gate reads the active
   * activity's grace, not this one, when the caller passes requirements.
   */
  gracePeriodMs: 500,
} as const;

/**
 * Per-activity gate requirements (v3.2, Nov 4 playtest): the gate takes
 * what the activity actually needs, not one global rule.
 *
 * The Nov 4 refining playtest kept tripping the gate while Brandon was
 * standing right there: the global rule required knees, and reaching
 * side to side (pile far left, hopper far right) + leaning toward the
 * laptop dipped the far knee below visibility or out of frame.
 *
 * - `swing`: the full-body game. Knees are a real reference — the Nov
 *   4 playtest showed "Body found" with the knees hidden, which is
 *   why `requireKnees` exists — so they stay required, and the grace
 *   stays short (500 ms): a swing with a lost body must stop fast.
 * - `refiner-carry` (pick-up / carry / drop): the hands are the point
 *   — the grab logic itself needs both wrists together over the pile,
 *   so the gate does not also need to see the wrists (BodyState does
 *   not carry wrist visibility). What the gate checks is shoulders +
 *   hips; knees are NOT required. Grace 1500 ms: a brief dip while
 *   reaching or leaning must not trip it.
 * - `refiner-jump` (star jumps): same body rule as carry (shoulders
 *   + hips, 1500 ms grace). The ankles are the jump signal, but the
 *   leg-spread check lives in the star-jump detector itself — the
 *   gate cannot see ankle visibility (BodyState does not carry it),
 *   so it does not pretend to. If `BodyState` ever carries wrist /
 *   ankle visibility, the gate requirements should grow `requireWrists`
 *   / `requireAnkles` and enforce them here.
 * - `picker`: null — no gate at all. Picking a recipe is a mouse
 *   click; no body is needed, and the gate must not pause anything
 *   or draw anything over the chips. The caller passes null as the
 *   requirements and `evaluateGate` returns open.
 */
export const GATE_ACTIVITIES = {
  swing: { requireKnees: true, gracePeriodMs: 500 },
  'refiner-carry': { requireKnees: false, gracePeriodMs: 1500 },
  'refiner-jump': { requireKnees: false, gracePeriodMs: 1500 },
  picker: null,
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
 * stack as the Spider-Man repo keeps 33 landmarks for full-body pose work
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
  /**
   * Relative segment only — NO leading slash. Joined with
   * `import.meta.env.BASE_URL` at use (see `assetUrl`), so it resolves
   * under the app's subpath on GitHub Pages instead of the domain root.
   */
  wasmPath: 'wasm',
  /** One person in frame for v1 (single-player practice). */
  numPoses: 1,
  /** GPU first; the MediaPipe source falls back to CPU if GPU init fails. */
  delegate: 'GPU' as 'GPU' | 'CPU',
  /** Minimum time between inference calls, in ms. Render never waits on this. */
  inferenceMinIntervalMs: 0,
  /**
   * Consecutive failed inferences before the source recovers: on GPU it
   * closes and re-creates the landmarker on the CPU delegate; on CPU it
   * stops inferring (`inferenceStopped`) instead of failing silently
   * forever. See `tracking/mediapipeSource.ts`.
   */
  maxConsecutiveFailures: 10,
  /**
   * ms without `video.currentTime` advancing (while the stream is live)
   * before the video counts as frozen (`videoFrozen`). A frozen video
   * means every inference sees the same frame, however healthy the model
   * looks — the Nov 4, 2026 Pixel playtest froze exactly this way.
   */
  videoFrozenMs: 2000,
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
   * values; retune only after a real playtest.
   */
  oneEuroMinCutoff: 1.0,
  oneEuroBeta: 0.02,
  oneEuroDCutoff: 1.0,
  /**
   * Wrist-only One Euro tuning (Nov 4, 2026, Swing Lab v2). The wrists
   * are the fastest joints in this game: a chop covers ~1.5 torso
   * lengths in ~0.25 s, and the machine judges the swing on the
   * smoothed wrist velocity, so a 1.0 Hz filter (time constant ~0.16 s,
   * most of the chop) lags the wrist and attenuates the peak. 1.5 Hz
   * cuts the at-rest time constant to ~0.11 s while still strongly
   * attenuating frame-to-frame landmark jitter, which lives near the
   * Nyquist rate (~16 Hz at 33 Hz inference). Beta 0.05 (up from 0.02)
   * lets the cutoff open a little more during the chop itself. Deliberately
   * modest: with no real-camera jitter data in the sandbox, pushing to
   * 2-3 Hz would be a guess. Torso / arm angles keep the Spider-Man
   * values — steadiness matters more than chop latency there. See the
   * Swing Lab v2 note in PLAN.md.
   */
  wristOneEuroMinCutoff: 1.5,
  wristOneEuroBeta: 0.05,
  wristOneEuroDCutoff: 1.0,
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
  /** Hip-mid must rise this far (fraction of torso length) to count as a jump. */
  jumpThresholdTorsoFrac: 0.18,
  /** Hip-mid must drop this far to count as a duck (plus knee bend). */
  duckThresholdTorsoFrac: 0.12,
  /**
   * Knee angle (degrees, 180 = straight leg) below this counts as "bent"
   * for duck detection. A deep squat reads around 90-120.
   */
  duckKneeAngleDeg: 140,
  /**
   * Wrist handedness latch (bodyState.ts, v3). MediaPipe's left/right
   * wrist labels can swap when the hands meet overhead or cross, which
   * used to flip the avatar horizontally mid-swing. The tracker keeps
   * the previous frame's wrist positions and assigns the two detected
   * wrists to left/right by nearest neighbour, not by the model's
   * labels — a label swap must not move the avatar's hands.
   *
   * Re-latch rule: the latched mapping flips only when the alternative
   * assignment is clearly better. `wristLatchOverwhelmTorsoFrac` is
   * the instant case — the alternative beats the current mapping by
   * more than this (torso lengths) in a single frame, e.g. the wrists
   * are far apart and the labels plainly swapped. Otherwise the
   * alternative must win continuously for `wristLatchRelatchMs`
   * (a genuine side-switch, where the model's labels stay swapped
   * after the person turned) before the latch follows it. The
   * alternative must beat the current mapping by at least
   * `wristLatchMarginTorsoFrac` to count as winning at all — that is
   * only a tie-breaker against float noise; the 500 ms streak is what
   * keeps the latch stable, not the margin. While a streak is running
   * the reference positions stay frozen at the last trusted frame, or
   * the streak could never mature (see `latchWrists` in bodyState.ts).
   */
  wristLatchRelatchMs: 500,
  wristLatchOverwhelmTorsoFrac: 0.5,
  wristLatchMarginTorsoFrac: 0.01,
} as const;

/** Face-the-camera hint (Swing Lab v2, advisory only — never a gate). */
export const FACING = {
  /**
   * Minimum shoulder-width-to-torso-length ratio for "facing the
   * camera". Front-facing shoulders read ~0.7-1.0 torso lengths wide
   * (the mouse sim is 0.22 / 0.30 = 0.73; a typical adult's
   * shoulder-width-to-torso ratio is ~0.8); a side profile collapses
   * toward ~0.3-0.4 as one shoulder hides behind the other.
   *
   * Was 0.6 in v2; lowered to 0.5 in v3. The Nov 4 playtest frames
   * (t30, t66) show the hint firing while Brandon is front-facing, so
   * 0.6 is too strict for his framing — his ratio evidently dips below
   * it mid-swing. 0.5 still splits the gap (profile ~0.3-0.4, front
   * ~0.7+) with margin on both sides. Below it the game shows
   * "Face the camera — I can't see you from the side" and nothing else:
   * the swing machine keeps working, because a turned player can still
   * chop — they just chop badly.
   */
  minShoulderWidthTorsoFrac: 0.5,
  /**
   * Debounce (v3): a narrow-shoulder reading must persist this long
   * (ms) before the hint shows. A single noisy frame — or a mid-swing
   * dip while the shoulders compress — must not flash the warning at
   * a front-facing player (t30/t66). The hint clears the moment a
   * good reading returns; only showing it is debounced.
   */
  debounceMs: 500,
  /**
   * Second signal (v3): the nose's horizontal offset from the
   * shoulder midpoint, in torso lengths. Front-facing the nose sits
   * ~0-0.1 off the midline; in profile it rides out toward ~0.3+.
   * When the nose is confidently visible, the hint fires ONLY when
   * the shoulders are narrow AND the nose is off to the side — a
   * front-facing player with a narrow shoulder reading stays silent.
   * When the nose is not visible (`noseOffsetTorsoFrac` null) the
   * shoulder width decides alone.
   */
  maxNoseOffsetTorsoFrac: 0.2,
} as const;

/** Swing Lab tuning (Active RuneSpace Mining prototype, Slice 1). */
export const SWING = {
  /**
   * Windup line: a wrist counts as wound when it is this far ABOVE the
   * shoulder, as a fraction of torso length. A fully raised straight arm
   * reads ~1.0 (arm 0.32 / torso 0.30); a bent raised arm reads ~0.5, so
   * 0.6 needs a real overhead raise with the elbows mostly extended.
   */
  windupHeightTorsoFrac: 0.6,
  /**
   * Partial-raise line: a wrist above the shoulder by this much counts as
   * a "partway" raise. A fast drop from a partway raise is a weak swing
   * ("Swing bigger!"); a slow drop from it is just putting your arms down
   * (no feedback).
   */
  partialHeightTorsoFrac: 0.25,
  /**
   * Strike line: waist height, this far BELOW the shoulder as a fraction
   * of torso length. A counted hit crosses this line on the way down.
   *
   * Was 0.5 (chest level) in v1; moved to 0.85 in Swing Lab v2. The
   * shoulder-to-hip distance is 1.0 torso lengths by definition, and
   * the waist sits just above the hips at ~0.85-0.9: the Nov 4 playtest
   * frames show Brandon's clasped hands finishing at the top of the
   * wooden chair directly in front of him, and the chair-back top is
   * waist height. 0.85 (not 0.9) leaves a little margin above the hip
   * line, so a chop to the node — which sits front-center at waist
   * height — counts without demanding the wrists reach the hips. A chop
   * that stops at chest level (-0.5) no longer counts.
   *
   * Moved to 0.7 in v3: the Nov 4 playtest showed Brandon having to
   * chop too deep ("he shouldn't have to swing quite as low, it keeps
   * losing it"). 0.7 is chest/upper-waist — the wrists finish around
   * the node's top, not at the hips. A chop stopping at -0.6 still
   * does not count.
   */
  strikeLineTorsoFrac: 0.7,
  /**
   * Hands-together line (Swing Lab v2): the wrists count as gripping
   * one pickaxe handle when they are within this many torso lengths of
   * each other (2D distance, smoothed wrist positions). Clasped hands
   * read ~0.05-0.15 apart, so 0.5 gives ~3x slack for tracking noise
   * and a looser grip, while a shoulder-width spread (the mouse sim's
   * shoulder width is 0.73 torso lengths) fails it. Checked during
   * windup / strike and judged at the strike line.
   */
  handsTogetherTorsoFrac: 0.5,
  /**
   * Strike velocity: peak downward wrist velocity during the drop, in
   * torso lengths per second (wristVelY / torsoLength). A real pickaxe
   * swing drops ~1.4 torso lengths in ~0.25 s (peak ~6-8); lowering your
   * arms slowly reads ~1-2. Measured against the mouse sim (hold A+D,
   * release): sim peak is ~7.8 torso/s after tracker smoothing, so 3.0
   * sits well below a real swing and above a slow lower.
   *
   * Lowered to 2.5 in v3: the 3.0 line sat too close to a real chop
   * after the wrist One Euro filter + velocity EMA attenuate the peak
   * (and the machine takes the MINIMUM of the two arms' peaks, so the
   * slower arm governs). A slow lower still reads ~1-2, so 2.5 keeps
   * the separation. The Nov 4 "sometimes doesn't register" misses are
   * the reason — see the weak-swing detail strings in swingMachine.ts,
   * which now report the measured peak so the next playtest can
   * confirm which rule actually rejects.
   */
  strikeVelocityTorsoFracPerSec: 2.5,
  /** Cooldown after a counted hit before the next swing can count, in ms. */
  cooldownMs: 700,
  /** Re-arm after a weak swing before input counts again, in ms. */
  weakRearmMs: 300,
  /** Mining XP per counted hit. */
  xpPerHit: 10,
  /** XP per Mining level (level = floor(xp / xpPerLevel) + 1). */
  xpPerLevel: 100,
  /** Ore per counted hit. */
  orePerHit: 1,
  /** Hits to break one ore node. */
  hitsPerNode: 5,
  /**
   * Node break lifecycle (v3): respawn wait after a break — the progress
   * bar fills over this long — in ms.
   */
  breakRespawnMs: 3000,
  /** The respawned node fades in over this long once the wait completes, in ms. */
  breakFadeInMs: 400,
  /** Broken-node rock pieces fly for this long before disposal, in ms. */
  breakPieceLifetimeMs: 1200,
  /** Rock pieces one broken node splits into. */
  breakPieceCount: 6,
  /** Debris chips thrown off by every counted hit. */
  breakDebrisPerHit: 8,
  /** Debris chips live this long, in ms. */
  breakDebrisLifetimeMs: 600,
  /** Hit shake (v3, harder than v2): duration in ms and offset in px. */
  breakShakeMs: 250,
  breakShakePx: 12,
  /** Screen shake on a hit: duration in ms and offset in px. */
  shakeMs: 150,
  shakePx: 5,
  /** Sparkle particles on a node break. */
  breakParticles: 24,
  /** "Node broken!" banner length, in ms. */
  breakBannerMs: 1400,
  /** Floating "+N XP" text lifetime, in ms. */
  floaterMs: 900,
  /**
   * Wrist-velocity EMA smoothing (bodyState.ts): how much of each new
   * frame-to-frame velocity sample survives. 1 = raw, 0 = frozen.
   * Kept at 0.35 in Swing Lab v2: the EMA already averages ~3 frames
   * at 33 Hz, the machine judges PEAK velocity (which tolerates lag),
   * and raising it without real 33 Hz noise data would trade
   * unmeasured noise for unmeasured speed. Revisit after a phone
   * playtest if strike detection gets noisy.
   */
  wristVelEmaAlpha: 0.35,
  /** Whoosh: falling sweep as the swing comes down. */
  whooshStartFreqHz: 900,
  whooshEndFreqHz: 200,
  whooshDurationSec: 0.18,
  /** Crack: short low thud as the pickaxe lands. */
  crackFreqHz: 220,
  crackDurationSec: 0.15,
  /** Weak swing: dull low tick, no hit. */
  weakTickFreqHz: 180,
  weakTickDurationSec: 0.08,
} as const;

/** Star-jump detector tuning (`core/starJump.ts`). A star jump is a
 * jumping-jack shape: jumping + arms out wide + legs apart. Forgiving
 * on purpose — Brandon is not a gymnast; the detector judges the
 * shape, not perfection. */
export const STAR_JUMP = {
  /**
   * Wrist-to-wrist spread, in torso lengths, for "arms out wide".
   * Shoulder width is ~0.73 torso, so arms straight up read ~0.73;
   * arms angled out ±35° (the sim's Q/E) read ~1.9. 1.2 sits between:
   * clearly wider than overhead, well below a full T-pose (~2.2).
   */
  minWristSpreadTorsoFrac: 1.2,
  /**
   * Both wrists must be at least this far ABOVE the shoulder (torso
   * lengths) — the arms are up/out, not hanging wide at the sides.
   * 0.1 is barely above the shoulder line: a jack's arms are high,
   * but a tired player's arms still count.
   */
  minWristHeightTorsoFrac: 0.1,
  /**
   * Ankle-to-ankle spread, in torso lengths, for "legs apart".
   * Standing hip width reads ~0.59; a jumping jack's feet land
   * ~1.0-1.4 apart. 0.85 splits the gap with margin both ways.
   */
  minAnkleSpreadTorsoFrac: 0.85,
  /**
   * Minimum ms between counted star jumps. A single jack crosses the
   * shape for several frames at ~9 Hz inference; the re-arm (land
   * first) does most of the work, this is the backstop.
   */
  minIntervalMs: 500,
} as const;

/** Refiner tuning (`games/refiner/`). */
export const REFINER = {
  /** Ore shown in the pile at once; the pile refills from owned stock. */
  pileVisibleMax: 10,
  /** Ore a recipe needs in the hopper before star jumps start. */
  hopperCapacity: 2,
  /** Star jumps that complete one batch. */
  starJumpsPerBatch: 3,
  /**
   * Both hands must stay over the pile this long (ms) before one ore
   * sticks — a pass-through wave must not grab by accident.
   */
  grabDwellMs: 200,
  /** XP per Refining level (level = floor(xp / xpPerLevel) + 1). */
  xpPerLevel: 100,
} as const;

/**
 * Bix's shop — sell prices in Credits.
 *
 * ACTIVE-GAME-ONLY, NOT RuneSpace canon. RuneSpace's Bix sells Power
 * Cells at 12cr, buys them back at 4cr, and buys gems (Uncut Quartz 8,
 * Topaz 18, Sapphire 35) — those figures live in RuneSpace shop /
 * dialogue content, not `balance.ts`, and were NOT re-verified against
 * the repo for this slice. The prices below are new values defined
 * here for the active game: ore sells cheap, refined material sells
 * for roughly 3x its ore (2 ore in, 1 refined out, so refining roughly
 * doubles the value of the ore: 2x2cr in -> 6cr out).
 */
export const BIX = {
  /** Credits per unit sold. */
  sellPrices: {
    'ferrite-shale': 2,
    'galvanite': 4,
    'refined-ferrite': 6,
    'galvanic-stock': 10,
  },
} as const;

/**
 * Local save (`core/save.ts`). Single-player, localStorage only.
 *
 * DO NOT rename the key: Brandon's live progress (Mining Lv 5, ore,
 * credits) is stored under `activersespace-save-v1` in browsers that
 * already played the game, and a rename would strand it — the save
 * would load as empty on the new URL. The key name is a historical
 * artifact of the repo it split from; it is not a bug to fix.
 */
export const SAVE = {
  /** Versioned key: bump the version (and the key) on a breaking change. */
  key: 'activersespace-save-v1',
  /** Save format version stored inside the payload. */
  version: 1,
} as const;

/** Web Audio synth SFX. All sounds are synthesized — no audio files. */
export const AUDIO = {
  enabled: true,
  /** Master gain 0..1. */
  masterGain: 0.5,
  /** Quick descending blip. */
  shootFreqHz: 880,
  shootEndFreqHz: 220,
  shootDurationSec: 0.12,
  /** Two clicks, 90 ms apart. */
  reloadClickFreqHz: 1200,
  reloadGapSec: 0.09,
  /** Low thud. */
  hitFreqHz: 140,
  hitDurationSec: 0.25,
  /** Ascending jingle: level clear / game won. */
  winNotesHz: [523, 659, 784, 1047],
  winNoteSec: 0.12,
  /** Feedback chime: high / mid / low. */
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
  /**
   * Ankle spread, in torso lengths, while the sim holds the legs-wide
   * key (X, v3.1): the star-jump detector needs >= 0.85 torso lengths
   * (STAR_JUMP.minAnkleSpreadTorsoFrac), and the sim's standing ankles
   * read ~0.59. 1.15 clears the line with margin without going full
   * splits (~2.2). The real camera needs no key — real ankles move.
   */
  legsWideAnkleSpreadTorsoFrac: 1.15,
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
  swingLab: { id: 'swing-lab', title: 'Swing Lab', enabled: true },
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

/**
 * Avatar outfit slots — the start of the "outfits show on the body"
 * system (Active RuneSpace). A future outfit swaps the same slots; the
 * renderer (`render/avatar.ts`) reads only these fields, never hardcoded
 * colours, so a new outfit is a new `AvatarOutfit` value, not new draw
 * code.
 *
 * - `top`: the torso garment. `'tank'` is the default mining look: a
 *   white tank top with straps over the shoulders.
 * - `bottoms`: the leg garment. `'boxers'` is the default: heart-pattern
 *   boxers (red/pink base, `patternColor` hearts).
 * - `skin`: the bare-limb / face tone.
 * - `hat`: headgear. `'hard-hat'` is the default mining look (yellow);
 *   `'none'` draws the bare head.
 */
export interface AvatarOutfit {
  top: {
    style: 'tank' | 'tee';
    color: string;
    strapColor: string;
  };
  bottoms: {
    style: 'boxers' | 'shorts';
    color: string;
    pattern: 'hearts' | 'plain';
    patternColor: string;
  };
  skin: {
    tone: string;
  };
  hat: {
    style: 'hard-hat' | 'none';
    color: string;
  };
}

/**
 * Default outfit (Nov 4, 2026 playtest redesign): white tank top,
 * heart-pattern boxers, yellow hard hat. This is what Brandon asked the
 * miner to wear — a real SVG-person look, not the stickman.
 */
export const OUTFIT: AvatarOutfit = {
  top: { style: 'tank', color: '#f8f8f2', strapColor: '#f8f8f2' },
  bottoms: {
    style: 'boxers',
    color: '#e5484d',
    pattern: 'hearts',
    patternColor: '#ffffff',
  },
  skin: { tone: '#e8b98a' },
  hat: { style: 'hard-hat', color: '#ffd166' },
};

/** Avatar renderer tuning. Lengths are fractions of torso length. */
export const AVATAR = {
  /** Limb capsule width, as a fraction of torso length. */
  limbWidthTorsoFrac: 0.16,
  /**
   * Head radius, as a fraction of torso length.
   *
   * Was 0.17 in v3; raised to 0.24 in v3.1. Brandon's v3 playtest note:
   * "head too small and disconnected". 0.24 puts the head diameter at
   * ~0.48 torso lengths against a ~0.73-torso shoulder width — a big
   * cartoon head, still narrower than the shoulders. The hard hat scales
   * with the head (`drawHardHat` takes `headR`), so it grows with it.
   */
  headRadiusTorsoFrac: 0.24,
  /**
   * Head centre sits this many head-radii ABOVE the shoulder (neck)
   * line, so the chin overlaps the torso top by the rest of the radius
   * and the head sits ON the neck instead of floating above it. v3
   * centred the head on the ears (`earY - 0.15 * headR`), which left
   * the chin ~25 px above the neck on the sim body. The face is drawn
   * relative to this centre (see `headGeometry` in `render/avatar.ts`),
   * not the nose landmark, so the head can sit on the neck for any
   * ear-to-shoulder distance the framing gives.
   */
  headCentreAboveNeckHeadFrac: 0.55,
  /** Heart size on the boxers, as a fraction of torso length. */
  heartSizeTorsoFrac: 0.09,
  /** One Euro smoothing for avatar joints (same tuning as BODY). */
  oneEuroMinCutoff: 1.0,
  oneEuroBeta: 0.02,
  oneEuroDCutoff: 1.0,
} as const;
