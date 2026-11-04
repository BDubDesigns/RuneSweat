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
