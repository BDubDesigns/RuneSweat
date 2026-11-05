# RuneSweat

Active RuneSpace: swing, carry, jump, craft, fight — your body is the
controller. Single-player, full-body camera pose game.

**No backend, no telemetry, nothing leaves the device.** The camera feed
goes to an on-device MediaPipe PoseLandmarker and nowhere else.

> Repo split (Nov 4, 2026): this repo was split out of
> BDubDesigns/lara-pose-games, which keeps the Lara camera games.
> Those games are NOT in this repo.
> RuneSweat is the active-RuneSpace game; its build log below is shared
> history from before the split.

## Quick start

```bash
npm ci --legacy-peer-deps  # plain `npm ci` fails on vitest peer deps
npm run download-model # fetch the pose model (~6 MB lite + ~13 MB full) + copy WASM
npm run dev            # http://localhost:5173
```

Then: pick a game, tap **Turn Camera On** (camera needs a secure page —
`https` or `localhost`), stand back so your whole body fits in frame.

No camera? Tap **Play Without Camera**: move the mouse to move, hold it
to raise an arm at an angle, `A`/`D` raise arms straight up, `W`
jump, `S` duck, `X` (hold) legs wide for star jumps. `Space` pauses (press it again to resume). `?source=replay` plays a recorded clip instead.

## The games

- **Swing Lab** — Active RuneSpace Mining prototype. Raise both arms overhead together, then chop down fast like a pickaxe: the Ferrite Shale node cracks, a real ore pops out and flies to the Ore counter, +15 Mining XP. Five hits break the node apart into falling pieces; a new node arrives after a 3 s progress bar and fades in. Two-handed only — a single arm gets "Both hands together!". Mine tiers follow RuneSpace: Ferrite Shale at The Jag (Mining 1, 15 XP/hit) now, Galvanite at Deep Jag (Mining 5, 25 XP/hit) locked until Mining 5 — pick a mine on the chips at the bottom-right of the stage. Ore and XP persist in a local save (see below); press `Space` to open the town hub.
- **Town Hub + Refiner** — press `Space` (or ⏸ Pause) while mining to open the town hub: inventory with the real item art, mines open to you, and activity spots. The **Refiner** turns ore into refined materials: pick a recipe (Refined Ferrite at Refining 1, Galvanic Stock at Refining 5), grab ore from the pile with both hands, carry it to the hopper, and do 3 star jumps per batch (jump with arms wide and legs apart — in the sim: `W` + `Q`+`E` + `X`). **Bix's Shop** buys your ore and refined goods for Credits (active-game prices, not RuneSpace canon). Reset save is two-tap in the hub.
- **Lumberjack** — coming soon (chop trees with your body). Vision only, see `docs/vision-lumberjack.md`.

## Playing on a phone (GitHub Pages)

Open the Pages link, tap **Turn Camera On**, stand back so head-to-knees fit in frame, and wait for the green **"✅ Body found"** indicator — the game will not start until it can see your body. Two ways it pauses: stepping out of frame pauses automatically and stepping back in resumes it ("Step back into frame"); pressing `Space` (or the **⏸ Pause** button) pauses on purpose and opens the town hub — it stays paused until you press `Space` / **⏸** again, even if you step back into frame ("Paused — press Space to resume").

**You won't see yourself on screen** — you see the game and your miner (white tank top, heart boxers, hard hat) only. The camera video is hidden by default; the **"📷 Show Camera"** button (or `V`) shows it letterboxed for calibration. The game stage is a fixed 16:9 landscape frame whatever shape your phone's camera is, so the video never stretches. On desktop the stage fills the browser window, and the **"⛶ Fullscreen"** button (or `F`) puts the whole stage fullscreen.

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

Still untested on a real device: whether inference actually keeps running on the Pixel during a full Swing Lab session — the duplicate-timestamp guard is the prime suspect for the freeze but is verified in code + fakes only, not on the device — what the real inference Hz and delegate are in play, whether the 2 s staleness threshold ever trips on a healthy feed, and the swing thresholds (0.7 windup, 2.5 torso/s) against a real chop.

