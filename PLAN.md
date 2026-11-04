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
