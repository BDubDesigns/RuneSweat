# Lara's Pose Games — pose-arcade

A lightweight, modular framework for full-body camera pose games for a
young child. Space Invaders + Dance Pose Drop. Single-player practice.

**No backend, no telemetry, nothing leaves the device.** The camera feed
goes to an on-device MediaPipe PoseLandmarker and nowhere else.

## Quick start

```bash
npm ci --legacy-peer-deps  # plain `npm ci` fails on vitest peer deps
npm run download-model # fetch the pose model (~6 MB lite + ~13 MB full) + copy WASM
npm run dev            # http://localhost:5173
```

Then: pick a game, tap **Turn Camera On** (camera needs a secure page —
`https` or `localhost`), stand back so your whole body fits in frame.

No camera? Tap **Play Without Camera**: move the mouse to move, hold it
to raise an arm at an angle, `A`/`D` raise arms straight up, `Space`
jump, `S` duck. `?source=replay` plays a recorded clip instead.

## The games

- **Swing Lab** — Active RuneSpace Mining prototype. Raise both arms overhead, then chop down fast like a pickaxe: the ore node cracks, +1 ore, +10 Mining XP. Five hits break the node and a new one spawns. Single-arm swings count too. Half-swings say "Swing bigger!" / "Swing faster!" instead of hitting.
- **Space Invaders** — move your body to fly the ship. Raise either arm to shoot a missile in the direction your arm points (straight up only if your arm is straight up). Lower your arm to reload. Enemies shoot back slowly; each level gets a little faster.
- **Dance Pose Drop** — a stickman in a pose falls from the sky. Copy the pose when it lands in your zone. Perfect / Good / Miss.
- **Auto Runner** — coming soon (lane switching, jump, duck).
- **Lumberjack** — vision only, see `docs/vision-lumberjack.md`.

## Playing on a phone (GitHub Pages)

Open the Pages link, tap **Turn Camera On**, stand back so head-to-knees fit in frame, and wait for the green **"✅ Body found"** indicator — the game will not start until it can see your body, and it pauses itself if you step out of frame.

**You won't see yourself on screen** — you see the game and your skeleton only. The camera video is hidden by default; the **"📷 Show Camera"** button (or `V`) shows it letterboxed for calibration. The game stage is a fixed 16:9 landscape frame whatever shape your phone's camera is, so the video never stretches.

If the game says **"Pose model failed to load"**, the pose model didn't download — check your connection and reload. The debug HUD (`🔍 Debug` / `D`) shows model status, inference Hz, and body visibility, so a bad playtest can be told apart: model didn't load vs body not seen vs game logic wrong.

## Playtest note — Nov 4, 2026 Swing Lab freeze

Brandon's phone playtest of Swing Lab showed the HUD reading model LOADED, inference 0.0 Hz, frame age 142.2 s, 33 landmarks, "body usable YES" with knees hidden — exactly **one** inference frame ever succeeded, and the game ran off that stale frame for over two minutes and never paused. What caused it, as verified in code:

- The body-visible gate trusted `bodyUsable` with no age check, and the hub fed it the latest body state forever — a frozen feed looked like a live one.
- `bodyUsable` did not require knees (`GATE.requireKnees: false`), so a partial body counted as "Body found".
- There was no path for inference dying after a successful load, and the HUD showed no inference-error count, delegate, or video-freeze signal.

What changed in this round:

- **Staleness gate** (`GATE.staleFrameMs: 2000`): a pose frame older than 2 s closes the gate with "Pose feed frozen — tap Retry", and staleness beats the grace period — a frozen frame can never stay open via grace.
- **Knees required** (`GATE.requireKnees: true`): a body counts as usable only when shoulders + hips + knees are each at or above the visibility threshold. The grace period still covers mid-game knee flicker.
- **Inference-stopped path**: when the pose source reports inference has stopped, the gate closes with "Pose detection stopped — tap Retry" (or the last error, truncated, when one is attached).
- **HUD signals**: inference error count + last error, active delegate (GPU/CPU), video-frozen flag, and video time age, alongside the existing fps / inference Hz / frame age / model / landmark lines.
- **Duplicate-timestamp guard + once-per-frame inference** (prime suspect for the freeze): `frameAt` never calls `detectForVideo` with a timestamp at or below the last attempted one — MediaPipe VIDEO mode rejects non-increasing timestamps, and the fixed-step loop used to call it several times per rendered frame with the same timestamp on catch-up steps. The hub now fetches a pose frame once per rendered frame, in `render()`, never per update step.
- **Inference errors surfaced + CPU recovery**: the source counts consecutive failures and keeps the last error; after 10 failures on GPU it re-creates the landmarker on the CPU delegate, and if CPU also fails 10 times it reports inference stopped (`POSE.maxConsecutiveFailures`).
- **Video liveness**: the camera video is attached to the DOM hidden (opacity 0, never `display:none`, which can pause playback); the source watches `video.currentTime` and flags the video frozen if it stops advancing for 2 s (`POSE.videoFrozenMs`), retrying `play()` if the video paused.
- **Retry Camera button**: restarts the whole camera feed from scratch (new source + new video) when the feed freezes or inference stops; the picked game stays put, gated, until a fresh usable body arrives.

Still untested on a real device: whether inference actually keeps running on the Pixel during a full Swing Lab session — the duplicate-timestamp guard is the prime suspect for the freeze but is verified in code + fakes only, not on the device — what the real inference Hz and delegate are in play, whether the 2 s staleness threshold ever trips on a healthy feed, and the swing thresholds (0.6 windup, 3.0 torso/s) against a real chop.

Mouse-sim (no camera): `?source=mouse`, hold **A+D** (or both mouse buttons) ~0.5s to wind up, release both at once to strike. Single arm works too (just A).

## How it works

- **Pose:** MediaPipe PoseLandmarker (33 landmarks), Lite by default,
  switchable to Full in `src/core/config.ts` (`POSE.variant`).
  Inference is decoupled from render — render at 60 fps, inference at
  whatever the device sustains (~9 Hz on the Pixel 10 Pro XL).
- **BodyState:** `src/core/bodyState.ts` turns landmarks into the game's
  view of the body (torsoX, per-arm raised/extended/angle, jump, duck,
  pose-match score). Games never touch landmark indices.
- **Sources:** real camera, mouse simulator, replay fixture — all behind
  the one `PoseFrameSource` interface, so games can't tell them apart.
- **Tuning:** every tunable lives in `src/core/config.ts` — the single
  source of truth. See PLAN.md for the knobs you'll most likely need
  after a playtest with Lara.

## Quality gates

```bash
npm test        # vitest unit tests
npm run typecheck
npm run lint    # type-aware ESLint, zero warnings
npm run build   # typecheck + vite build
npm run preview # serve the production build
```

## Project layout

See `PLAN.md` for the architecture, the model-choice trade-off
(PoseLandmarker vs MoveNet), the auto-runner design note, and what still
needs a real-device test with Lara.