Mouse-sim (no camera): `?source=mouse`, hold **A+D** (or both mouse buttons) ~0.5s to wind up, release both at once to strike. Both hands together — a single arm gets "Both hands together!" and does not count.

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
  after a real-device playtest.

## Save — do not rename the key

Progress (Mining/Refining XP, ore, refined materials, Credits) persists
in localStorage under `activersespace-save-v1` (`SAVE.key` in
`src/core/config.ts`). The key name is a historical artifact from the
repo this one split from — do NOT "fix" it to a runesweat name. Renaming
it would strand live progress: the save would load as empty on the new
URL. See the comment next to the key in `config.ts`.

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
(PoseLandmarker vs MoveNet), the Lumberjack vision, and what still
needs a real-device test.

## Swing Lab v2 — avatar + presentation (Nov 4, 2026)

The player on screen is now a real character, not a stickman. The hub
draws an `AvatarRenderer` (`src/render/avatar.ts`) for every game
whenever landmarks exist: a chunky miner in a white tank top,
heart-pattern boxers, and a yellow hard hat, drawn as canvas vector
shapes from the raw landmarks (per-joint One Euro smoothing lives in
the renderer — `BodyState` has no joint fields). The stickman skeleton
is a debug overlay only: on top of the avatar, only while the debug HUD
is on (D key). The default outfit lives in `config.ts` as `OUTFIT`
(slots: top / bottoms / skin / hat) — a future outfit swaps the same
slots; see `PLAN.md` for the slot contract.

