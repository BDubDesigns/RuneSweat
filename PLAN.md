# RuneSweat — PLAN

Active RuneSpace: swing, carry, jump, craft, fight — your body is the
controller. Single-player first. No backend, no telemetry, nothing
leaves the device.

> Repo split (Nov 4, 2026): this repo was split out of
> BDubDesigns/lara-pose-games. The Lara camera games live there and are
> NOT in this repo. The build log below is shared history from before
> the split — the v1 path bug, the freeze fix, and the Swing Lab v2/v3/
> v3.1 rounds all happened in this codebase and are RuneSweat's history
> too. Live at bdubdesigns.github.io/RuneSweat/.

## YouVille 0.1 (Nov 7, 2026, issue #3)

The player-facing page is now YouVille (working title): bedroom ->
closet door (Disco-point or T-drop gesture, or touch) -> fade -> closet
creator (point + lever) -> fade -> bedroom. The RuneSweat hub/games are
unreferenced but kept in the tree. See README "YouVille 0.1" for the
code map and `src/youville/config.ts` for the tunables a Pixel
playtest should adjust. Not yet verified on a real camera.

## Why this exists

The Nov 3, 2026 motion-detection Bubble Pop was liked by Brandon but NOT
by Lara. Pivot (Nov 4, 2026): full-body skeleton pose — whole body, not
hand-only, not motion detection. The games must pick the player out of
the frame and use their movements. Accuracy only needs to be good enough
for a living room, not for measurement.

The Lara games shipped in v1 on that framework; Swing Lab — the Active
RuneSpace Mining prototype — became the first slice of RuneSweat, and
on Nov 4, 2026 Brandon split the repos: the Lara games stay in
lara-pose-games, parked; this repo is RuneSweat, and Swing Lab + town
hub + refiner are its Slice 1 / 1.5.

## Model choice (searched Nov 4, 2026)

**MediaPipe PoseLandmarker, 33 landmarks, BlazePose-based, via
`@mediapipe/tasks-vision` 1.2.2 (pinned exactly). Default variant LITE,
switchable to FULL in `config.ts` (`POSE.variant`) for on-device A/B.**

- Model URLs verified live Nov 4, 2026 (HTTP 200):
  - lite: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task` (5,777,746 bytes)
  - full: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`
- WASM + model are self-hosted under `public/`; `npm run download-model`
  fetches them. Nothing is fetched from a CDN at runtime.
- Inference is decoupled from render: render runs at 60 fps, inference at
  whatever the device sustains. ToyStage measured full-body pose at ~8.7 Hz
  / 78.6 ms inference on the same Pixel 10 Pro XL, so the loop must never
  wait on inference — and it doesn't (`MediaPipePoseSource.frameAt()`
  returns the latest result).

**MoveNet was considered and rejected for v1 — Brandon's decision, Nov 4,
2026: finish the MediaPipe PoseLandmarker v1 first, test it on
the Pixel, and add MoveNet later as a second engine.** Staying on the same
MediaPipe stack as the Spider-Man repo keeps one dependency to learn and
33 landmarks for full-body pose work (MoveNet's 17 points are coarser for
joint-angle scoring). MoveNet's trade-off for later: it is lighter/faster
and may sustain a higher inference rate on the Pixel, at the cost of fewer
landmarks (no hand points, coarser elbows/knees) and a second engine to
maintain. When it lands, it lands as a second `PoseFrameSource`
implementation behind a config flag, with no game-code changes — games
only ever see `BodyState`, so the engine is swappable by construction.
Revisit only after the MediaPipe v1 playtest.

## Prior art followed

BDubDesigns/spiderman-game (Vite + TypeScript strict,
`@mediapipe/tasks-vision` HandLandmarker, zero runtime deps, One Euro
smoothing, `config.ts` as SSOT, `PoseSource`-style interface with
mouse-simulator + replay fallback, fixed-timestep loop, mirroring exactly
once in `toCanvas()`, camera permission via explicit tap, no backend).
This repo mirrors those conventions for the 33-point full-body pose.
BDubDesigns/motion-arcade uses `@mediapipe/tasks-vision` 1.1.0; this repo
pins 1.2.2 (latest stable Nov 4, 2026) and its API was verified against the
installed package's `vision.d.ts`, not from memory.

## Architecture

```
src/
  core/        config.ts (SSOT — every tunable), loop.ts (fixed timestep),
               oneEuro.ts (smoothing), bodyState.ts (the game's view of
               the body), camera.ts (explicit-tap getUserMedia), audio.ts
               (synth SFX, no audio files)
  tracking/    poseTypes.ts (named landmark indices, PoseFrameSource
               interface), mediapipeSource.ts (real tracker, decoupled
               inference, GPU->CPU fallback)
  sim/         mouseSource.ts (pointer = body; hold = raise arm at angle),
               replaySource.ts (+ fixtures/replay-sweep.json)
  render/      stage.ts (toCanvas/toNormalized — mirroring lives here and
               nowhere else), renderer.ts (mirrored video, skeleton,
               stickman-in-rect)
  debug/       hud.ts (FPS, inference Hz, torsoX, arm angles, pose match)
  games/       game.ts (the Game interface — one contract per game)
               swing-lab/    Slice 1 — Active RuneSpace Mining
               refiner/      Slice 1.5 — Refining (entered from the town hub)
  hub/         townHub.ts (manual-pause overlay: inventory, mines, Refiner,
               Bix's shop)
  main.ts      hub (game select, source select, loop wiring, input)
```

**Rules:**
- Games never touch landmark indices — they read `BodyState`.
  Raw landmarks reach a game only through the `landmarks` argument,
  for pose matching.
- `z` is never used for screen position.
- `config.ts` is the only place tunables live. Tuning after a playtest
  means editing one file.
- DRY / SSOT: pose math lives in `bodyState.ts` once; all games reuse it.
  There is no duplicated pose code between games.

## The 33 landmarks (named in `poseTypes.ts`, never raw numbers)

0 nose, 1-8 eyes/ears, 9-10 mouth, 11 left shoulder, 12 right shoulder,
13 left elbow, 14 right elbow, 15 left wrist, 16 right wrist, 17-22 hand
points, 23 left hip, 24 right hip, 25 left knee, 26 right knee, 27 left
ankle, 28 right ankle, 29-32 feet.

## Playtest failure — Nov 4, 2026, and the framework fixes

Brandon playtested the v1 hub on his Pixel phone (front camera,
portrait) from the live GitHub Pages site: body never detected, Game Over,
score 0 — no input ever registered.

**First diagnosis: wrong.** The screenshots looked like a selfie close-up,
so the first theory was "face only, no hips/knees in frame". Brandon
corrected it the same day: he WAS fully in frame; the screenshots showed
the stretching, not his framing. That theory is dead and appears nowhere
in code or copy.

**Real root cause: a base-path bug.** The code loaded the pose model and
WASM from absolute paths (`/models/...`, `/wasm`). On GitHub Pages the app
lived at `/lara-pose-games/` at the time (now `/RuneSweat/`), so `/models`
resolves to the domain root and 404s (verified: 404 at
`bdubdesigns.github.io/models/...`, 200 under the subpath).
PoseLandmarker never loaded on the live site — no pose frames ever —
while localhost at root worked fine, so tests/builds never caught it.
Fixes, all in this repo now:

- `src/core/assetUrl.ts`: `assetUrl(rel)` joins
  `import.meta.env.BASE_URL` (Vite base `'./'`). Model + WASM paths are
  base-relative (`./models/...`, `./wasm`); a test asserts no leading-slash
  asset path is used for model/WASM. A repo-wide search found no other
  absolute asset paths.
