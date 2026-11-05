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
 * Body-visible gate. A game must not run while no usable pose is
 * present — otherwise the player can lose (as in the Nov 4 playtest:
 * Game Over, score 0) without ever having been seen.
 *
 * v3.7 (Nov 5, 2026): shoulders + hips ONLY — knees are no longer a
 * gate input anywhere. The v3.6 playtest showed why: Brandon reached
 * up to the top-right action circle, his knees left the frame, the
 * gate tripped ("can't see my knees"), and the hover/dwell did
 * nothing. The swing only needs arms + head + chest, so knees were
 * never load-bearing for the game — they were a framing proxy, and a
 * bad one at the top of a reach. This supersedes the v3.2 rule that
 * swings keep knees (and the Nov 4 "Body found with knees hidden"
 * finding that motivated it: the stale-frame rule, not knees, is
 * what stops a frozen feed from counting as a body). Knee
 * visibility is still tracked in `BodyState` (data for the HUD and
 * duck detection) — it just stops being a gate input.
 */
export const GATE = {
  /**
   * Minimum per-landmark visibility for shoulders + hips. Reuses
   * `POSE.minVisibility`; the gate checks each landmark individually —
   * the mean `visibilityScore` can hide one bad landmark.
   */
  minVisibility: 0.5,
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
 * Per-activity gate requirements (v3.2, Nov 4 playtest; knees dropped
 * in v3.7, Nov 5): the gate takes what the activity actually needs,
 * not one global rule — and since v3.7 every activity needs the same
 * thing, shoulders + hips, differing only in grace.
 *
 * The Nov 4 refining playtest kept tripping the gate while Brandon was
 * standing right there: the global rule required knees, and reaching
 * side to side (pile far left, hopper far right) + leaning toward the
 * laptop dipped the far knee below visibility or out of frame. The
 * refiner dropped knees first (v3.2); the v3.6 playtest showed the
 * swing had the same failure at the top of a reach — reaching for
 * the action circle took his knees out of frame and killed the
 * hover/dwell — so v3.7 drops knees for the swing too. The swing
 * only needs arms + head + chest; knees were never load-bearing.
 *
 * - `swing`: shoulders + hips, grace 500 ms: a swing with a lost body
 *   must stop fast.
 * - `refiner-carry` (pick-up / carry / drop): shoulders + hips.
 *   The hands are the point — the grab logic itself needs both
 *   wrists together over the pile, so the gate does not also need
 *   to see the wrists (BodyState does not carry wrist visibility).
 *   Grace 1500 ms: a brief dip while reaching or leaning must not
 *   trip it.
 * - `refiner-press` (pedestal presses): same body rule as carry
 *   (shoulders + hips, 1500 ms grace). The buttons are the press
 *   detector's job — the gate cannot see wrist visibility
 *   (`BodyState` does not carry it), so it does not pretend to. If
 *   `BodyState` ever carries wrist visibility, the gate requirements
 *   should grow `requireWrists` and enforce it here.
 * - `picker`: null — no gate at all. Picking a recipe is a mouse
 *   click; no body is needed, and the gate must not pause anything
 *   or draw anything over the chips. The caller passes null as the
 *   requirements and `evaluateGate` returns open.
 */
export const GATE_ACTIVITIES = {
  swing: { gracePeriodMs: 500 },
  'refiner-carry': { gracePeriodMs: 1500 },
  'refiner-press': { gracePeriodMs: 1500 },
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

/** Pedestal-press detector tuning (`core/pressDetector.ts`, v3.4).
 * A press is both wrists inside their button zones + moving downward
 * + held for `holdMs`. Replaces the star jump (v3.1-3.3): Brandon is
 * too tall for his room to jump without his head/hands leaving the
 * frame, so the jump never counted — the press needs arms only, no
 * vertical space, no legs. Forgiving on purpose: the hold is short
 * (300 ms); the detector judges the press, not perfection.
 *
 * v3.6 geometry (Nov 5 playtest): Brandon's v3.5 video showed the
 * pads still too low — at knee height at the very bottom of the stage
 * while his hands hang at hip/thigh height, counter 0/3 the whole
 * video — and nothing on screen showed where the game thinks his
 * hands are, so aiming was guesswork. The zones move UP to
 * waist/hip height and get taller: top at hip − 0.06 torso (was
 * hip + 0.02), 0.32 tall (was 0.2), same ±0.55 centres and 0.25
 * width. Anchored to the same measurement: the sim body's hanging
 * wrists rest at hip-mid ±0.567 torso, hip + 0.048 torso, so the
 * resting wrist now sits ~0.108 torso below the zone top (it enters
 * the pad from above, with room) and a 0.1-torso push ends at hip +
 * 0.148 torso, ~0.112 torso above the zone bottom — the push fits
 * with slack on both ends instead of starting at the top edge. The
 * sim's pressed depth (hip + 0.12 torso) lands mid-pad. The hand
 * circles (`render/avatar.ts`, v3.6) are the aiming fix: a visible
 * circle at each wrist, the same position the detectors use. */
export const PRESS = {
  /**
   * Both wrists must stay inside their button zones this long (ms)
   * while moving downward, to count one press. A pass-through wave
   * must not press by accident.
   */
  holdMs: 300,
  /**
   * Minimum ms between counted presses. The re-arm (a wrist must
   * leave its zone first) does most of the work; this is the
   * backstop against a noisy frame double-counting.
   */
  minIntervalMs: 500,
  /**
   * Button-zone centres sit this far (torso lengths) left/right of
   * the hip-mid. 0.55 centres the zones on the hanging hands: the
   * sim body's resting wrists sit at hip-mid ±0.567 torso, so the
   * resting wrist lands ~0.017 torso off the zone centre and the
   * press is a short downward push from rest. Was 0.8 (v3.4), which
   * put the buttons just outside shoulder width and made the press
   * a reach — Brandon's v3.4 playtest verdict.
   */
  buttonOffsetTorsoFrac: 0.55,
  /**
   * Button-zone width, in torso lengths. 0.25 is fist/palm-sized:
   * a fist (~0.18-0.2 torso wide) covers the button, with ~0.025
   * torso of slack per side for wrist-landmark jitter. Was 0.5
   * (v3.4) — a slab, not a button.
   */
  buttonZoneWTorsoFrac: 0.25,
  /**
   * Button-zone height, in torso lengths. 0.32 spans hip − 0.06 to
   * hip + 0.26 torso: the resting wrist (hip + 0.048) sits ~0.108
   * torso below the top, and after the full ~0.1-torso press travel
   * (hip + 0.148) it still sits ~0.112 torso above the bottom —
   * slack on both ends, so the push never clips an edge. Was 0.2
   * (v3.5): the wrist started ~0.028 below the top edge, so any
   * upward jitter left the zone before the press began.
   */
  buttonZoneHTorsoFrac: 0.32,
  /**
   * Button-zone top, relative to the hip line, in torso lengths.
   * −0.06 puts the top 0.06 torso ABOVE the hips — waist height,
   * where the hands hang, not knee height at the stage bottom
   * (Brandon's v3.5 playtest: pads at the very bottom, hands at
   * hip/thigh, counter 0/3). The top sits ~0.108 torso above the
   * resting wrist (hip + 0.048), so the hand enters the pad from
   * above. Was +0.02 (v3.5).
   */
  buttonZoneTopOffsetTorsoFrac: -0.06,
  /**
   * Pedestals slide in from off-screen over this long (ms) once the
   * hopper fills — render only; the detector does not read it.
   */
  slideMs: 400,
  /**
   * How far the button travels down when pressed, in torso lengths
   * — render only; the detector does not read it.
   */
  pressDepthTorsoFrac: 0.12,
} as const;

/**
 * Hand-pointer system (v3.6, Nov 5, 2026): two hands, fixed split —
 * Brandon's design from the v3.5 playtest. His right hand reaches
 * the top-right action circle, so the split is:
 *
 * - `pointerHand: 'left'` — the left wrist drives the cursor. Hovering
 *   a selectable thing highlights it; the pointer IS the left hand's
 *   circle (plus the gold cursor ring `render/renderer.ts` draws).
 * - `confirmHand: 'right'` — the right hand dwells on the action
 *   circle (~2 s) to click the highlighted thing.
 *
 * Fixed, not both-hands-can-do-everything: the split is the design,
 * and flipping it later is a one-line change here — every reader
 * (`core/pointer.ts` `handPoint`, `main.ts`, the sim's confirm key)
 * reads these two fields, never a hardcoded side.
 */
export const POINTER = {
  /** Which hand drives the cursor. */
  pointerHand: 'left' as 'left' | 'right',
  /** Which hand dwells on the action circle to confirm. */
  confirmHand: 'right' as 'left' | 'right',
} as const;

/**
 * The top-right action button (v3.6): one context-sensitive circle
 * that replaces the bottom-left "Leave to town" chip — the chip sat
 * half-hidden behind the left press pad in every frame of Brandon's
 * v3.5 playtest video, so the chip is gone and this circle is the
 * only way out of an activity by hand (Space / the Town button still
 * work too).
 *
 * Geometry: top-right of the stage, out of the body's way — centre
 * `width - centreMarginRightPx`, `centreYPx` from the top, radius
 * `radiusPx`. At 960×540 that is (888, 84), r 36: clear of the press
 * pads (y ~287+), the pile/hopper (y 237+), the resting torso
 * (x ≤ 586), the picker cards (x ≤ 800) and the gate banner
 * (bottom y 40) — see the layout test in `core/actionButton.test.ts`.
 *
 * Two modes, and the icon change is the mode signal: houses in an
 * activity with nothing highlighted (dwell = go to town), checkmark
 * when the pointer hovers a selectable thing (dwell = click it).
 * The label under the circle changes with the mode too.
 */
export const ACTION_BUTTON = {
  /** Hold time for a dwell to fire, in ms. */
  dwellMs: 2000,
  /** Circle radius in px. */
  radiusPx: 36,
  /** Centre x = stage width − this. */
  centreMarginRightPx: 72,
  /** Centre y in px from the stage top. */
  centreYPx: 84,
} as const;

/** Refiner tuning (`games/refiner/`). */
export const REFINER = {
  /** Ore shown in the pile at once; the pile refills from owned stock. */
  pileVisibleMax: 10,
  /** Ore a recipe needs in the hopper before pressing starts. */
  hopperCapacity: 2,
  /** Pedestal presses that complete one batch. */
  pressesPerBatch: 3,
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

/**
 * Game registry for the hub: every entry renders as a game card on
 * the select screen (`main.ts`). No Lumberjack here — it is not a
 * RuneSweat skill (Brandon's standing decision, v3.3 removed it
 * from the hub's coming-soon list and v3.4 removed this registry
 * entry, the last place it appeared in the UI). The parked vision
 * doc (`docs/vision-lumberjack.md`) is history, not a game.
 */
export const GAMES = {
  swingLab: { id: 'swing-lab', title: 'Swing Lab', enabled: true },
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