Swing Lab v2 presentation changes: the ore node sits front-center at
chair/waist height in front of the avatar (`nodeCenterForBody` derives
it from the body's canvas hip position), so the rock occludes the
avatar's waist and below; the pickaxe is gripped in the right hand at
all times (`pickaxeAnchorForBody`: right wrist + right forearm angle,
never the wrist midpoint); the swing meter is bigger, hit floaters are
bigger with a shake you can actually see, the ready line reads "Both
hands up together, then chop down in front of you!", and the ghost arc
shows two hands together rising then chopping straight down in front.
When the body is sideways the phase text adds a hint — "Face the camera
— I can't see you from the side" — advisory only, never a block.

## Swing Lab v2 — true two-handed machine (Worker B, Nov 4, 2026)

The swing machine (`src/games/swing-lab/swingMachine.ts`) is two-handed
only now. Both wrists must rise above the windup line together, hands
clasped on one handle, and chop straight down in front of the body
through waist level — the strike line moved from chest level (0.5) to
0.85 torso lengths below the shoulder (shoulder-to-hip is 1.0; the waist
and the node sit just above the hips). Single-arm swings no longer count:
a solo arm completing a fast drop is a weak swing, "Both hands together!"
(`hands-apart`). The drop is judged on the pair — the velocity that
counts is the MINIMUM of the two arms' peak downward velocities — and
hands separating mid-drop fire `hands-apart` at once. Hits still emit
`handedness: 'two-handed'`. Windup progress now reads from the LOWER
wrist. Kept: 0.6 windup line, 3.0 torso/s strike velocity, 700 ms
cooldown, 300 ms weak re-arm.

Two fixes worth knowing: (1) v1 misread a settled ~0.5 s hold as a flick
— the drop's first fast frames still read above the windup line, and the
flick rule fired on them. The rule now only fires after the pair has
dropped BELOW the windup line. The mouse-sim pipeline test holds a full
500 ms to lock this in. (2) `BodyState` gained
`shoulderWidthTorsoFrac` (One-Euro-smoothed shoulder width / torso
length, 0 with no body); `SwingSnapshot.facingOk` is false when a body
is present and the ratio is below `FACING.minShoulderWidthTorsoFrac`
(0.6: front reads ~0.7-1.0, profile ~0.3-0.4). Hint only, never a gate.

Smoothing retune: wrists got their own One Euro params
(`BODY.wristOneEuroMinCutoff` 1.5, `beta` 0.05, `dCutoff` 1.0 — was the
shared 1.0 / 0.02 / 1.0). Measured on the sim pipeline, new machine +
new sim, only the wrist params varying: release-to-hit 352 ms -> 256 ms
(300 ms hold) and 368 ms -> 256 ms (500 ms hold); peak velocity 6.65 ->
9.59 and 8.07 -> 10.84 torso/s. `SWING.wristVelEmaAlpha` stays 0.35 —
no real 33 Hz noise data in the sandbox to justify moving it.

Mouse sim: A+D (or both buttons) now clasps — both wrists follow one
handle point on the midline from overhead to waist height, latched until
500 ms after both arms are fully down (the tracker lags the raw motion;
releasing the latch at the bottom would snap the smoothed wrists apart
and trip `hands-apart` before the hit lands). Single-arm and angled
(Q/E) raises still follow their own arcs. Between chops the hands rest
together at waist height, not at the sides.

## Swing Lab v3 — RuneSpace node, tiers, ore drops, break lifecycle, fullscreen (Worker B, Nov 4, 2026)

Second playtest (Brandon, Nov 4, ~4:30 PM, laptop, 77 s video): Lv 5, 43 swings, 43 ore. What he asked for: the node bigger, wider and lower (cover the legs more, not more upper body); the node looking like a real RuneSpace ore node; the real RuneSpace mining tiers for which mines you can choose; a fullscreen mode, or at least the canvas filling the screen; ore coming out of the node on a hit — the actual ore image from RuneSpace, starting at the level 1 ore. The same round added: bigger hit effects, and the node falling apart into pieces on break instead of popping out of existence.

**Node — bigger, wider, lower, RuneSpace look.** The node is an ellipse now (`nodeRadiiForStage`: rx 0.22, ry 0.17 of the smaller stage dimension; v2 was a 0.15 circle), and its top sits just below the hips instead of half a radius above them (`nodeCenterForBody`: centre 1.15 radii below the hips) — wider and lower, covering the legs more without covering more upper body. The rock face is the real RuneSpace `boulder.webp` (copied into `public/item-art/`, cover-fit into the ellipse), with the active tier's ore crystals drawn embedded in it (rusty orange for Ferrite Shale, bright silver for Galvanite, sampled from the real art) and a drawn-rock fallback when the art has not loaded. The plain brown circle + blue diamond is gone. Cracks + HP pips stay; cracks get thicker and the rock darkens as the hits pile up so the stages read clearly.

**RuneSpace mining tiers (`src/games/swing-lab/tiers.ts`).** Sourced from the RuneSpace repo (`game/config/balance.ts`, main ba93790, mining `sources`): Ferrite Shale — The Jag, `requiredMiningLevel` 1, `successXp` 15; Galvanite — Deep Jag, `requiredMiningLevel` 5, `successXp` 25. The level curve stays Swing Lab's own (100 XP per level, `SWING.xpPerLevel`). Ferrite Shale is the only playable node now; the mine selector is two chips at the bottom-right of the stage (canvas-drawn, tappable via the game's own canvas pointer listener — `pointerDownAt`), showing Galvanite locked with its requirement ("🔒 Galvanite — Deep Jag (Lv 5)"; tapping it shows the full "Unlocks at Mining 5 — Deep Jag" floater). Adding the next tier is a data-only change: append one entry to `MINING_TIERS` and the selector, lock, drops and XP all follow. XP per hit is the tier's RuneSpace `successXp` (15 / 25), wired at the scoring layer in `swingLab.ts` — the swing machine's API is untouched.

**Ore drops use the real RuneSpace ore image.** Every hit pops one ore out of the node: the actual `ferrite-shale.webp` (or `galvanite.webp` for that tier), arcing up out of the rock and flying down to the Ore counter in the HUD over 800 ms, shrinking and fading. The Ore counter shows the same real ore image next to the count. Art is preloaded once in the game constructor via `assetUrl` (base-relative, never a leading slash — the Nov 4 path bug); a missing or failed image falls back to the drawn gem, never a broken image or a crash.

**Hit + break effects.** A hit now shakes harder (250 ms, 12 px — v2 was 150 ms / 5 px), flashes the meter, and throws 8 debris chips off the rock. On the 5th hit the node breaks apart into 6 rock pieces that tumble and fall with gravity off the bottom of the canvas and are disposed of once off-screen or past their 1.2 s lifetime (hard-capped at 24 pieces, so many broken nodes can never accumulate a list). Then a progress bar fills over 3 s where the node broke ("⛏️ New node in Ns…"); the node is gone and unminable during the wait — swings in the wait count for nothing. When the bar completes, the new node fades in over 400 ms. All break timings live in the `BREAK` module constants in `swingLab.ts`, not `config.ts` (Worker B could not touch `config.ts` this round; the coordinator can move them into `SWING` at integration).