- A model-load failure is a loud blocking overlay on stage ("Pose model
  failed to load — check your connection and reload"), not a hub status
  line. The game cannot start while it shows.
- Debug HUD + gate screen show pose diagnostics (model LOADED yes/no,
  inference Hz, last frame age, landmark count, `bodyUsable`,
  per-landmark visibility), so the next playtest can distinguish
  "model didn't load" from "body not seen" from "game logic wrong".
- **Fixed landscape stage:** `STAGE = 960×540` in config; the canvas
  backing store is always that size, never the video's intrinsic size.
  Video (debug only) is drawn letterboxed via `letterboxRect`, never
  stretched; `.stage-wrap` is 16:9.
- **Video hidden by default:** normal play shows stage background +
  skeleton only. A separate "📷 Show Camera" button (`V` key) shows the
  video letterboxed for calibration; Debug (`D`) toggles only the HUD.
- **Body-visible gate** (`src/core/gate.ts`, `GATE` in config):
  `bodyUsable` requires shoulders + hips + knees each individually
  visible (≥ 0.5) and in frame; knees became required in the Nov 4
  Swing Lab freeze round (below) — they used to warn but not block
  (`requireKnees: false`). A game does not start its simulation until
  the gate opens; losing the pose mid-game auto-pauses after a 500 ms
  grace (one dropped frame never pauses), and a pose frame older than
  `GATE.staleFrameMs` (2000 ms) closes the gate even inside the grace
  period. The DOM indicator is red "⚠️ Step back into frame." vs green
  "✅ Body found" for a lost body (v3.1: the auto-pause wording; model
  failures keep the gate's own message). The old inverted out-of-frame logic (which
  hid the warning when there was no body at all) is gone.

## Playtest failure — Nov 4, 2026, Swing Lab freeze

Brandon playtested Swing Lab on his Pixel phone from the live GitHub
Pages site. The debug HUD read: model LOADED, inference 0.0 Hz, frame
age 142.2 s, 33 landmarks, body usable YES, knees hidden. Exactly ONE
inference frame ever succeeded; the game ran off that stale frame for
over two minutes and NEVER paused, even though he wasn't really in
frame when it first claimed to see him.

**What caused it (verified in code, not guessed):**

- `evaluateGate` in `src/core/gate.ts` trusted `body.bodyUsable` with
  no age check, and `main.ts` fed it `latestBody` forever — a frozen
  feed looked exactly like a live one to the gate, so the grace period
  never even came into play.
- `bodyUsable` did not require knees (`GATE.requireKnees: false`), so
  a partial body counted as "Body found" while the knees were hidden.
- There was no model state for inference dying *after* a successful
  load: `ModelState` only had loading / ready / failed, so a source
  that loaded and then stopped inferring read as `ready` forever.
- The HUD showed no inference-error count, no delegate, and no
  video-freeze signal, so nothing on screen said "inference stopped".

**What changed in this round (gate/HUD/docs layer):**

- `GATE.staleFrameMs: 2000` — `evaluateGate` takes an optional
  `frameAgeMs`; above the threshold the gate closes with new reason
  `stale-frame` ("Pose feed frozen — tap Retry"), and staleness beats
  the grace period. `frameAgeMs` undefined means behavior is unchanged
  (sim / replay callers don't measure frame age).
- `GATE.requireKnees: true` — `bodyUsable` now requires shoulders +
  hips + knees EACH ≥ `minVisibility` (0.5). The grace period still
  covers mid-game knee flicker.
- New `ModelState` / `GateReason` `inference-stopped` (contract with
  the source layer, which exposes `inferenceStopped` on
  `MediaPipePoseSource`): the gate closes with "Pose detection stopped
  — tap Retry", or the last inference error truncated to ~60 chars when
  `GateOptions.inferenceError` is passed.
- HUD (`src/debug/hud.ts`, optional fields so existing callers don't
  break): inference error count + last error (~40 chars), delegate
  (`GPU`/`CPU`), video-frozen flag, video `currentTime` age — next to
  the existing fps / inference Hz / frame age / model / landmark lines.

**What changed in this round (source layer + hub integration):**

- `MediaPipePoseSource.frameAt` never calls `detectForVideo` with a
  timestamp ≤ the last attempted one — it returns the last frame
  instead. MediaPipe VIDEO mode requires strictly increasing
  timestamps, and the fixed-step loop used to call `frameAt` once per
  update step, i.e. several times per rendered frame with the same
  `nowMs` on catch-up steps. This is the prime suspect for the freeze:
  the first duplicate-timestamp throw was swallowed (see below), so
  inference never succeeded again. The hub now also fetches a pose
  frame once per rendered frame, in `render()` in `src/main.ts`, never
  in `update()` — update steps share the frame render fetched.
- Inference errors are counted, not swallowed: `lastError`,
  `consecutiveFailures`, `delegateInUse`, `inferenceStopped` on the
  source. After `POSE.maxConsecutiveFailures` (10) GPU failures the
  source closes and re-creates the landmarker on CPU; if CPU also
  fails 10 times, `inferenceStopped` is set and `frameAt` stops
  attempting. `start()` resets the stopped state, so stop+start is
  the way back.
- `src/core/camera.ts` attaches the video element to the DOM hidden
  (fixed, 1px, opacity 0, pointer-events none — never `display:none`,
  which can itself pause playback) and detaches it on stop. The
  source tracks `video.currentTime`: `videoFrozen` when it hasn't
  advanced for `POSE.videoFrozenMs` (2000 ms), and it retries
  `video.play()` best-effort once per stall when the video is paused.
- Hub (`src/main.ts`): tracks the arrival time of the last distinct
  frame and passes `frameAgeMs` + `inferenceError` into
  `evaluateGate`; maps `inferenceStopped` to `ModelState`
  `'inference-stopped'`; wires the new HUD fields from the source; a
  "↻ Retry Camera" button (`#btn-retry`, enabled while the camera is
  on) stops the old source + video and re-runs `startCameraSource`
  from scratch — the picked game stays put, gated, until a fresh
  usable body arrives.

**Still untested on a real device:** whether inference keeps running
on the Pixel through a full Swing Lab session (the duplicate-
timestamp guard is the prime suspect for the freeze, but it is
verified in code + fakes only — the Pixel retest is the proof); the real
inference Hz and delegate in play; whether 2000 ms ever trips on a
healthy feed; the swing thresholds (0.6 windup, 3.0 torso/s) against a
real chop.

## Swing Lab (Active RuneSpace Mining prototype, Slice 1)

- One ore node, one mechanic: a pickaxe swing is a hit. Raise both arms
  overhead (windup), chop down fast through chest level (strike). The
  miner is the player's live skeleton + a pickaxe anchored at the wrists
  (plus a hard hat). Single-arm overhead swings count too; two-handed is
  still one hit, not two.
- State machine (`src/games/swing-lab/swingMachine.ts`, pure and tested):
  Ready → Windup → Strike → Recover → Ready. A hit needs the full arc:
  windup height reached AND peak downward wrist velocity above threshold
  AND wrists crossing the chest line. Cooldown 700 ms (`SWING.cooldownMs`)
  so one swing = one hit. Weak swings give feedback, not a hit:
  "Swing bigger!" (didn't reach windup height) / "Swing faster!"
  (reached windup but dropped slowly), 300 ms re-arm.
- On a hit: node cracks (stages), +1 ore, +10 Mining XP, hit sound +
  screen shake. 5 hits break the node (sparkle, win sound, new node).
  Mining level = floor(XP/100)+1, starting at level 1.
- Wrist tracking lives in `BodyState` (`left/rightWristY`,
  `left/rightWristVelY` in normalized units/sec, positive = down,
  One-Euro-smoothed + EMA, re-baselined on gaps / lost body) — the swing
  machine reads `BodyState` only, never landmarks.
- Live feedback: swing meter, phase name, "last swing" line, wrist
  velocity in the HUD. Mouse-sim: hold A+D (or both mouse buttons) ~0.5 s,
  release both at once to strike.
- SWING thresholds (all in `config.ts`): windup 0.6 torso lengths above
  the shoulder, strike line 0.5 below the shoulder (chest level), strike
  velocity 3.0 torso lengths/sec (measured: mouse-sim drop peaks ~7.8,
  a slow 1.5 s lower reads ~1.4). No elbow-extension requirement — a
  bent-arm swing still counts. (v3 moved the strike line to 0.7 and the
  velocity to 2.5; see the v3 notes below.)
- Repo split (Brandon, Nov 4): the Lara games moved to
  BDubDesigns/lara-pose-games in the split; this repo is RuneSweat now,
  and Swing Lab is its first slice. No new work goes into the Lara games
  from here.

## Not in v1 (documented only)

### Lumberjack / active RuneSpace (vision only — see docs/vision-lumberjack.md)

Swing your body like chopping a tree to control a cute lumberjack SVG:
chop = torso twist + arm swing, XP + wood per chop, whittle/craft with
hand mimes, unlock higher trees/items, mining, better tools. Active
RuneScape / RuneSpace with our own IP. NOT built in v1 — the doc is the
parking lot for the idea.

## Tuning knobs Brandon will most likely need

All in `src/core/config.ts`:
- `BODY.raiseThresholdTorsoFrac` (0.25) — how high the wrist must go to
  count as "raised". Lower if raises aren't registering.
- `BODY.extendThresholdTorsoFrac` (0.8) — how straight the arm must be to
  count as extended. Lower if bent-arm raises should count.
- `BODY.oneEuroMinCutoff` / `oneEuroBeta` — smoothing vs lag.
- `POSE.variant` ('lite' | 'full') — A/B the model on the Pixel.
- `SWING.strikeVelocityTorsoFracPerSec` (2.5) / `windupHeightTorsoFrac`
  (0.6) — the two swing numbers to tune first after a phone playtest.
  Lower the velocity if real chops don't register; lower the windup
  height if shorter players can't reach it. `SWING.cooldownMs` (700) — one
  swing = one hit; shorten only if the game feels sluggish between swings.
  `SWING.strikeLineTorsoFrac` (0.7) — how low the chop must finish.
- `GATE.gracePeriodMs` (500) — how long a lost pose is tolerated before
  the game pauses. (v3.7: `GATE.requireKnees` is deleted — knees are
  not a gate input anywhere; see "RuneSweat v3.7".) `GATE.staleFrameMs`
  (2000) — a pose frame older than this closes the gate
  ("Pose feed frozen") even inside the grace period; raise it
  only if a healthy feed on the target device legitimately goes quiet
  for longer.
- `STAGE` (960×540) — the fixed game aspect. Do not tie it to video size.
- `AUDIO.masterGain` (0.5) — volume.

## Quality gates (same as the Spider-Man repo)

- `npm test` — vitest, unit tests for arm-angle math, swing machine,
  pedestal-press detection, refiner machine, save/inventory, hub wiring.
- `npm run typecheck` — `tsc --noEmit`, strict.
- `npm run lint` — type-aware ESLint, zero warnings.
- `npm run build` — typecheck + vite build.
- All deps pinned exactly; lockfile committed.

## Remaining human test (cannot be verified in this sandbox)

Real-camera feel on the Pixel 10 Pro XL: arm-raise thresholds,
inference Hz on-device, whether the lite model holds the player in
frame while they move fast, and whether the swing thresholds read
right on a real chop. Tune from `config.ts` after that session —
that's what it's for.

**Swing Lab phone test (Brandon, first):** stand back so head-to-knees
fit in frame; wait for the green "✅ Body found" indicator. Raise both
arms straight overhead (meter fills gold, "Now SWING DOWN!"), then chop
down fast. A hit cracks the node, +1 ore, +10 XP. Five hits break the
node; ten hits reach Mining Lv 2. "Swing bigger!" = wrists didn't reach
windup height; "Swing faster!" = dropped slowly instead of chopping.
Still untested on camera: swing thresholds (0.6 windup, 3.0 torso/s
velocity), One-Euro lag at ~9 Hz inference. Render code (canvas drawing)
is untested in Node — it typechecks and builds, but the first visual
check needs a browser.

**Swing Lab phone retest (after the Nov 4 freeze round):** the gate now
pauses on a frozen feed ("Pose feed frozen — tap Retry") and requires
knees visible, and the HUD shows inference errors + delegate + video
freeze. Watch for: inference Hz staying above 0 through a full session
(the Nov 4 freeze is still unexplained at the source layer — if it
recurs, the HUD's error count / last error and the delegate line are
the first things to read), and whether the 2000 ms staleness threshold
ever trips while the feed is healthy.

## Swing Lab v2 — avatar + presentation (Nov 4, 2026)

**Avatar (`src/render/avatar.ts`).** `AvatarRenderer` draws the player
as a chunky character from raw landmarks: thick capsule limbs (~0.16
torso lengths wide), tapered torso in the outfit's top, hips/upper legs
in the outfit's bottoms, dot eyes + smile, simple feet, and the
outfit's hat. Draw order: far arm, far leg, torso, bottoms, near leg,
near arm, head + hat. No body: draws nothing. Per-joint One Euro
smoothing state lives in the renderer (same tuning as `BODY`); games
never see joints. Pure helpers are unit-tested (`avatarJoints`,
`limbWidthPx`, `headRadiusPx`, `resolveOutfit`); canvas drawing itself
is untestable in Node, so the look is verified by a real-device
playtest, not by tests.

**Outfit slots (`config.ts`: `OUTFIT`, `AvatarOutfit`).** The start of
the "outfits show on the body" system. Slots: `top` (style
`tank`/`tee`, colour, strap colour), `bottoms` (style `boxers`/`shorts`,
colour, pattern `hearts`/`plain`, pattern colour), `skin` (tone), `hat`
(style `hard-hat`/`none`, colour). `resolveOutfit(partial)` swaps
whole slots and keeps the rest at the default. Default: white tank top,
red heart-pattern boxers, yellow hard hat — Brandon's Nov 4 redesign
(reference frames live in the lara-pose-games repo, not here).

**Node + pickaxe (`src/games/swing-lab/swingLab.ts`).** The node is
front-center at waist height: `nodeCenterForBody(body, w, h)` puts `x`
at the hip-centre canvas x and `y` half a rock radius below the hips
(rock-top ≈ waist), so the rock occludes the avatar's waist and below.
No body: stage centre, waiting. The pickaxe is gripped in the right
hand at all times: `pickaxeAnchorForBody(body, w, h)` returns the right
wrist (mirrored) + the handle direction along the right forearm from
`body.rightArm.angleDeg`, unclamped — head up when raised, head down at
rest. The old midpoint-of-wrists logic and the old helmet drawing are
gone (the avatar draws the hard hat). The machine still only ever emits
`'two-handed'` hits; `HANDEDNESS_LABELS` is untouched.

**Facing hint (contract with the swing-machine rework).** `SwingSnapshot`
gains a `facingOk: boolean` field (Worker B). `drawPhaseText` reads it
via `snapshotFacingOk()` — a structural `'facingOk' in snap` check, so
the code compiles and runs with or without the field present — and
shows "Face the camera — I can't see you from the side" under the phase
text when the body is present and `facingOk` is false. Hint only, never
a block.

**Still unverified in the sandbox:** the avatar's look on a real phone
screen (proportions, heart pattern legibility, hard-hat placement) and
the two-handed chop feel on a real body — both need Brandon's phone
retest. Canvas drawing is covered only by a stub-context smoke test
(path runs without throwing), not by visual tests.

## Swing Lab v2 — two-handed machine, facing hint, smoothing (Worker B, Nov 4, 2026)

### Machine (`swingMachine.ts`, `SWING`, `FACING`)
- Two-handed only. Windup needs BOTH wrists above the windup line
  (0.6, unchanged) at the same time; one wrist crossing early is not a
  windup and is not punished — the machine waits. The second arm may
  join late.
- Hands-together: wrists within `SWING.handsTogetherTorsoFrac` (0.5
  torso lengths, 2D distance) — clasped hands read ~0.05-0.15, a
  shoulder-width spread (0.73) fails. Checked during windup/strike and
  judged at the line; separating during a fast drop fires `hands-apart`
  ("Both hands together!") at once. A solo arm completing a fast drop
  while the other never wound is also `hands-apart`; a slow solo lower
  is silence.
- Strike line `SWING.strikeLineTorsoFrac` 0.5 -> 0.85: waist height, not
  chest. Reasoning: shoulder-to-hip is 1.0 torso lengths; the Nov 4
  frames show Brandon's clasped hands finishing at the top of the
  wooden chair in front of him, and the chair-back top is waist height
  (~0.8-0.85); 0.85 (not 0.9) leaves margin above the hip line so a
  chop to the waist-high node counts without demanding hip-level wrists.
  A chop stopping at chest level (-0.6) no longer counts (tested).
- Hit velocity is the MINIMUM of the two arms' peak downward
  velocities (peak, not instantaneous, as before). One arm cannot carry
  the swing; with clasped hands min ≈ mean. Threshold stays 3.0.
- Partial attempts are pair attempts: BOTH wrists above the partial
  line (0.25), fast drop to rest = "Swing bigger!", slow = silence.
  One arm rising partway alone is nothing.
- Flick rule fixed: v1 fired "Swing bigger!" when a settled (~0.5 s)
  hold started dropping, because the first fast frames still read above
  the windup line. The rule now requires the pair to have dropped BELOW
  the windup line first (`droppedBelowWindup` guard; same guard on the
  solo attempt). Pipeline test holds 500 ms to lock this in.
- `SwingHandedness` kept as-is; every hit emits `'two-handed'`.
  `SwingBodyInput` gained `leftWristX` / `rightWristX` (hands-together)
  and `shoulderWidthTorsoFrac` (facing). `SwingSnapshot` gained
  `facingOk`; `windupProgress` reads from the LOWER wrist now.
- Cooldown 700 ms, weak re-arm 300 ms, +1 ore / +10 XP / 5 hits per
  node unchanged (they live in the game, not the machine).

### Facing hint (`BodyState.shoulderWidthTorsoFrac`, `FACING`)
- Tracker computes shoulder-to-shoulder distance / torso length,
  One-Euro-smoothed with the standard BODY params, 0 with no body.
  `facingOkFor(width | null)` is the pure helper: null (no body) is
  true, otherwise `width >= FACING.minShoulderWidthTorsoFrac` (0.6).
- Threshold reasoning: front-facing reads ~0.7-1.0 (sim 0.73; typical
  adult ~0.8); side profile collapses to ~0.3-0.4; 0.6 splits the gap.
  Hint only — the gate is untouched and the machine keeps judging
  swings while sideways.

### Smoothing (`BODY.wrist*`, `SWING.wristVelEmaAlpha`)
- Wrists split off the shared One Euro params: `wristOneEuroMinCutoff`
  1.5 (was 1.0), `wristOneEuroBeta` 0.05 (was 0.02), `dCutoff` 1.0.
  Why: the chop covers ~1.5 torso lengths in ~0.25 s; a 1.0 Hz filter
  (τ ~0.16 s) lags most of the chop and attenuates the peak velocity
  the machine judges on. 1.5 Hz cuts τ to ~0.11 s while still killing
  frame-to-frame jitter (near Nyquist, ~16 Hz at 33 Hz inference).
  Deliberately modest — no real-camera jitter data exists to justify
  2-3 Hz. Torso / arm angles keep the Spider-Man values.
- `wristVelEmaAlpha` stays 0.35: the EMA already averages ~3 frames
  at 33 Hz, peak judging tolerates lag, and raising it without noise
  data trades unmeasured noise for unmeasured speed.
- Measured on the sim pipeline (MouseSource -> tracker -> machine),
  new machine + new sim, only the wrist params varying:
  release-to-hit 352 -> 256 ms (300 ms hold), 368 -> 256 ms (500 ms
  hold); peak velocity 6.65 -> 9.59, 8.07 -> 10.84 torso/s. Full suite
  green, so no regression from the shared BODY change.

### Mouse sim clasp (`mouseSource.ts`)
- Both arms straight up together (A+D or both buttons) latch a clasp:
  both wrists follow one handle point on the midline, travelling from
  overhead (raiseT 1) to waist height (raiseT 0). Two independent arcs
  cannot keep wrists together — they bulge >1 torso length apart at
  chest height mid-swing. Each arm follows its own raiseT on the handle
  path, so releasing one hand early genuinely breaks the grip.
- The latch releases 500 ms after both arms are fully down
  (`CLASP_RELEASE_GRACE_MS`, local to the sim): the tracker lags the
  raw motion, and the smoothed wrists cross the strike line ~100 ms
  after the raw drop ends — releasing at the bottom would snap the raw
  wrists to the sides and trip `hands-apart` before the hit lands.
  500 ms still lands inside the 700 ms hit cooldown. Single-arm and
  angled (Q/E) raises never clasp and still follow their own arcs.
- Between chops the hands rest together at waist height. Known wart: a
  single-arm raise started inside the release grace still follows the
  handle (angle ~19° instead of 0°) until the arms rest again.

### Still unverified (needs Brandon's phone)
- Two-handed feel on a real body (thresholds are tuned on the sim +
  the two playtest frames, not on a live chop) and phone inference Hz
  through a full session. The strike line (0.85), hands-together
  (0.5), facing (0.6) and wrist smoothing (1.5 / 0.05) are all first
  guesses to confirm or retune after the retest.

## Swing Lab v3 — RuneSpace node, tiers, ore drops, break lifecycle, fullscreen (Worker B, Nov 4, 2026)

Second playtest (Brandon, Nov 4, ~4:30 PM, laptop, 77 s video): Lv 5, 43 swings, 43 ore. The asks: node bigger/wider/lower (cover the legs more, not more upper body); node looking like a real RuneSpace ore node; the real RuneSpace mining tiers for mine choice; fullscreen mode, or at least the canvas filling the screen; ore coming out of the node on a hit — the actual ore image, starting at the level 1 ore. Same round, added: bigger hit effects, and the node falling apart into pieces on break.

**Node geometry (`swingLab.ts`: `nodeRadiiForStage`, `nodeCenterForBody`).** v3 is an ellipse: rx 0.22, ry 0.17 of the smaller stage dimension (v2 was a 0.15 circle — 0.30 wide/tall; v3 is 0.44 wide x 0.34 tall). The centre sits 1.15 radii below the hips, so the TOP of the rock is 0.15 radii BELOW the hips (v2's top sat half a radius above them) — wider and lower, legs covered more, upper body covered less. No body: stage centre (0.62 height). `nodeCenterForBody` now returns `{x, y, rx, ry}` (`NodeGeometry`).

**RuneSpace look + art (`public/item-art/`, `swingLab.ts`).** The rock face is the real RuneSpace `boulder.webp`, copied from `~/workspace/runespace-local/public/item-art/` (main ba93790) into this repo's `public/item-art/`, cover-fit into the node ellipse and clipped to it. The active tier's ore crystals are drawn embedded in the rock face in the tier's colour (Ferrite Shale rusty orange `#d97b3f`, Galvanite bright silver `#d7dde6`, sampled from the real art). A drawn-rock fallback covers the art-not-loaded case; a failed load never shows a broken image. Art is preloaded once in the game constructor via `assetUrl` (base-relative, never a leading slash — the Nov 4 path bug). Cracks (1 per hit, max 3) get thicker and the rock darkens per hit so the stages read; HP pips stay.

**Tiers (`src/games/swing-lab/tiers.ts`).** Sourced from RuneSpace `game/config/balance.ts` (main ba93790, mining `sources`): Ferrite Shale — The Jag, `requiredMiningLevel` 1, `successXp` 15; Galvanite — Deep Jag, `requiredMiningLevel` 5, `successXp` 25. Level curve stays Swing Lab's own (100 XP/level, `SWING.xpPerLevel`). `MINING_TIERS` is the table; `tierById`, `tierUnlocked`, `tierLockMessage` are the only accessors; adding a tier is a data-only change (one entry: id, name, location, level, XP, ore image, crystal colour). The game holds `activeTier`, starts on Ferrite Shale, and `selectTier(id, nowMs)` refuses locked/unknown tiers (locked shows the "Unlocks at Mining 5 — Deep Jag" floater) and resets the node on a switch. XP per hit is the tier's `successXp`, wired at the scoring layer in `applyEvent` — the swing machine's API is untouched, and `SWING.xpPerHit` (10) is now unused by Swing Lab. The selector is two canvas-drawn chips bottom-right (`drawTierChips`, `pointerDownAt` + the game's own canvas `pointerdown` listener); the hub owns no tier UI. Known wart: tapping a chip in mouse-sim also moves the sim body to the tap point (the hub's canvas pointer handler fires too) — harmless, the body follows the mouse back on the next move.

**Ore drops (`swingLab.ts`: `OreDrop`, `spawnOreDrop`, `drawOreDrops`).** Every counted hit spawns one drop: the tier's real ore image arcs up out of the node and flies to the bottom-left of the stage (toward the HUD's Ore counter below the canvas) over 800 ms (`ORE_DROP_MS`), shrinking and fading. The HUD Ore counter shows the same real ore image next to the count (`hudHtml` `<img>` via `assetUrl`). Image not loaded: the drawn gem in the tier's crystal colour.

**Hit + break effects (`swingLab.ts`: `BREAK`, `breakNode`, `updatePieces`, `drawNodePieces`, `drawRespawnBar`).** Hit: shake 250 ms / 12 px (`BREAK.shakeMs` / `shakePx`, v2 was 150 / 5), meter flash, 8 debris chips (`BREAK.debrisPerHit`, 600 ms). Break (5th hit): the node splits into 6 rock pieces (`BREAK.pieceCount`) that arc up, tumble, and fall with gravity off the bottom; pieces are disposed of off-screen or after 1.2 s (`BREAK.pieceLifetimeMs`), and the list is hard-capped at 24 — verified by a test that breaks 6 nodes and asserts pieces/particles/drops all empty out and the maxima stay at one break's worth. Then a progress bar fills over 3 s (`BREAK.respawnMs`) where the node broke ("⛏️ New node in Ns…"); the node is gone and unminable during the wait — `applyEvent` ignores all events while `nodeGone(nowMs)` — and the new node fades in over 400 ms (`BREAK.fadeInMs`). All break timings live in the `BREAK` module constants in `swingLab.ts`, NOT in `config.ts` (Worker B could not touch `config.ts` this round; the coordinator can move them into `SWING` at integration).

**Fullscreen + fill the screen (`main.ts`, `index.html`).** A "⛶ Fullscreen" button in the stage controls (or `F`) puts the whole stage section fullscreen via the Fullscreen API; the label follows real state through `fullscreenchange` (Esc works), a denied request stays windowed, quitting to the hub exits fullscreen first. Fill-screen sizing: `#app` max-width 1280 px and the stage wrap capped by viewport height as well as width (`min(100%, (100dvh - 300px) * 16/9)`), so the stage is big on desktop by default; 16:9 letterbox inside the stage unchanged, portrait-phone letterboxing untouched. The CSS lives in a `<style>` block in `index.html`, not `styles.css` (outside Worker B's file ownership this round — move it at integration).

**Copy fix.** Hub tip: "you'll see your skeleton" → "you'll see your miner in a hard hat" (v2 shipped a person). Swing Lab hub card: "mine Ferrite Shale at The Jag!".

**Still unverified (needs a real device / browser).** The node's look on a real phone screen (boulder art + crystals at phone size); fullscreen on a real browser; image loading under the Pages subpath (`./item-art/...` — correct by construction via `assetUrl`, never exercised live); whether the bigger shake / debris / pieces read well or overwhelm a small screen; the respawn wait feel (3 s + 400 ms fade) in real play.

## Swing Lab v3.1a — shake settles, bigger head on the neck, two pause kinds (Worker A, Nov 4, 2026)

Brandon's v3 playtest notes: "much better", plus (1) after shaking, the HUD stays jangled around, (2) the head is too small and disconnected — bigger and lower on the neck, (3) a pause redesign: two pause kinds. Worker B builds the town hub / refiner in v3.1b; this slice is the feel fixes + the pause state machine + the wiring points B's hub plugs into.

**Shake settles (`swingLab.ts`: `shakeOffsetPx`, render split).** Root cause: the shake was a constant-amplitude random offset that cut to zero the frame it ended, AND the HUD text (swing meter, phase text, tier chips, banners, respawn bar) was drawn inside the same `ctx.translate` — during active play (a hit every couple of seconds) the HUD was almost always jangled. Fix: `shakeOffsetPx(nowMs, shakeStartMs, shakeUntilMs, ampPx)` decays the amplitude linearly to exactly (0, 0) at the end of the shake (no snap), and `render()` now draws the world (node, particles, pieces, drops, pickaxe, floaters) inside the shake transform and the HUD after the `restore()`, outside it — the HUD never moves. The node/avatar may shake; the HUD must not. Tests: pure helper (exact (0, 0) at/after the end, full amplitude at the start, half at the midpoint) + a render test with a transform-tracking stub context (a hit shakes the world, the offset is exactly (0, 0) well after the hit, the phase headline draws at its nominal position on every frame, even mid-shake). The render test caught a real latent bug: `drawNode` did `ctx.save()` with no matching `restore()` — invisible while everything lived inside one outer save/restore, but it leaked the shake offset into the HUD once the HUD moved outside the transform. `drawNode` now restores. `SWING.shakeMs` (150) / `shakePx` (5) and `xpPerHit` (10) are still dead config (v3 uses `BREAK.shakeMs` / `breakShakePx`, tiers supply XP) — left in place, flagged here, not silently cleaned while changing shake behaviour.

**Head: bigger and lower, sitting on the neck (`render/avatar.ts`: `headGeometry`, `AVATAR`).** `headRadiusTorsoFrac` 0.17 → 0.24 (head diameter ~0.48 torso lengths vs ~0.73-torso shoulders — a big cartoon head, still narrower than the shoulders). The centre is no longer the ear line: `headGeometry` puts it `headCentreAboveNeckHeadFrac` (0.55) head-radii above the shoulder (neck) line, so the chin overlaps the torso top and the head sits ON the neck with no gap, whatever the ear-to-shoulder distance of the framing (v3 centred on the ears, which left the chin ~25 px above the neck on the sim body). The face is drawn relative to the head centre, not the nose landmark — the nose rides ~0.3 torso lengths above the shoulders, so nose-anchored eyes would sit at the top rim of the bigger, lower head; `nose.x` still centres the face horizontally. The hard hat scales with the head (`drawHardHat` takes `headR`), so it grows with it. Tests: radius 0.24, centre lower than the ear line, chin overlaps the neck line (bottom below the shoulder line by less than a full radius), head top above the ears.

**Two pause kinds (`main.ts`: `PauseController`, `HubOverlay`, `registerHubOverlay`).** The old `pausedByGate` boolean is a real state machine, `PauseKind = 'none' | 'manual' | 'auto'`, pure and unit-tested (`src/pause.test.ts` — separate file from `main.test.ts` on purpose: a static import of `./main` there would load the module before that file's stub-DOM `beforeAll` runs and the fullscreen wiring tests would never boot; importing `main.ts` in node does not boot the hub, the top-level `main()` call is guarded on `document` existing). Transition table (also in the `PauseController` doc comment):

| from | event | to | side effect |
|------|-------|----|-------------|
| none | toggleManual (Space / Pause button) | manual | `onManualPause`: game pauses, hub opens, button reads ▶ Play |
| manual | toggleManual | none | `onManualResume`: hub closes, game resumes, button reads ⏸ Pause |
| auto | toggleManual | manual | CONVERTS to manual: the press is honoured (a dead button would be worse), the game stays paused, the hub opens; stepping back into frame no longer resumes |
| none | gateClosed (body left frame) | auto | `onAutoPause`: game pauses, NO hub |
| manual | gateClosed | manual | nothing — the gate must not touch a manual pause |
| auto | gateClosed | auto | nothing |
| auto | gateOpened (body back) | none | `onAutoResume`: game resumes |
| manual | gateOpened | manual | nothing — coming back into frame must NOT resume a manual pause |
| any | reset (restart / quit / new game) | none | the matching resume event (manual → `onManualResume`, auto → `onAutoResume`) |

The game `pause()` / `resume()` contract is unchanged. The Pause button label: '⏸ Pause' while playing or auto-paused (pressing it during auto converts to manual), '▶ Play' while manually paused. A manual pause before the game's first start defers `start()` until resume (otherwise `start()` would un-pause the game out from under the hub). Overlay text: manual shows "Paused — press Space to resume" (canvas fallback until a hub registers — see below); auto shows "Step back into frame" on the canvas overlay and the DOM indicator (model failures keep the gate's own message). The debug HUD names the kind (`pause MANUAL — Space to resume (hub open)` / `pause AUTO — step back into frame to resume`); `drawHud` runs after the game's `ctx.restore()`, so the debug HUD never inherits the shake transform.

**Hub wiring point for the coordinator (Worker B's `src/hub/townHub.ts`).** `main.ts` exports `registerHubOverlay(hub: HubOverlay | null)`; `HubOverlay` is just `{ open(): void; close(): void }`. `main.ts` never imports the hub, so there is no import cycle — the hub module imports `registerHubOverlay` and calls it. `PauseController`'s `onManualPause` / `onManualResume` call `hubOverlay?.open()` / `.close()`; the canvas "Paused — press Space to resume" fallback draws only while `hubOverlay === null` and stands down the moment one registers. Note the shape mismatch to adapt at integration: B's `TownHub` exposes `open()` / `close()` (so it satisfies `HubOverlay`) but ALSO needs `render(ctx, nowMs)` called while manually paused, `handlePointer(x, y)` / `handleKey(key)` forwarded, and construction with `{ onResume, onOpenRefiner, onReset }` — `onResume` must call the pause toggle (resume), and the coordinator must instantiate it in `main.ts` and register it. Auto pause never opens the hub.

**Space → pause / W → jump rebind (`main.ts`, `mouseSource.ts`).** Spacebar was the mouse-sim jump key; it is now the pause toggle everywhere (all games, all sources — Space with a game active toggles manual pause; `event.repeat` is filtered so holding Space cannot toggle repeatedly; `preventDefault` stops page scroll). Mouse-sim jump moves to `W` (hold); `S` (duck) stays. The real-camera body jump is unaffected (landmarks, not the key). `mouseSource.ts` itself only gets the doc-comment update — the key mapping lives in `main.ts`.

**Still unverified (needs a real device / Brandon).** Real-body feel of the new head size (is 0.24 too big on a real frame? does the face sit right under the hard hat?), shake settling on a real screen, whether "Step back into frame" reads better than the old gate message, Space-as-pause feel during real play (including the auto→manual conversion).

## Swing Lab v3.1b — town hub, refiner, Bix sell, local save (Worker B, Nov 4, 2026)

**Town hub (`src/hub/townHub.ts`).** Manual-pause overlay; Worker A owns the pause state machine, this module owns the overlay. Interface (coordinator wiring into `main.ts`): `new TownHub({ onResume, onOpenRefiner, onReset })`; `open()` / `close()` / `isOpen` / `render(ctx, nowMs)` / `handlePointer(x, y)` (canvas-space tap, true when a button was hit) / `handleKey(key)` (Space/Escape closes + `onResume`) / `snapshot()` / `currentScreen`. Shows inventory with real item images + Credits, mines (Galvanite locked until Mining 5), Refiner + Bix's Shop spots, "coming soon" stubs for combat etc. (not built, not tappable). Reset is two-tap (arm, then confirm) and clears the save via the inventory store, then fires `onReset`. Bix sell helpers are pure and exported for tests: `bixSellPrice(id)`, `sellOne(store, id)`, `sellAll(store, id)`, `sellItems(store, id, qty)`.

**Refiner (`src/games/refiner/`: `recipes.ts`, `refinerMachine.ts`, `refiner.ts`).** Recipes follow the `tiers.ts` table pattern. Machine is pure: `RefinerMachine(stock)` with a `RefinerStock` adapter (`owned/take/give` — the game passes the inventory store, tests pass a Map fake); `selectRecipe`, `backToPicker`, `leave`, `pileVisible()`, `snapshot()`, `update(handInput, pileZone, hopperZone, nowMs)` returning at most one event (`grabbed` / `dropped` / `press` / `batch-complete`). Phases: `pick` → `carrying` → `pressing` → `done` (transient, back to `carrying`). Geometry helpers `pileZoneForStage` / `hopperZoneForStage` / `pointInZone` are exported from `refiner.ts`. The game awards Refining XP on `batch-complete` (the machine pays the output, the game pays the XP — keep that split). Leaving mid-batch ABANDONS it: carried + hopper ore returns to inventory (documented choice; simplest honest rule, nothing lost to a pause).

**Pedestal-press detector (`src/core/pressDetector.ts`, `PRESS`, v3.4, resized v3.5).** Replaces the star jumps (deleted): pure `pressButtonZones(hipMidX, hipMidY, torsoLength)` — v3.5 centres at hip-mid ±0.55 torso, top at hip + 0.02 torso, 0.25 wide × 0.2 tall (v3.4 was ±0.8, top hip − 0.15, 0.5 × 0.4 — giant slabs at the far corners, hands nowhere near them) — plus stateful `PressDetector` (one event per hold: both wrists in zones + downward motion at some point in the hold + 300 ms hold; re-arms when a wrist leaves its zone, 500 ms minimum interval). `progress(...)` is the mean of (left in, right in, hold / 300 ms). Rationale: the Nov 4 playtest proved the jump unplayable for Brandon (too tall for his room — a textbook star shape counted 0/3); the press needs arms only, no vertical space, no legs, hands stay separated (dodges the handedness-latch flip). The game feeds it only while phase is `'pressing'` AND the pedestals are fully up (slide-in 400 ms). `BodyState` needs no new field — hip-mid is `torsoX`/`torsoY`, wrists are already there. The v3.5 numbers are anchored to a measurement: the sim's hanging wrists rest at hip-mid ±0.567 torso, hip + 0.048 torso, so the resting wrist sits ~0.005 off the zone centre with a 0.1-torso push fitting inside the zone.

**Save + inventory (`src/core/save.ts`, `src/core/inventory.ts`, `SAVE`).** Key `activersespace-save-v1`, version 1. `parseSave` validates and normalises (wrong version / corrupt / wrong shape → fresh save; unknown item ids dropped; negatives/fractions clamped). Storage is injected (`StorageLike`) so tests use a fake; every read/write is try/caught (private mode degrades to in-memory). `InventoryStore` + singleton `inventory`; `new InventoryStore(fakeStorage)` for tests. XP/level helpers `skillLevel` / `xpIntoLevel` live in `inventory.ts` (100 XP/level, start at 1).

**Bix prices (`BIX`).** ACTIVE-GAME-ONLY, NOT RuneSpace canon: Ferrite Shale 2, Galvanite 4, Refined Ferrite 6, Galvanic Stock 10 Credits. RuneSpace Bix figures (Power Cells 12 / buy-back 4, gems 8/18/35) are brief-supplied flavor, not repo-verified — they live in shop/dialogue content, not `balance.ts`.

**Open questions (not built).** Failure → Slag in the active refiner (RuneSpace: Refined Ferrite failure → 1 Slag + 3 XP; Galvanic Stock failure → 2 Slag + 5 XP) — always-succeeds for now, needs Brandon's call. Galvaferrite (Refining 8, 35 XP) needs two-input recipe support. (Done in integration, Nov 4: the sim leg-spread input and the Swing Lab → inventory wiring — see "Swing Lab v3.1 — integration" below.)

**Mouse-sim mappings.** Pile grab: `A`+`D` clasp, pointer over the pile, hold 200 ms; carry: move pointer (midline follows) to the hopper. Press: `P` (hold) — both wrists animate onto the pedestal buttons (hip-mid ±0.8 torso, hip line) and push down to hip line + 0.12 torso while held; release returns them to rest. The full batch is sim-playable, proven by a test (grab ×2, drop ×2, 3 P presses → +1 refined, +15 XP). `W` jump stays as a general sim capability, no longer the refiner's input. `F` was considered and rejected: it is the fullscreen toggle.

**Still unverified (needs a real device / Brandon).** Real-body grab/carry feel (is 200 ms dwell right? does the pile/hopper placement match where hands actually rest?), pedestal-press detection on a live body (are the buttons at a comfortable height for Brandon? does the press read on a real camera?), hub readability on a phone screen (two-column layout at 960×540), refined art under the Pages subpath.

## Swing Lab v3.1 — integration (coordinator, Nov 4, 2026)

Wires Worker A's pause machine + Worker B's hub/refiner/save into `main.ts`, plus the two gaps B handed over (Swing Lab → inventory wiring, sim leg-spread input). Verified: 358/358 tests (two full runs, no flake), typecheck + lint clean, build OK, zero absolute path refs in the bundle, all 5 art files in `dist/item-art/`.

**Hub wiring (`main.ts`).** `main.ts` instantiates `TownHub` and registers it through A's `registerHubOverlay` plug (no import cycle — the hub imports nothing from `main.ts`). The pause machine's `onManualPause`/`onManualResume` open/close it; the canvas "Paused — press Space to resume" fallback stands down once it registers. `main.ts` also calls `townHub.render(ctx, nowMs)` while it is open, forwards canvas taps to `townHub.handlePointer` (swallowing them so they never steer the sim body), and forwards Space/Escape to `townHub.handleKey` BEFORE the pause toggle — otherwise one Space press would toggle twice and land straight back in a manual pause. The hub's `onResume` calls the pause toggle; `onOpenRefiner` switches games; `onReset` runs `handleSaveReset` (below).

**Game swap (`main.ts`: `openRefiner` / `handleLeaveRefiner`).** Swing Lab is SUSPENDED, not stopped, while the player refines — stopping it would reset its node and session, and the hub is a pause, not a quit. `openRefiner`: stash Swing Lab in `suspendedGame` (paused), construct a fresh `RefinerGame`, set its `onLeaveToHub`, make it the active game, leave the manual pause (so the resume event lands on the refiner, not on Swing Lab), `pendingStart = true` so the refiner starts on the next update like any game. If the refiner is already active (paused via Space, hub open on top), opening it again just resumes it. `handleLeaveRefiner` (the refiner abandons the batch first, then fires): stop the refiner, restore the suspended game, toggle back into a manual pause so the hub reopens. `stopGame` (quit/restart path) stops a suspended game too, or its canvas listener would keep firing on a dead game. The refiner has NO hub card (not in `GAMES`) — it is registered in `GAME_CONSTRUCTORS` only, entered from the hub.

**Save reset (`handleSaveReset`).** An active refiner is dropped first (its hopper/carried ore no longer exists after the reset) and the suspended game restored; then the Swing Lab display is restarted so it re-reads the now-empty store, and kept paused — the player is still sitting in the hub.

**Swing Lab → inventory (`swingLab.ts`).** Every counted hit calls `inventory.add(tier.id, orePerHit)` + `inventory.addXp('mining', xpPerHit)`; `reset()` (called by `start()` and `restart()`) reads ore/XP back from the store; switching mines re-reads the new tier's owned count. Restart is NOT Reset-save: it resets the session (swings, node, machine) but keeps owned ore/XP — two tests were updated to the new semantics ('restart resets the session but keeps owned ore/XP'; the Mining 5 test now expects the level to stay 5 after a restart). `MiningTier.id` narrowed from `string` to `SaveItemId` so a tier's ore goes straight into the store with no cast — a new tier must first be a known save item id. `swingLab.test.ts` resets the singleton in a file-level `beforeEach` (a hit in one test would otherwise leak into the next test's `start()`). Credits show in the HUD for both games (Swing Lab's `hudHtml` gained the Credits span; the refiner already had one).

**Pointer guards.** Both games' canvas pointer handlers return early while `paused`: a tap on a hub button must not also hit a mine-selector chip or the refiner's leave chip underneath the overlay. `main.ts` swallowing the tap is not enough on its own — the games' listeners are separate listeners on the same canvas and would still fire.

**Sim press (`mouseSource.ts`, v3.4, retargeted v3.5).** `P` (hold) drives `pressT` 0 → 1 over 240 ms: first half the wrists travel out to the buttons at the zone top (`PRESS.buttonZoneTopOffsetTorsoFrac`), second half they push down to hip + `PRESS.pressDepthTorsoFrac` (0.12 torso) — the push runs at ~1 torso length/s, a deliberate downward move the detector reads. Wired in `main.ts` (`P` down/up → `mouse.setPressing`). `X` (legs wide) deleted with the star jumps. Tests: `mouseSource.test.ts` asserts the pressed wrist positions (±0.55 torso, hip + 0.12 torso), the downward travel (not a teleport), and the return to rest on release; `refiner.test.ts` proves the full batch in the sim. v3.5 fix: the sim hard-coded the button offset (±0.8) and depth as file-local constants, independent of `PRESS` — after the v3.5 zone shrink the sim pressed thin air outside the zones and the batch could never complete. The sim now reads offset, zone top, and depth from `PRESS` (single source — sim targets and detector zones can never drift again). Sim artifact, documented in the test: the sim's hanging wrists rest just inside the button zones (0.330 vs the 0.335 centre, 0.564 vs the 0.556 zone top), so between presses the test clasps `A`+`D` to pull the hands to the centre and re-arm the detector — a real player's hanging hands sit just inside the zones too, so real play re-arms by lifting the hands a little.

**Swap test (`src/main.test.ts`).** The stub-DOM harness now drives the real loop: a stubbed `requestAnimationFrame` advanced by hand, the stub ctx proxy returning the canvas element itself for `ctx.canvas` and `{ width: 0 }` for `measureText` (both are read by the render path — a bare no-op proxy throws). One test runs the whole flow end to end: sim source → Swing Lab → Space (manual pause, hub opens) → tap the Refiner button → refiner HUD → tap Leave to town → Swing Lab HUD + manual pause again. It caught nothing new on the first pass — the wiring was right — but it is the only test that exercises the swap, so it stays.

**Still unverified (needs a real device / Brandon).** Real-body grab/carry feel (200 ms dwell, pile/hopper placement vs real hand-rest height), pedestal-press detection on a live body (button height, press readability on a real camera), the hub's readability on a phone screen, refined art under the Pages subpath, the hub → refiner → hub flow on a real browser (the swap test drives it in node only), and whether the auto→manual conversion feels right when Space is pressed during an auto-pause.

## Swing Lab v3.2 — eyes, town as a place, picker, layering, layout, per-activity gate (coordinator, Nov 4, 2026)

Built from Brandon's v3.1 playtest (71 s laptop video, frames t4–t70 in `docs/playtest-nov4/` — left uncommitted). Two workers in parallel, strict file ownership, coordinator integrated + wired `main.ts`. Verified: 344/344 tests (two full runs, no flake), typecheck + lint clean, build OK, zero absolute path refs in the bundle, all 5 art files in `dist/item-art/`.

**Eyes (Worker A, `src/render/avatar.ts`).** v3.1 drew eyes, then painted the hard-hat dome over them. Hat is now drawn first, face after; eyes at `cy + 0.32r`, `±0.36r`, radius `0.15r` (was `0.09r`); smile below at `cy + 0.55r`. Geometry exported as `hardHatGeometry()` / `faceGeometry()`; draw-order test records canvas calls.

**Town is a place (Worker A, `src/hub/townHub.ts`, `src/main.ts`).** The hub was a dimmed overlay (`rgba(8, 8, 14, 0.82)`); now it is a full-screen opaque screen (solid `#0d0d18` + drawn night sky: seeded stars, moon, rooftop skyline) and the render loop draws NO game/avatar/gate/debug HUD behind it. "Pause" → **🏠 Town**; Space in town returns to the last activity; Space in play goes to town; Space in auto-pause converts to town; Escape in play does nothing. Auto-pause never opens town. Leaving town means picking Mine / Refiner / Bix (Mine spot is new). Internal kind name `manual` kept; only player-facing words changed. No-hub fallback ("Paused — press Space to resume") untouched — it only draws when no hub is registered.

**Recipe picker — opaque cards (Worker B, `src/games/refiner/refiner.ts`).** 640×96 solid cards, two-tap select-then-start, last recipe pre-selected, locked cards print their reason. Pure `pickerCardLayout()` for tests.

**One instruction surface (Worker B).** Instruction lives in the HUD only; canvas keeps the y=58 phase banner. Announcements replace the banner in the same zone; presses in the HUD only (`🔨 n/3`); respawn bar to bottom-left (`respawnBarRect`); floaters right of the node with a dark pill + gold border; swing meter moved down (top 140, height 300), `⬆ UP` label removed.

**Gate banner (Worker B, `src/render/renderer.ts`, `src/core/gate.ts`).** Lost body during an activity = small opaque top banner (`drawGateBanner`, y=6, h=34); model problems keep the full overlay; empty stage keeps the ghost. `shouldShowGateBanner({reason, activityScreenUp})`.

**Per-activity gate (Worker B, the sixth fix).** `GATE_ACTIVITIES`: `swing` = knees + 500 ms grace (unchanged); `refiner-carry` / `refiner-press` = shoulders + hips, 1500 ms grace; `picker` = null (no gate at all). Stale-frame rule (2000 ms) untouched. Messages name the missing landmarks. Gap, documented: `BodyState` carries shoulders/hips/knees visibility only — wrists enforced by grab logic and the press detector; literal wrist/ankle gate enforcement would need those fields added to `LandmarkVisibility` in `bodyState.ts`. Pile/hopper pulled inward (Brandon's idea): centres 0.30w / 0.70w (was 0.16/0.84), y 0.44h unchanged.

**SUPERSEDED in v3.7 (Nov 5, 2026) — see "RuneSweat v3.7" below:** knees dropped from the gate everywhere, swing included; `requireKnees` deleted.

**Layout (Worker B, `src/styles.css`).** Stage reserve 300px → 440px (380px fullscreen); HUD 1.15rem; buttons 1rem; `overflow-x: hidden` safety net; tagline hides under 1000px viewport height. Fit test computes from the actual CSS + `index.html` at 1728×1080, 1728×980, 1280×800, 1024×768.

**Integration (`src/main.ts`, coordinator).** Applied Worker B's wiring verbatim after verifying every anchor against Worker A's edited `main.ts`: imports (`GATE` out; `gateRequirementsFor`, `shouldShowGateBanner`, `GateActivity`, `drawGateBanner` in), `gateActivity()` before `modelState()`, `gateOptions` takes `requirements: gateRequirementsFor(gateActivity())`, overlay block branches to `drawGateBanner` when `shouldShowGateBanner` says so, DOM indicator hidden while picking. Also applied Worker A's two `index.html` string changes (button → 🏠 Town, legend → "go to town / back to the activity").

**Still unverified (needs a real device / Brandon).** Eye readability at phone size; town readability on a phone screen; whether 1500 ms grace + no-knees + inward zones stop the gate firing during real refining reaches; pile/hopper feel at 0.30w/0.70w; layout on his actual window (if it still scrolls, the next datum is his actual CSS viewport size, not another formula tweak); the integrated gate/banner path on a real browser (only node tests cover it so far).

## Swing Lab v3.3 — avatar polish, banner fix, hub buttons (coordinator, Nov 4, 2026)

Built from Brandon's v3.2 playtest screenshots (camera on, leaning close; town hub). Three workers in parallel, strict file ownership; coordinator integrated + wired `main.ts` hover/press forwarding. Verified: 363/363 tests, typecheck + lint clean, build OK, zero absolute path refs in the bundle, all 5 art files in `dist/item-art/`.

**Avatar torso + boxers (Worker A, `src/render/avatar.ts`).** The v3.2 torso top edge was horizontal at the average shoulder Y — leaning put one shoulder above the slab and the other below it while the arms sprouted from the real landmarks. Now the top edge runs shoulder-to-shoulder (tilted, following the body) and the waist follows the hip line, tapered to 0.82× hip half-width. Tank shape: scoop cut INTO the top edge (0.09× torso deep, bottoms ~3 px above the chin), armholes (side control points 0.08× shoulder width inward), straps as short thin strips ON the shoulder line (0.18× shoulder width long, 0.035× torso wide — half the old width that read as white lines), never crossing the chest centre. Boxers are two cuffs, one per thigh: pentagon following hip→knee, bottom edge 0.55 down the thigh, shared crotch point 0.10 torso below the hip line (V notch, not a straight edge); two hearts per cuff on the thigh axis. Draw order changed so both legs draw BEFORE the bottoms (far arm, far leg, torso, near leg, bottoms, near arm, head) — the old order painted a skin stripe down the near cuff. Pure helpers `torsoGeometry()` / `bottomsGeometry()` exported for tests. Head/face untouched — the v3.2 eyes fix stays as proven.

**Gate banner (Worker B, `src/render/renderer.ts`).** `drawGateBanner` measured the text BEFORE setting the 20px bold font, so the pill was sized for the wrong font and the message clipped ("I can't see your knees — ste"). Font is now set first, then measured. Audit: no other measure-before-font instances in the codebase. Rule: **set the font before you measure**.

**Hub buttons (Worker C, `src/hub/townHub.ts`, `src/main.ts`).** Flat muddy-brown rectangles are gone. Shared `paintButton`: opaque vertical gradient + 4px darker lip + rounded corners (radius 12) + drop shadow. Primary (Mine / Refiner / Bix) big gold `#ffcf5c → #dd9a1d`; secondary (Back, Sell 1) muted slate; destructive (Reset save) small, red-tinted, armed label "⚠️ Tap again to confirm". Hover brightens, pressed sinks 2px with the shadow removed. `main.ts` forwards `pointermove` / `pointerdown` / `pointerup` to the hub while it is open; a tap is down + up, and down alone never activates (integration test proves it). The refiner Leave chip uses the same painter (secondary, static — no pointermove path in the refiner). Lumberjack removed from `COMING_SOON` (not a RuneSweat skill — Brandon's standing decision; Combat stays). Skyline windows never intersect the bottom button rects (`skylineLayout` + `bottomButtonRects` as single source of truth).

**Still unverified (needs a real device / Brandon).** The avatar on a real leaning body at phone size; the buttons on a real screen at phone size (the armed Reset label is sized by estimate); the banner's exact pill width against the real Baloo 2 font; narrow-portrait layout (~390px: Back + Reset would overlap — pre-existing, not changed here).

## RuneSweat v3.4 — pedestal press replaces the star jumps, version display, Lumberjack out of the registry (coordinator, Nov 4, 2026)

Two workers in parallel (Worker A: detector/machine/config/gate; Worker B: game/sim/wiring/docs), strict file ownership, plus two additions from Brandon folded into the same slice. Verified: typecheck + full suite + build (counts in the final report).

**Pedestal press (Worker A: `src/core/pressDetector.ts`, `PRESS`, machine, `GATE_ACTIVITIES`; Worker B: `src/games/refiner/refiner.ts`, sim, wiring).** Why: the Nov 4 playtest proved the jump unplayable for Brandon (too tall for his room — a textbook star shape counted 0/3, and hands meeting overhead kept tripping the handedness-latch flip). The press needs arms only. Detector: `pressButtonZones` (centres hip-mid ±0.8 torso, top hip − 0.15 torso, 0.5 × 0.4 torso) + `PressDetector` (both wrists in zones + downward motion at some point in the hold + 300 ms hold; re-arm on leaving a zone, 500 ms min interval); `progress(...)` = mean of (left in, right in, hold / 300 ms). Machine: phase `'pressing'`, snapshot `pressesDone`, event `'press'` (`Press n/3!`), input `press: boolean`, hint `Hopper full! Press both buttons down — 3 presses to forge the bar!`. Config: `REFINER.pressesPerBatch = 3`, `PRESS` (holdMs 300, minIntervalMs 500, offsets 0.8 / 0.5 / 0.4 / −0.15, slideMs 400, pressDepthTorsoFrac 0.12), `GATE_ACTIVITIES` `'refiner-press'` (same values as the old `'refiner-jump'`). Game: detector runs only in `'pressing'` with pedestals fully up; pedestals slide in over 400 ms on entering the phase, out on batch-complete / leave (`pedestalSlideT` in the snapshot, 0..1); buttons sink with the hold (`pressProgress` 2/3 → 1); the forging bar in the hopper squashes one step per press; HUD `🔨 n/3`; draw order pile/hopper → pedestals → Leave chip. Hip-mid is `BodyState.torsoX`/`torsoY` — the brief claimed per-hip fields (`leftHipX` etc.), which do not exist; no `BodyState` change was needed. `src/core/starJump.ts` + `STAR_JUMP` deleted; `SIM.legsWideAnkleSpreadTorsoFrac` is dead config now (Worker A owns config — left in place, flagged here).

**Sim press (Worker B, `src/sim/mouseSource.ts`, `src/main.ts`).** `P` (hold) → `setPressing`: `pressT` 0 → 1 over 240 ms, first half wrists travel out to the buttons at the hip line, second half push down to hip + 0.12 torso (~1 torso/s, a real downward move). `X`/`setLegsWide` deleted. `F` was considered and rejected: it is the fullscreen toggle (`main.test.ts` proves it). `W` jump stays as a general sim capability. Full batch sim-playable, proven by a test in `refiner.test.ts` (grab ×2, drop ×2, 3 P presses → +1 refined, +15 XP) and by a wiring test in `main.test.ts` (DOM taps + keys + pointer moves through the real loop: `🔨 1/3`, `🔨 2/3`, then `+1 refined-ferrite`). Sim artifact: the sim's hanging wrists rest just inside the button zones (0.330 vs the 0.335 edge), so between presses the tests clasp `A`+`D` to pull the hands to the centre and re-arm the detector — a real player's hanging hands sit well inside the zones' inner edge (~0.4 vs 0.55 torso).

**Version display (Brandon's ask).** Single source: `package.json` `version` (`3.4.0`), read directly by `src/core/version.ts` — no mirror constant. Shown on the select screen (`#app-version`, set by `main.ts` at boot) and in the Town Hub (canvas, top-left `(12, 12)`, both screens). Tests: `version.test.ts` (semver, matches `package.json`), `main.test.ts` (select-screen text matches the source), `townHub.test.ts` (hub draws the label at top-left). Release process: bump the version in `package.json`, build, deploy. Display only, no update-check machinery. Pages serves HTML with `Cache-Control: max-age=600`, so a stale page can linger ~10 minutes after a deploy — the version is how you tell.

**Lumberjack out of the registry.** v3.3 removed it from the hub's `COMING_SOON`, but `config.ts` still had the disabled registry entry and `main.ts` renders every entry as a game card — so the select screen still showed a Lumberjack "Coming soon" card. Entry + blurb removed; the select screen now shows one card (Swing Lab); the swap test's card count went 2 → 1. Vision doc (`docs/vision-lumberjack.md`) untouched.

**Still unverified (needs a real device / Brandon).** Real-body press feel (button height, press readability on a real camera); the pedestal buttons overlapping the pile/hopper edges on screen; the version label on the hub at phone size; Pages cache behaviour after a deploy (does the version change on refresh within ~10 minutes?).

## RuneSweat v3.5 — pedestals close to the body, fist-sized buttons (coordinator, Nov 5, 2026)

Two workers in parallel, strict file ownership, coordinator integrated. Worker A: zones + config (`src/core/config.ts` PRESS constants only, `src/core/pressDetector.ts` zone math + docs, `pressDetector.test.ts`). Worker B: rendering + sim (`src/games/refiner/refiner.ts`, `refiner.test.ts`). Interface: `pressButtonZones(hipMidX, hipMidY, torsoLength)` stays the single source of truth; Worker A owns its numbers, Worker B renders from it unchanged; config key names unchanged.

**Why.** Brandon's v3.4 playtest verdict: "yeah its bad lol. i was thinking the pedestals would pop up closer to my body so i can reach em, way smaller buttons, etc." Parent-verified from frames: two giant gold slabs at the far bottom corners (~1/4 stage width each), below and far out from the avatar; hands hung at his sides nowhere near them; slabs covered the Leave chip's top edge and the hopper label's bottom; no distinct button; the drawn slabs were bigger than the detection zones.

**Worker A — zones.** `buttonOffsetTorsoFrac` 0.8 → **0.55**, `buttonZoneWTorsoFrac` 0.5 → **0.25**, `buttonZoneHTorsoFrac` 0.4 → **0.2**, `buttonZoneTopOffsetTorsoFrac` −0.15 → **+0.02**; hold/minInterval/slide/pressDepth unchanged. Anchored to a measured sim resting wrist (`mouseSource.ts` hangs arms at ±π·0.94, arm length 0.32, shoulders 0.39/0.61 at 0.25, hip-mid 0.5/0.55, torso 0.3 → resting wrists 0.330/0.670, 0.564 = hip-mid ±0.567 torso, hip + 0.048 torso). New zones for that stance: centres 0.335/0.665, x 0.2975–0.3725, y 0.556–0.616. Detector tests 17/17 (was 13; 4 new). Stash incident (owned): a `git stash` swept up Worker B's in-progress `refiner.ts`; recovered by restoring only Worker A's three files from the stash, backing the superseded stashed `refiner.ts` to `/tmp/workerB-refiner-v3.5-stash-backup.ts`, then dropping the stash; Worker B's working-tree files verified untouched. Worker A's three files were left staged (artifact of the restore) and committed as-is by the coordinator.

**Worker B — render.** New pure helper `pedestalRectsForStage()` renders from `pressButtonZones()` unchanged (same helper, one source, mirrored via `toCanvas`); no hard-coded zone numbers in the render path. At 960×540 each pad is 72 × 32.4 px (was 144 × 64.8). Slim post: 65% of pad width (46.8 px), centred under the pad, running to the stage bottom; post top stays at the pad's rest bottom so the sinking pad overlaps it and reads as pressed into it. Pad reads as a button at small size: gold pad + dark edge + lighter-gold face strip (`PEDESTAL_STYLE.buttonTop`, `#ffe08a`, 2–4 px). Sink still driven by `pressProgress` toward full `pressDepthTorsoFrac`, capped at half the pad's own height (uncapped, 19.4 px of sink would swallow a 32.4 px pad; cap applies 16.2 px). Labels moved above the zones (`LABEL_ABOVE_PX = 16`): the full-height posts run to the stage bottom, so a label below the pile/hopper would sit across a post — the v3.4 bug. `drawPile`/`drawHopper` use the same strings/positions as the new `pileLabelRect`/`hopperLabelRect` helpers (one source). Everything else unchanged: slide-in/out over `PRESS.slideMs`, forging bar squash per press, 🔨 n/3 counter, mid-batch leave rule, gate requirements. Overlap margins (960×540, hip 0.5/0.55, torso 0.3, worst-case pile label): button↔torso 16.8 px, post↔torso 29.4 px, pile-label bottom↔button top 63.6 px, Leave chip↔left post 66.2 px — no intersections, proven by a test. Process note (Worker B): two parallel edits to `refiner.ts` were silently lost; re-applied singly and re-verified against the final on-disk file.

**Coordinator — sim retarget + version.** Worker B reported 3 failures with one root cause: the pre-existing `sim full batch` test, its new P-key tripwire test, and `main.test.ts`'s sim-batch test — the sim's P animation hard-coded `PRESS_BUTTON_OFFSET_TORSO_FRAC = 0.8` in `mouseSource.ts`, so P-held wrists landed at ±0.8 while the new zones sit at ±0.55. Fixed in `mouseSource.ts` (and `mouseSource.test.ts`): offset, zone top, and depth now read from `PRESS`; first-half animation target moved from the hip line to the zone top (`hipY + PRESS.buttonZoneTopOffsetTorsoFrac * SIM.torsoLength`); the two file-local constants deleted; the "return to rest" test now asserts wrist Y below the pressed depth, since the X check alone can no longer tell rest (±0.567) from pressed (±0.55). `package.json` version bumped 3.4.0 → **3.5.0** (single-line diff — the first Python rewrite reformatted the file, restored and redone with sed). README + PLAN updated: new pedestal/button geometry and why, the zone/render invariant, the sim-single-source lesson, what is still untested on a real device.

**Verified.** 388/388 tests (was 379; 9 net new: 4 detector, 5 refiner/sim), typecheck + lint clean, build OK, zero absolute path refs in the bundle, all 5 art files in `dist/item-art/`, bundle `index-CfzTQgVG.js` contains `3.5.0`, `#app-version` in `dist/index.html`. Committed locally on main; NOT pushed — parent verifies, pushes, deploys.

**Still unverified (needs a real device / Brandon).** Real-body press feel at the new size/height; whether the buttons sit at Brandon's actual resting hand height (numbers anchored to the sim's hanging wrists, not a measured real body); re-arm between presses on a real body (hanging wrists rest just inside the zones — presses 2 and 3 need a small lift, confirm it isn't an exaggerated one); pedestals on a real camera frame (button↔torso margin only 16.8 px on the sim body — a broader-shouldered real body could touch it; any fix there is Worker A's offset, not the render); the version label at phone size.

## RuneSweat v3.6 — hand circles + higher, taller press pads (Worker A, Nov 5, 2026)

**Why.** Brandon's v3.5 playtest video: pads at knee height at the very bottom of the stage, hands at hip/thigh height, counter 0/3 the whole video; and no on-screen marker for where the game thinks his hands are (arm tips off ~50–100 px), so aiming was guesswork.

**Worker A — hand circles (`src/render/avatar.ts`, `avatar.test.ts`).** `handCircleGeometry(joints)` (pure, exported) returns `{ left: { centre, r }, right: { centre, r } }` — centre is exactly the wrist joint (pass the SMOOTHED joints, what `draw()` draws from), radius `handCircleRadiusPx(torsoLengthPx)` = `HAND_CIRCLE_RADIUS_TORSO_FRAC` 0.125 × torso (0.25 across = press-pad width, fist-sized). `forearmEndPoint(elbow, wrist, handR)` (pure, exported) pulls the forearm end 0.5 hand-radii back along the forearm so the round cap ends ~0.01 torso past the wrist, inside the circle. `drawArm` draws upper-arm capsule, shortened forearm capsule, then `drawHandCircle` (skin fill, `#7a5230` outline via `HAND_CIRCLE_OUTLINE`, lineWidth max(2, r × 0.12)) — circles after/over the capsules, both hands, wherever the avatar is drawn. Interface for Worker B: ring the left circle from `handCircleGeometry` — same centre + radius the render draws, so the highlight cannot drift from the hand. Tests: 5 new (geometry, radius scaling, circle separation, forearm termination, draw order incl. fill-then-stroke).

**Worker A — zones (`src/core/config.ts` PRESS block only, `src/core/pressDetector.ts`, `pressDetector.test.ts`).** `buttonZoneTopOffsetTorsoFrac` +0.02 → **−0.06**, `buttonZoneHTorsoFrac` 0.2 → **0.32**; offset 0.55, width 0.25, hold/minInterval/slide/pressDepth unchanged. Anchor (sim resting wrist hip-mid ±0.567 torso, hip + 0.048 torso): rest sits 0.108 torso below the new top, push ends 0.112 torso above the new bottom; sim pressed depth (hip + 0.12) lands mid-pad. New zones for the fixture stance (hip 0.5/0.55, torso 0.3): centres 0.335/0.665, y 0.532–0.628. Detector logic untouched — `pressButtonZones` reads `PRESS`, so the change is two constants + docs. Tests: 1 new (higher + taller than v3.5), 3 updated (zone placement, bounds, rest-in-zone slack, wrists-above-buttons now uses y 0.46–0.51 since 0.54–0.55 are inside the taller zones). `refiner.ts` untouched: `pedestalRectsForStage` already derives from `pressButtonZones` (verified — the zone/render invariant and no-overlap tests pass unchanged against the new numbers). `mouseSource.ts` untouched: it already reads zone top + depth from `PRESS`; the sim-batch and P-key tripwire tests pass unchanged, so no retarget was needed this time.

**Verified.** 394/394 tests (was 388; 6 net new), typecheck + lint clean, build OK. No commit, no push, no version bump (Worker B owns it), no Notion touch.

**Still unverified (needs a real device / Brandon).** Real-body press feel at the new height/size; whether −0.06 matches his actual hanging hands (sim-anchored, not real-body-measured); circle readability/landing on a real camera frame; re-arm lift between presses now that the hanging wrists rest well inside the taller zones.

## RuneSweat v3.6 — action circle + hand pointer (Worker B, Nov 5, 2026)

**Why.** Brandon's v3.5 playtest video: the left press pad is half-hidden BEHIND the "Leave to town" chip in every frame — v3.5's "no overlap" claim was wrong on the real frame. The chip had to go. His confirmed design: one context-sensitive action circle, top-right, with a hand-pointer + dwell-to-click system.

**Worker B — the chip is gone (`src/games/refiner/refiner.ts` + `refiner.test.ts` only).** Deleted: `leaveChipRect`, `drawLeaveChip`, the `'leave'` card action in `pointerDownAt`, the `leave` field of `pickerCardLayout`, the `paintButton` import. Nothing else in the file changed: pedestal geometry untouched (Worker A's), `onLeaveToHub` / `leavePending` / `clearLeaveRequest` kept. Leaving is now public `leaveToHub(nowMs)` (the chip's private `requestLeave`, renamed and made public so the coordinator can call it from the action circle). Verified the chip existed nowhere else: Swing Lab's leave path was already Space / the Town button, the hub's Back button returns to the activity and stays. Tests: the two old chip-tap tests now call `leaveToHub` (ore returns, pedestals slide away); the v3.3 chip-style test is replaced by a chip-gone test (no "Leave to town" text drawn in picker or batch frames, no gradient at the old rect, a tap at (100, 508) does nothing, source grep for `leaveChipRect|drawLeaveChip|action: 'leave'`); the gate-banner and pedestal no-overlap tests drop their Leave assertions.

**Worker B — action button + dwell (`src/core/actionButton.ts`, `src/core/config.ts` `ACTION_BUTTON`).** Geometry: centre (width − 72, 84), radius 36 → (888, 84) at 960×540. Layout test at 960×540 against the LIVE pedestal/pile/hopper/torso/card/banner geometry (reads `pedestalRectsForStage`, so it follows A's new zones): no intersections; circle top (48) clears the gate banner bottom (40). Modes: `town` (houses + "Town") / `ok` (checkmark + "OK"), label changes with the mode, icons are drawn shapes. `ActionButtonDwell` (timestamp-driven, `PressDetector` pattern): 2 s hold, progress 0..1, fires once per hold, early leave resets to zero, disarms after firing until the hand leaves. Hitbox is the hand circle: the confirm wrist point vs the circle.

**Worker B — pointer (`src/core/pointer.ts`, `src/core/config.ts` `POINTER`).** Fixed split, config-driven: `pointerHand: 'left'`, `confirmHand: 'right'`. `PointerController` (pure + stateful): hovered selectable from the pointer point + list, first containing rect wins, null point clears. `handPoint(body, hand)` / `pointerHandPoint` / `confirmHandPoint` read `POINTER`, never a hardcoded side. Selectables: hub buttons except Reset (`townHub.selectables()`), unlocked recipe cards (`main.ts` from `pickerCardLayout` + `recipeLockReason`); the circle itself is not selectable. Highlight: hub reuses its button hover state (`setPointerHighlight` writes `hoverAction`); picker gets `drawHoverRing` from `main.ts` (refiner.ts is chip-deletion-only, so the ring lives in the coordinator, not the game). Cursor ring (`render/renderer.ts` `drawPointerCursor`): radius from A's `handCircleRadiusPx` (+6, +10 hovering) — the ring hugs A's hand circle at any body distance; centre is the BodyState smoothed wrist (same position the detectors use; A's circle centre is the avatar's own smoothed wrist — both track the same wrist).

**Worker B — wiring (`src/main.ts`) + sim (`src/sim/mouseSource.ts`).** `updatePointerSystem` every update step (even gated, so a lost body clears the hover): pointer point = mouse in the sim, smoothed left wrist on camera; confirm point = smoothed right wrist; circle visible in an activity always / in town only while hovering / hidden otherwise; dwell fire or mouse click on the circle → `fireActionButton` (synthetic tap at the highlighted thing's centre — same code as a mouse tap; town mode → `leaveToHub` for the refiner, `pause.toggleManual()` for Swing Lab). `drawPointerUI` after the game / hub render in both branches. Sim: `setPointerHand` (left wrist chases the mouse, ~120 ms; raise/clasp/press override) + `setConfirming` (right wrist to the circle, 240 ms; press wins if P and C are both held); `C` key in `main.ts` (P is the press, F is fullscreen). Legend in `index.html` documents mouse = pointer hand, `C` hold = confirm. Tests: `main.test.ts` swap test now dwells instead of tapping the chip (plus a second dwell from Swing Lab), new hands-only loop test (point + C-dwell ×2, carry ×2, P-press ×3) and mouse-circle-click test. Test-timing gotcha (owned): a dwell disarms after firing until the hand leaves, so a test that releases C and re-presses with zero frames in between never re-arms — drive frames after each release.

**Verified.** 394 baseline → 431 tests, typecheck + lint clean, build OK. Version bumped to `3.6.0` (Worker B owns the bump; sed single-token, the file is minified single-line JSON). No commit, no push, no Notion touch.

**Still unverified (needs a real device / Brandon).** Circle reach from his normal stance (layout proves clearance, not reach); 2 s dwell feel; pointer highlight + cursor ring on a real frame with A's hand circles; ring-vs-circle centre agreement (two smoothers).

## RuneSweat v3.7 — knees dropped from the gate (Worker B, Nov 5, 2026)

**Why.** Brandon's v3.6 playtest: reaching up to the top-right action circle took his knees out of frame, the gate tripped ("can't see my knees"), and the hover/dwell did nothing. His fix: knees dropped from the gate EVERYWHERE, superseding the v3.2 rule that swings keep knees. The swing only needs arms + head + chest. The fixed-node change from the same playtest is the other worker's; this section is the gate side only.

**Worker B — the gate (`src/core/config.ts` `GATE` / `GATE_ACTIVITIES`, `src/core/gate.ts`, `src/core/bodyState.ts`).** Shoulders + hips only, all activities: `swing` 500 ms grace, `refiner-carry` / `refiner-press` 1500 ms grace (both unchanged — only the knee requirement went), `picker` still `null`. `GATE.requireKnees` and `GateRequirements.requireKnees` deleted; `GateRequirements` is now just `{ gracePeriodMs }`. `BodyState.bodyUsable` (no-requirements fallback) is the same shoulders + hips rule. `kneesVisible` / knee `landmarkVisibility` stay as data (HUD, duck detection), no longer gate inputs. "I can't see your knees — step back" is gone; no-body messages name shoulders / hips only. Facing check (nose-offset veto) and the swing detector untouched. `main.ts` / `refiner.ts` / `renderer.ts`: comment + sample-text updates only. Hover/dwell needed no pointer change: `main.ts` gates the pointer/dwell points on `!currentGate.gated`, so the gate opening IS the fix — proven by a test driving the chain (knees-hidden reaching body: swing gate opens, pointer hovers, confirm wrist inside the (888, 84) r36 circle, dwell fires at 2000 ms; shoulders-hidden body stays gated, hover clears, no dwell). Tests: `gate.test.ts` v3.7 block (4 new) + v3.2 block and `bodyState.test.ts` knees tests rewritten; `renderer.test.ts` banner sample text now uses the shoulders message.

**Verified.** 431 baseline → 436 tests, typecheck + lint clean, build OK, zero absolute path refs in the bundle, all 5 art files in `dist/item-art/`, `3.7.0` in the built bundle. Version bumped to `3.7.0` (Worker B owns the bump; sed single-token, the file is minified single-line JSON).

**Still unverified (needs a real device / Brandon).** Whether shoulders + hips at 0.5 visibility is forgiving enough on his real body when he reaches up (a real reach may dip a shoulder/hip below threshold — sandbox can't tell); whether anything else still trips on knees (grep says no in `src/`, only a real playtest proves the path); the integrated gate → hover → dwell path on a real browser (node tests only); 2 s dwell feel (carried over from v3.6).

**Worker A — fixed node (same slice).** The node no longer follows the body's hips: `nodeGeometryForStage(width, height)` computes it from the stage only — centre (480, 402.3), rx 118.8, ry 91.8 at 960×540 (v3 size, unchanged), bottom edge 45.9 px above the stage bottom (`bottomGapFracOfHeight: 0.085`, so the HP pips stay on stage). The player stands behind it to smack it. Alignment hint, not a gate: hips more than 0.3 torso lengths sideways off the node centre → "Step behind the node" in the HUD instruction line; it never blocks a swing. Swing machine untouched. Verified in isolation: 431 → 436 tests (5 hip-following tests replaced by 4 fixed-node ones, +6 new), `swingLab.test.ts` 45/45.

**Worker C — both hands are the cursor in town (same slice).** On the Town Hub, where the avatar isn't drawn, both hand circles show as the cursor — L and R labels, bold, font size = circle radius, same `handCircleGeometry` (0.125 torso) as the in-game circles, always visible. L hovers/highlights, R dwells ~2 s on the action circle to confirm; pointer/dwell logic untouched. The pointer ring's centre dot is hidden on the hub only (it would sit on the "L"). Game-select screen is mouse-only by construction (DOM page, no canvas/pose source) and was left alone. Verified in isolation: 431 → 438 tests (7 net new), no existing test needed updating. Still unverified: L/R label legibility at phone size (~8 px letters at 0.4× stage scale); circles distinguishable from in-game circles on a real frame (label is the only distinguishing mark).

**Integrated (coordinator).** Three branches merged cleanly, no conflicts: `v37-node` (f95eb60), `v37-gate` (64512d5), `v37-menu` (343a431). **448/448 tests, 27 files** (431 + 5 node + 5 gate + 7 menu), typecheck + lint clean, build OK, zero absolute path refs, all 5 art files, `3.7.0` in the bundle. The three workers shared one checkout and their uncommitted changes interleaved; each verified/committed from an isolated worktree, and the merge was done in a fourth isolated worktree.
