# Lara's Pose Games — PLAN

A lightweight, modular framework for full-body camera pose games for a
5-year-old. Working name: **pose-arcade**. Single-player practice first.
No backend, no telemetry, nothing leaves the device.

## Why this exists

The Nov 3, 2026 motion-detection Bubble Pop was liked by Brandon but NOT
by Lara. Pivot (Nov 4, 2026): full-body skeleton pose — whole body, not
hand-only, not motion detection. The games must pick *her* out of the frame
and use *her* movements. Accuracy only needs to be good enough for a child
playing in a living room, not for measurement.

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
2026: finish the MediaPipe PoseLandmarker v1 first, test it with Lara on
the Pixel, and add MoveNet later as a second engine.** Staying on the same
MediaPipe stack as the Spider-Man repo keeps one dependency to learn and
33 landmarks for dance-pose matching (MoveNet's 17 points are coarser for
joint-angle scoring). MoveNet's trade-off for later: it is lighter/faster
and may sustain a higher inference rate on the Pixel, at the cost of fewer
landmarks (no hand points, coarser elbows/knees) and a second engine to
maintain. When it lands, it lands as a second `PoseFrameSource`
implementation behind a config flag, with no game-code changes — games
only ever see `BodyState`, so the engine is swappable by construction.
Revisit only after the MediaPipe v1 playtest with Lara.

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
               space-invaders/  Game 1 — shipped in v1
               dance-drop/      Game 2 — shipped in v1
               auto-runner/     STUB ONLY — design below, not built
  main.ts      hub (game select, source select, loop wiring, input)