**Fullscreen + fill the screen.** A **"⛶ Fullscreen"** button in the stage controls (or `F`) puts the whole stage section — canvas, HUD, controls — fullscreen via the Fullscreen API; the label follows the real state through `fullscreenchange` (Esc works too), a denied request just stays windowed, and quitting to the hub exits fullscreen first. The stage also fills the browser window without fullscreen: `#app` is wider now (1280 px) and the stage wrap is capped by viewport height as well as width, so on desktop it is big by default instead of a small box under the hub. The 16:9 letterbox inside the stage is unchanged, and the portrait-phone letterboxing is untouched. The fill-screen CSS lives in a `<style>` block in `index.html`, not `styles.css` (outside Worker B's file ownership this round — the coordinator can move it at integration).

**Copy fix.** The hub tip said "you'll see your skeleton" — v2 shipped a person, so it now says "you'll see your miner in a hard hat". The Swing Lab hub card names the mine: "mine Ferrite Shale at The Jag!".

**Still unverified (needs a real device).** The node's look on a real phone screen (boulder art + crystals at phone size), fullscreen on a real browser, image loading under the Pages subpath (`./item-art/...` — correct by construction via `assetUrl`, never exercised against the live subpath), and whether the bigger shake / debris / pieces read well or overwhelm a small screen.

## Swing Lab v3.1a — shake settles, bigger head, two pause kinds (Worker A, Nov 4, 2026)

- **Shake settles.** The hit shake now decays to exactly (0, 0) instead of cutting from full amplitude, and the HUD (swing meter, phase text, tier chips, banners, respawn bar) is drawn outside the shake transform — the node/avatar may shake, the HUD never moves. (The fix also caught a latent bug: `drawNode` saved the canvas context without restoring it.)
- **Head: bigger and lower.** Head radius 0.17 → 0.24 torso lengths, centre moved down so the chin overlaps the torso top — the head sits on the neck, no gap, no floating. The hard hat scales with the head.
- **Two pause kinds.** `Space` (or the **⏸ Pause** button) pauses on purpose: it opens the town hub and stays paused until you press `Space` / **⏸** again, even if you step back into frame. Stepping out of frame pauses automatically and stepping back in resumes it — auto pause never opens the hub. Pressing `Space` while auto-paused converts to a manual pause (the hub opens) instead of the button doing nothing.
- **Rebind.** `Space` was the mouse-sim jump key; jump is now `W` (hold), `S` duck stays. The real-camera body jump is unaffected.

## Swing Lab v3.1b — town hub, refiner, Bix sell, local save (Worker B, Nov 4, 2026)

**Town hub (`src/hub/townHub.ts`).** The manual-pause screen (Worker A owns the pause state machine that opens/closes it). Pointer/click driven menu, canvas-drawn chips + hit-testing like the Swing Lab tier selector. Shows inventory (ore by tier with the real images, refined materials, Credits), the mines open to you (Ferrite Shale — The Jag; Galvanite — Deep Jag, locked until Mining 5), and activity spots: **Refiner** (playable) and **Bix's shop** (sell); combat etc. are "coming soon" stubs only, not built. Space/Esc closes the hub and resumes; leaving returns to Swing Lab. Interface for the coordinator: `new TownHub({ onResume, onOpenRefiner, onReset })`, `open()` / `close()` / `isOpen` / `render(ctx, nowMs)` / `handlePointer(x, y)` / `handleKey(key)` / `snapshot()`. `main.ts` owns the canvas pointer listener and forwards taps + Space/Escape.

**Refiner (`src/games/refiner/`).** A `Game` like Swing Lab, so the coordinator registers/switches it in `main.ts` the same way. Recipe picker: **Refined Ferrite** (Refining 1, 2 Ferrite Shale → 1, 15 XP) and **Galvanic Stock** (Refining 5, 2 Galvanite → 1, 25 XP) — RuneSpace's own rates from `game/config/balance.ts` (main ba93790); a recipe you can't afford or aren't levelled for shows locked, with why. The input ore sits as a pile in a wheelbarrow/bin on the left — up to 10 visible, refilling from owned stock, under 10 shows exactly the owned count. Both hands over the pile (held 200 ms) grab ONE ore; carry it to the hopper on the right and it drops loose (hopper 1/2, 2/2). With a full hopper, **3 star jumps** complete the batch → +1 refined material + XP. Leaving mid-batch abandons it and the carried + hopper ore returns to inventory — nothing is ever lost to a pause. Failure → Slag is NOT built: the active refiner always succeeds. Next recipe (not this round): Galvaferrite, Refining 8, 1 Refined Ferrite + 1 Galvanic Stock → 1, 35 XP — it needs a two-input recipe, so it waits for machine support for a second input. Coordinator wiring: set `game.onLeaveToHub = () => ...` (called after the batch is abandoned when the player taps "Leave to town"); the game also exposes `leavePending` / `clearLeaveRequest()`.

**Star jumps (`src/core/starJump.ts`).** Jump + arms out wide + legs apart (jumping-jack shape), judged forgivingly: wrist spread ≥ 1.2 torso lengths (arms straight up read ~0.73, arms out ±35° read ~1.9) AND both wrists ≥ 0.1 torso above the shoulder line, AND ankle spread ≥ 0.85 torso (standing reads ~0.59, a jack lands ~1.0–1.4). One event per jump: re-arms on landing plus a 500 ms minimum interval. `BodyState` gained one additive field, `ankleSpreadTorsoFrac` (optional, so hand-built states elsewhere keep compiling; the tracker always sets it).

**Local save (`src/core/save.ts`, `src/core/inventory.ts`).** Inventory, Mining/Refining XP and Credits persist in localStorage under the versioned key `activersespace-save-v1`. Single-player, no server, no leaderboard — local save is the model. Loading tolerates a missing/corrupt/older-version save (fresh save, never a crash). `inventory` is a module-singleton store games and the hub import directly — no `GameConstructor` change: `inventory.count/add/remove`, `credits` / `addCredits` / `spendCredits`, `xp/level/addXp('mining' | 'refining')`, `snapshot()`, `reset()`. Level = floor(XP / 100) + 1, starting at 1. Swing Lab is wired in (v3.1 integration): every counted hit calls `inventory.add(tier.id, orePerHit)` + `inventory.addXp('mining', xpPerHit)`, `start()`/`restart()` read ore/XP back from the store, and switching mines re-reads the new tier's owned count. Restart is NOT Reset-save: it resets the session (swings, node, machine) but keeps owned ore/XP. Tests reset the singleton in a file-level `beforeEach` — a hit in one test would otherwise leak into the next test's `start()`.

**Bix's shop (sell).** In the hub, Bix's spot opens a sell screen: Sell 1 and Sell all per item at the `BIX` config prices. **These prices are ACTIVE-GAME-ONLY, NOT RuneSpace canon:** Ferrite Shale 2cr, Galvanite 4cr, Refined Ferrite 6cr, Galvanic Stock 10cr (ore sells cheap; refining roughly doubles the ore's value: 2×2cr in → 6cr out). No daily limits, no buying this round. (RuneSpace's real Bix — Power Cells 12cr, buy-back 4cr, gems 8/18/35cr — lives in shop/dialogue content, not `balance.ts`, and was not re-verified for this slice.)

**Mouse-sim mappings for the refiner.** Pointer steers the torso; `A`+`D` clasps both hands to one point — move the clasp over the pile to grab (hold 200 ms), over to the hopper to drop. Star jump: `W` (jump, after Worker A's Space → W rebind) + `Q`+`E` (arms wide). **Known gap: the current sim cannot spread its ankles** (fixed at hip width, ~0.59 torso, below the detector's 0.85 line), so a sim star jump can never count — the grab/carry/drop half plays in the sim today, the jump half needs a sim leg-spread input from the coordinator (see `core/starJump.ts`). A test documents this gap and must be updated when the sim support lands.

**Still unverified (needs a real device).** Real-body grab/carry feel, star-jump detection on a live body, the hub's readability on a phone screen, refined art loading under the Pages subpath.