```

**Rules:**
- Games never touch landmark indices — they read `BodyState` (Dance Drop
  excepted: it reads raw landmarks only through `poseMatchScore()`).
- `z` is never used for screen position.
- `config.ts` is the only place tunables live. Tuning after a playtest
  means editing one file.
- DRY / SSOT: pose math lives in `bodyState.ts` once; both games reuse it.
  There is no duplicated pose code between games.

## The 33 landmarks (named in `poseTypes.ts`, never raw numbers)

0 nose, 1-8 eyes/ears, 9-10 mouth, 11 left shoulder, 12 right shoulder,
13 left elbow, 14 right elbow, 15 left wrist, 16 right wrist, 17-22 hand
points, 23 left hip, 24 right hip, 25 left knee, 26 right knee, 27 left
ankle, 28 right ankle, 29-32 feet.

## Game 1 — Space Invaders (v1, shipped)

- Ship x follows smoothed `torsoX`, clamped to the playfield.
- Either arm works. On the rising edge of an arm becoming raised+extended,
  fire ONE missile at that arm's angle: straight up only if the arm is
  within `BODY.straightUpToleranceDeg` (12°) of vertical, otherwise angled
  (clamped to `BODY.maxFireAngleDeg`, 60°). While the arm stays up, no
  refire. Lowering the arm below the shoulder reloads (reload sound, HUD
  "Reloaded!"), then it can fire again.
- Enemies in rows, slow enemy bullets the player can dodge by moving.
  Each level a little faster (`INVADERS.levelSpeedMultiplier` 1.15x speed,
  +12 px/s bullet speed per level). Score, 3 lives, level clear / game over,
  pause/restart, big kid-friendly HUD.

## Game 2 — Dance Pose Drop (v1, shipped)

- A target stickman in a pose falls from the top; the player's live
  stickman is drawn alongside (video + skeleton). When the target reaches
  the player's zone, score it if the player's pose matches within
  tolerance held ~0.6 s (`BODY.poseHoldSeconds`).
- Poses: arms up, T-pose, hands on hips, one arm up, star jump.
  Guitar-Hero-style timing feedback: Perfect / Good / Miss.
- Reuses the same `PoseSource`, `BodyState`, pose-match, renderer and
  audio as Game 1 — no duplicated pose code.
- Pose templates are built procedurally (`buildPoseTemplate`) and the
  target joint angles come from `jointAngles(template)` — the drawing and
  the scoring can never disagree.

## Playtest failure — Nov 4, 2026, and the framework fixes

Brandon playtested Space Invaders on his Pixel phone (front camera,
portrait) from the live GitHub Pages site: body never detected, Game Over,
score 0, ship never moved, arms never fired.

**First diagnosis: wrong.** The screenshots looked like a selfie close-up,
so the first theory was "face only, no hips/knees in frame". Brandon
corrected it the same day: he WAS fully in frame; the screenshots showed
the stretching, not his framing. That theory is dead and appears nowhere
in code or copy.

**Real root cause: a base-path bug.** The code loaded the pose model and
WASM from absolute paths (`/models/...`, `/wasm`). On GitHub Pages the app
lives at `/lara-pose-games/`, so `/models` resolves to the domain root and
404s (verified: 404 at `bdubdesigns.github.io/models/...`, 200 under
`/lara-pose-games/models/...`). PoseLandmarker never loaded on the live
site — no pose frames ever — while localhost at root worked fine, so
tests/builds never caught it. Fixes, all in this repo now:

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
  period. The DOM indicator is red "Step back — I can't see your body"
  vs green "✅ Body found". The old inverted out-of-frame logic (which
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

## Game 3 — Swing Lab (Active RuneSpace Mining prototype, Slice 1)

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
  bent-arm swing from a 5-year-old still counts.
- Lara games are PARKED (Brandon, Nov 4): Swing Lab is the Active
  RuneSpace first slice, not a Lara game. Space Invaders / Dance Drop are
  still in the hub and still work, but no new work goes into them.

## Not in v1 (documented only)

### Auto Runner (stub + design note)

Registered in the hub as "Coming soon"; `src/games/auto-runner/` holds a
stub implementing the `Game` interface. Design for the real build:

- Three lanes; torso left/centre/right selects the lane (torsoX thirds,
  with hysteresis so a wobbling child doesn't flicker lanes).
- Obstacles scroll toward the player; jump = hip rise above baseline
  (`BODY.jumpThresholdTorsoFrac`), duck = hip drop + knee bend
  (`BODY.duckKneeAngleDeg`). Both already derived in `BodyState` — the
  runner only needs to read them.
- Level = a sequence of obstacle patterns ending in a finish line; speed
  scales like Invaders. No lives lost for a "close" dodge — keep it kind
  for a 5-year-old: a hit costs the run's combo, not the run.

### Lumberjack / active RuneScape (vision only — see docs/vision-lumberjack.md)

Swing your body like chopping a tree to control a cute lumberjack SVG:
chop = torso twist + arm swing, XP + wood per chop, whittle/craft with
hand mimes, unlock higher trees/items, mining, better tools. Active
RuneScape / RuneSpace with our own IP. NOT built in v1 — the doc is the
parking lot for the idea.

## Tuning knobs Brandon will most likely need

All in `src/core/config.ts`:
- `BODY.raiseThresholdTorsoFrac` (0.25) — how high the wrist must go to
  count as "raised". Lower if Lara's raises aren't registering.
- `BODY.extendThresholdTorsoFrac` (0.8) — how straight the arm must be to
  fire. Lower if bent-arm raises should count.
- `BODY.straightUpToleranceDeg` (12) — how close to vertical counts as
  straight up. Widen if angled shots fire when she means straight.
- `BODY.oneEuroMinCutoff` / `oneEuroBeta` — ship smoothness vs lag.
- `POSE.variant` ('lite' | 'full') — A/B the model on the Pixel.
- `INVADERS.enemyBulletSpeedPxPerSec` (90) / `enemyFireIntervalSec`
  (2.2) / `levelSpeedMultiplier` (1.15) — difficulty.
- `DANCE.matchThreshold` (0.72) / `perfectThreshold` (0.88) — how strict
  pose matching is. Lower `matchThreshold` first if poses feel
  unmatchable.
- `SWING.strikeVelocityTorsoFracPerSec` (3.0) / `windupHeightTorsoFrac`
  (0.6) — the two swing numbers to tune first after a phone playtest.
  Lower the velocity if real chops don't register; lower the windup
  height if a 5-year-old can't reach it. `SWING.cooldownMs` (700) — one
  swing = one hit; shorten only if the game feels sluggish between swings.
- `GATE.gracePeriodMs` (500) — how long a lost pose is tolerated before
  the game pauses. `GATE.requireKnees` (true) — knees are required for
  full-body swing games; set false only if a game genuinely doesn't need
  legs. `GATE.staleFrameMs` (2000) — a pose frame older than this closes
  the gate ("Pose feed frozen") even inside the grace period; raise it
  only if a healthy feed on the target device legitimately goes quiet
  for longer.
- `STAGE` (960×540) — the fixed game aspect. Do not tie it to video size.
- `AUDIO.masterGain` (0.5) — volume.

## Quality gates (same as the Spider-Man repo)

- `npm test` — vitest, unit tests for arm-angle math, reload state
  machine, ship mapping/clamping, pose-match scoring, level scaling.
- `npm run typecheck` — `tsc --noEmit`, strict.
- `npm run lint` — type-aware ESLint, zero warnings.
- `npm run build` — typecheck + vite build.
- All deps pinned exactly; lockfile committed.

## Remaining human test (cannot be verified in this sandbox)

Real-camera feel on the Pixel 10 Pro XL with Lara: arm-raise thresholds
for a 5-year-old's arms, ship responsiveness, inference Hz on-device,
whether the lite model holds her in frame while she moves fast, and
whether the dance poses read as fun or frustrating. Tune from
`config.ts` after that session — that's what it's for.

**Swing Lab phone test (Brandon, first):** stand back so head-to-knees
fit in frame; wait for the green "✅ Body found" indicator. Raise both
arms straight overhead (meter fills gold, "Now SWING DOWN!"), then chop
down fast. A hit cracks the node, +1 ore, +10 XP. Five hits break the
node; ten hits reach Mining Lv 2. "Swing bigger!" = wrists didn't reach
windup height; "Swing faster!" = dropped slowly instead of chopping.
Still untested on camera: swing thresholds (0.6 windup, 3.0 torso/s
velocity), One-Euro lag at ~9 Hz inference, and adult vs 5-year-old
differences. Render code (canvas drawing) is untested in Node — it
typechecks and builds, but the first visual check needs a browser.

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
(reference frames in `docs/playtest-nov4/`).

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
  green, so no Space Invaders / Dance Drop regression from the shared
  BODY change.

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
