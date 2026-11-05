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
jump, `S` duck, `P` (hold) press both forge buttons in the refiner. `Space` (or 🏠 Town) takes you to town; `Space` again (or the Back button) returns to the activity. `?source=replay` plays a recorded clip instead.

## The games

- **Swing Lab** — Active RuneSpace Mining prototype. Raise both arms overhead together, then chop down fast like a pickaxe: the Ferrite Shale node cracks, a real ore pops out and flies to the Ore counter, +15 Mining XP. Five hits break the node apart into falling pieces; a new node arrives after a 3 s progress bar and fades in. Two-handed only — a single arm gets "Both hands together!". Mine tiers follow RuneSpace: Ferrite Shale at The Jag (Mining 1, 15 XP/hit) now, Galvanite at Deep Jag (Mining 5, 25 XP/hit) locked until Mining 5 — pick a mine on the chips at the bottom-right of the stage. Ore and XP persist in a local save (see below); press `Space` to open the town hub.
- **Town Hub + Refiner** — press `Space` (or 🏠 Town) while mining to go to town: inventory with the real item art, mines open to you, and activity spots. The **Refiner** turns ore into refined materials: pick a recipe (Refined Ferrite at Refining 1, Galvanic Stock at Refining 5), grab ore from the pile with both hands, carry it to the hopper, and press both pedestal buttons 3 times per batch (in the sim: hold `P`). **Bix's Shop** buys your ore and refined goods for Credits (active-game prices, not RuneSpace canon). Reset save is two-tap in the hub.

## Playing on a phone (GitHub Pages)

Open the Pages link, tap **Turn Camera On**, stand back so head-to-knees fit in frame, and wait for the green **"✅ Body found"** indicator — the game will not start until it can see your body. Two ways play stops: stepping out of frame pauses automatically and stepping back in resumes it ("Step back into frame"); pressing `Space` (or the **🏠 Town** button) takes you to town instead — it stays in town until you pick an activity or press `Space` / **🏠** again to return, even if you step back into frame. The auto-pause never opens town.

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

**Refiner (`src/games/refiner/`).** A `Game` like Swing Lab, so the coordinator registers/switches it in `main.ts` the same way. Recipe picker: **Refined Ferrite** (Refining 1, 2 Ferrite Shale → 1, 15 XP) and **Galvanic Stock** (Refining 5, 2 Galvanite → 1, 25 XP) — RuneSpace's own rates from `game/config/balance.ts` (main ba93790); a recipe you can't afford or aren't levelled for shows locked, with why. The input ore sits as a pile in a wheelbarrow/bin on the left — up to 10 visible, refilling from owned stock, under 10 shows exactly the owned count. Both hands over the pile (held 200 ms) grab ONE ore; carry it to the hopper on the right and it drops loose (hopper 1/2, 2/2). With a full hopper, **3 pedestal presses** complete the batch → +1 refined material + XP (v3.4: the press replaced the star jumps — Brandon is too tall for his room to jump without leaving the frame, so the jump never counted). Leaving mid-batch abandons it and the carried + hopper ore returns to inventory — nothing is ever lost to a pause. Failure → Slag is NOT built: the active refiner always succeeds. Next recipe (not this round): Galvaferrite, Refining 8, 1 Refined Ferrite + 1 Galvanic Stock → 1, 35 XP — it needs a two-input recipe, so it waits for machine support for a second input. Coordinator wiring: set `game.onLeaveToHub = () => ...` (called after the batch is abandoned when the player taps "Leave to town"); the game also exposes `leavePending` / `clearLeaveRequest()`.

**Pedestal press (`src/core/pressDetector.ts`, v3.4, resized v3.5).** Replaces the star jumps (deleted `src/core/starJump.ts`): both wrists inside their button zones + downward motion at some point in the hold + a 300 ms hold. One event per press: re-arms when a wrist leaves its zone, plus a 500 ms minimum interval. Two pedestals slide up either side of the avatar over 400 ms when the hopper fills (and slide away on batch-complete / leave); the detector only runs once they are fully up. The forging bar in the hopper visibly squashes one step per press; the buttons sink as the hold progresses (sink capped at half the pad height, so the small v3.5 pad is never swallowed). `BodyState` needs no new field — hip-mid is `torsoX`/`torsoY`, wrists are already there; the old `ankleSpreadTorsoFrac` stays as tracker output for the debug HUD only.

**Pedestal sizing (v3.5).** v3.4's pedestals were giant gold slabs at the far bottom corners (zones ±0.8 torso, 0.5 × 0.4 torso) — Brandon's hands hung nowhere near them, and the slabs covered the Leave chip and the hopper label. v3.5 shrinks them to fist-sized pads on slim posts right beside the body: `pressButtonZones` centres at hip-mid ±0.55 torso, 0.25 wide × 0.2 tall, top at hip + 0.02 torso (resting hand height). The numbers are anchored to a measurement, not a guess: the sim's hanging wrists rest at hip-mid ±0.567 torso, hip + 0.048 torso, so the resting wrist lands ~0.005 torso off the zone centre and ~0.008 below the zone top, with a 0.1-torso push fitting inside the zone with room to spare. The rendered pad IS the detection zone (`pedestalRectsForStage` renders from `pressButtonZones`, one source — the v3.4 bug was drawn slabs bigger than the zones). The post is 65% of pad width, centred under the pad, running to the stage bottom; the pile/hopper labels moved above their zones so the posts never cross them. The sim P key reads the same numbers from `PRESS` (v3.4 it hard-coded ±0.8 in `mouseSource.ts` — that is the bug class to never repeat: sim targets and detector zones share one source). Re-arming between presses needs the wrists to leave the zones — the hanging wrists rest just inside them, so the sim clasps `A`+`D` to pull the hands to the centre; a real player re-arms by lifting the hands a little.

**Local save (`src/core/save.ts`, `src/core/inventory.ts`).** Inventory, Mining/Refining XP and Credits persist in localStorage under the versioned key `activersespace-save-v1`. Single-player, no server, no leaderboard — local save is the model. Loading tolerates a missing/corrupt/older-version save (fresh save, never a crash). `inventory` is a module-singleton store games and the hub import directly — no `GameConstructor` change: `inventory.count/add/remove`, `credits` / `addCredits` / `spendCredits`, `xp/level/addXp('mining' | 'refining')`, `snapshot()`, `reset()`. Level = floor(XP / 100) + 1, starting at 1. Swing Lab is wired in (v3.1 integration): every counted hit calls `inventory.add(tier.id, orePerHit)` + `inventory.addXp('mining', xpPerHit)`, `start()`/`restart()` read ore/XP back from the store, and switching mines re-reads the new tier's owned count. Restart is NOT Reset-save: it resets the session (swings, node, machine) but keeps owned ore/XP. Tests reset the singleton in a file-level `beforeEach` — a hit in one test would otherwise leak into the next test's `start()`.

**Bix's shop (sell).** In the hub, Bix's spot opens a sell screen: Sell 1 and Sell all per item at the `BIX` config prices. **These prices are ACTIVE-GAME-ONLY, NOT RuneSpace canon:** Ferrite Shale 2cr, Galvanite 4cr, Refined Ferrite 6cr, Galvanic Stock 10cr (ore sells cheap; refining roughly doubles the ore's value: 2×2cr in → 6cr out). No daily limits, no buying this round. (RuneSpace's real Bix — Power Cells 12cr, buy-back 4cr, gems 8/18/35cr — lives in shop/dialogue content, not `balance.ts`, and was not re-verified for this slice.)

**Mouse-sim mappings for the refiner.** Pointer steers the torso; `A`+`D` clasps both hands to one point — move the clasp over the pile to grab (hold 200 ms), over to the hopper to drop. Press: hold `P` — both wrists animate onto the pedestal buttons (hip-mid ±0.8 torso, hip line) and push down to hip line + 0.12 torso while held; release returns them to rest. The full batch is sim-playable, proven by a test (grab ×2, drop ×2, 3 P presses → +1 refined, +15 XP). `W` jump stays as a general sim capability, it is just no longer the refiner's input. One sim artifact, documented in the test: the sim's hanging wrists rest just inside the button zones (0.330 vs the 0.335 edge), so between presses the test clasps `A`+`D` to pull the hands to the centre and re-arm the detector — a real player's hanging hands sit well inside the zones' inner edge (~0.4 vs 0.55 torso), so real play re-arms by lowering the hands.

**Still unverified (needs a real device).** Real-body grab/carry feel, pedestal-press detection on a live body (are the buttons at a comfortable height for Brandon? does the press read on a real camera?), the hub's readability on a phone screen, refined art loading under the Pages subpath.

## Swing Lab v3.2 — eyes visible, town is a place (Worker A, Nov 4, 2026)

**Eyes (`src/render/avatar.ts`).** Playtest frames (t48, t70) showed a smile and no eyes: `drawHead` drew dot eyes at `cy - 0.3r`, then painted the hard-hat dome (centred `cy - 0.12r`, radius `1.02r`) over them — the eyes sat `0.42r` from the dome centre, well inside it. Fixed by drawing the hat FIRST, then the face, with the eyes moved into the visible band below the brim (brim bottom ≈ `cy + 0.04r`): eyes at `cy + 0.32r`, `±0.36r` from the face centre, radius `0.15r` (was `0.09r`, ~7 px across — too small at phone size; `0.15r` is ~12 px across on the sim body). The smile moved below the eyes (`cy + 0.55r`, bottom `cy + 0.85r`), still inside the head. Geometry is exported as `hardHatGeometry()` / `faceGeometry()` and covered by tests: eyes below the brim bottom, inside the head circle, bigger than v3.1 — plus a draw-order test that records canvas calls and proves the dome arc is painted before the eye arcs.

**Town is a place, not a pause menu (`src/hub/townHub.ts`, `src/main.ts`).** Brandon's reframe from the v3.1 playtest: the hub was a dimmed overlay (`rgba(8, 8, 14, 0.82)`, avatar showing through at 18%). Now town is a full-screen, opaque screen — solid `#0d0d18` background with a drawn night sky (seeded stars, a moon, a rooftop skyline with lit windows) — and the game is NOT drawn behind it: `main.ts`'s render loop returns early while the hub is open, after fetching the pose frame (so tracking stays warm) and updating the DOM HUD below the canvas (so it names the activity town will return to). No "Pause" label remains in the live UI: the button is **🏠 Town** while playing (set from `main.ts` at startup, and the static `index.html` string says the same) and names the way back while in town (**⛏ Back to the mine** / **🔥 Back to refining** — same label on the hub's own Back button, set by `main.ts` when town opens via `TownHub.setReturnLabel`). Leaving town means picking an activity: **Mine**, **Refiner**, or **Bix's shop** (the Mine spot is new — from the refiner it drops the batch safely and restores the suspended Swing Lab). **Space behaviour, decided:** Space (or Escape) in town returns to the last activity, same as the Back button; Space during play goes to town; Space during an auto-pause goes to town (converts); Escape during play does nothing. The auto-pause (body out of frame) stays a freeze of the activity and never opens town. The internal state machine still calls the kind `manual` (`PauseController`, `PauseKind`) — only the player-facing words changed. The no-hub fallback overlay ("Paused — press Space to resume") is untouched: it only draws when no hub is registered, and then there is genuinely no town.

**Still unverified (needs a real device).** Real-body eye readability at phone size (the fix is geometry + draw order, proven in tests, but the look needs eyes on a real face), the town screen's readability on a real phone screen, the town backdrop at portrait-phone aspect.

**Recipe picker — opaque cards (Worker B, Nov 4, 2026).** The v3.1 chips were translucent (`0.72` / `0.45`) with the avatar showing through, and the gate overlay drew over them. Now one opaque 640×96 card per recipe (stacked from y=140, 16px gap; title y=60, subtitle y=100), solid fills (`#232338` unlocked, `#1a1a2b` locked, `#2e2e4a` selected), each with the input ore image left (56px), output image right, name + `+N XP`, and `2 Ferrite Shale → 1 Refined Ferrite · own 8` (or the lock reason) on line 2. Two-tap flow: tap once selects (gold border + ✓), tap the selected card again to start; returning keeps the last recipe pre-selected; locked cards do nothing. Leave chip is solid too. Geometry lives in pure `pickerCardLayout(width, height)` + `PICKER_CARD` so tests assert it without a canvas.

**One instruction surface (Worker B).** The instruction used to appear three times (canvas banner + canvas mid-stage line + DOM HUD). Now it lives in the HUD only; the canvas keeps just the short phase banner at y=58, 30px (`⛏️ Ready` / `SWING DOWN! ⬇️` / `STRIKE!` / `⛏️ HIT!` in Swing Lab, `🔥 Refined Ferrite` in the refiner). Swing Lab's ready-line + tip merged into one HUD line via pure `swingInstruction(phase, lastEvent)`; the facing hint appends to the HUD instruction. Announcements (`Node broken!`, `Level up! Mining Lv 2!`) and the refiner's batch-complete line replace the phase banner in the same y=58 zone while live. Press progress lives in the HUD only (`🔨 n/3`). The respawn bar moved from the break position (over the legs) to bottom-left (`{x: 12, y: height−38, w: 320, h: 26}`, pure `respawnBarRect`). Floaters (`+15 XP`) moved right of the node with a solid dark pill + gold border. The swing meter moved down (top 140, height 300) and lost its `⬆ UP` label, which sat where the banner runs.

**Gate banner, not overlay (Worker B).** When the body is lost during an activity, the gate is now a small opaque top banner (`drawGateBanner`, y=6, h=34, solid `#1f1f33` + gold border) — no dim, no ghost. Model problems (failed/loading/inference-stopped/stale-frame) keep the full overlay; an empty stage keeps the ghost. Decision helper `shouldShowGateBanner({reason, activityScreenUp})` in `gate.ts`.

**Per-activity gate (Worker B, the sixth fix).** The v3.1 gate required shoulders + hips + knees ≥ 0.5 with 500 ms grace for everything — during refining, reaching side-to-side dipped the far knee and tripped it constantly. Now `GATE_ACTIVITIES` in config: `swing` keeps knees + 500 ms grace (unchanged — the Nov 4 "Body found with knees hidden" finding stands); `refiner-carry` and `refiner-press` need shoulders + hips only, grace 1500 ms; `picker` is `null` — no gate at all while picking (a mouse click needs no body), and the grace clock keeps measuring from the last real usable frame. The stale-frame rule (2000 ms) is untouched. The gate message now names the missing landmarks (`I can't see your knees — step back`) via `missingBodyParts()` / `noBodyMessage()`. Honest gap: `BodyState` carries shoulders/hips/knees visibility only — no wrist/ankle visibility — so the gate enforces the joint sets it can see; wrists are enforced by the grab logic and the press detector. Wiring in `main.ts`: `gateActivity()` maps the active game/phase to a `GateActivity`, `evaluateGate` takes `requirements: gateRequirementsFor(...)`, and the picker hides the DOM body indicator.

**Pile/hopper pulled inward (Worker B, Brandon's idea).** Pile x 0.04w → 0.18w, hopper x 0.72w → 0.58w; centres 0.30w / 0.70w (was 0.16/0.84), y 0.44h unchanged (waist height, no bending). 0.30/0.70 is the furthest inward the zones can go without the bin sitting under the avatar. Reach proof (tested): from a centred stance the nearest shoulder is 0.09 video units from each zone centre vs 0.32 arm length — a short side reach.

**Layout — the page fits the viewport (Worker B).** The Nov 4 frames showed the page scrolling at 1728×1080: the stage formula reserved only 300px for chrome, but real chrome is ~305px and the window is shorter than the screen once browser chrome takes ~100px. Reserve is now 440px (380px fullscreen), HUD 1.25rem → 1.15rem, buttons 1.05rem → 1rem, `overflow-x: hidden` as a safety net, and under 1000px viewport height the tagline hides and the header/legend shrink. Fit is verified by a test that computes from the actual CSS + `index.html`: page height ≤ viewport at 1728×1080, 1728×980, 1280×800, 1024×768.

**Still unverified (needs a real device).** Whether 1500 ms grace + no-knees + inward zones actually stop the gate firing during Brandon's refining reaches; the pile/hopper feel at 0.30w/0.70w; layout on his actual window (viewport height with his browser chrome/zoom is unknown — if it still scrolls, the next datum needed is his actual CSS viewport size).

## Swing Lab v3.3 — avatar polish, banner fix, hub buttons (Nov 4, 2026)

Built from Brandon's v3.2 playtest screenshots (camera on, leaning close; town hub). Three workers in parallel, strict file ownership; coordinator integrated + wired `main.ts`. Verified: 363/363 tests, typecheck + lint clean, build OK, zero absolute path refs in the bundle, all 5 art files in `dist/item-art/`.

**Torso follows the shoulder line (Worker A, `src/render/avatar.ts`).** The v3.2 torso built its top edge as a HORIZONTAL line at the average shoulder Y, so when Brandon leaned, one shoulder sat above the slab and the other below it while the arms sprouted from the real landmarks. Now the top edge runs from the actual leftShoulder landmark to the actual rightShoulder landmark (tilted, following the body), and the waist follows the hip line the same way, tapered to 0.82× hip half-width (was 0.90× — slightly narrower, stops reading as a slab). Geometry lives in pure `torsoGeometry(joints)`, exported for tests.

**Real tank top (Worker A).** The v3.2 straps were thick white capsules drawn diagonally from the shoulders up-inward — they read as white lines crossing the skin. Now the straps are short thin strips ON the shoulder line, shoulder-to-neck, 0.18× shoulder width long, 0.035× torso wide (half the old 0.07), sitting just above the top edge, never crossing the chest centre. The neckline is a scoop CUT INTO the top edge (quadratic dip, 0.09× torso deep, bottoming ~3 px above the chin so it never cuts into the face) — not a skin ellipse stamped on top. The sides curve inward below the shoulders (armhole control points pulled 0.08× shoulder width in) so the arms emerge from visible openings. Head/face code untouched — the v3.2 eyes fix stays exactly as proven.

**Boxers as two cuffs (Worker A).** The v3.2 boxers were one trapezoid across both legs with a straight bottom edge — a red square. Now each thigh gets its own cuff: a pentagon following the hip→knee direction, bottom edge 0.55 of the way down the thigh (same depth as before), 0.13× shoulder width to each side of the thigh axis, meeting at a shared crotch point 0.10 torso below the hip line — so the bottom silhouette is a V notch, not a straight edge. Hearts: two per cuff, on the thigh axis. Draw-order fix this required: both legs now draw BEFORE the bottoms (was: far leg, torso, bottoms, near leg) — with the old order the near leg painted a skin stripe down the middle of the near cuff. Order is now far arm, far leg, torso, near leg, bottoms, near arm, head. Geometry lives in pure `bottomsGeometry(joints)`.

**Gate banner measures at the drawn font (Worker B, `src/render/renderer.ts`).** `drawGateBanner` called `ctx.measureText(message)` BEFORE setting `ctx.font = 700 20px ...`, so the pill was sized for whatever font the previous draw left behind and the text overflowed it ("I can't see your knees — ste" in Brandon's screenshot). Fixed: font (and align/baseline) set first, then measure. `gateBannerRect` math was fine and is untouched. Audit found no other measure-before-font instances (`debug/hud.ts` and the swing floater both set font before measuring). Rule for the future: **set the font before you measure** — a regression test with a recording context proves `measureText` is called after the font is set to the drawn font and the pill fits the drawn-font width.

**Hub buttons that look like game UI (Worker C, `src/hub/townHub.ts`).** `drawButton` was a flat solid (`#171724`, or a translucent gold tint over the dark background — exactly why they read as muddy brown) with a 2–3px stroke. Now one shared painter, `paintButton`, used by the hub and the refiner's Leave chip: opaque vertical gradient + a 4px darker lip at the base + rounded corners (radius 12) + soft drop shadow. Hierarchy: **primary** (Mine / Refiner / Bix, Sell-all) is big gold (`#ffcf5c → #dd9a1d`, border `#8a5a00`, dark text `#241a05`); **secondary** (Back buttons, Sell 1) is muted slate (`#34344e → #1e1e33`, border `#5a5a80`); **destructive** (Reset save) is small and red-tinted (`#4a232b → #33161d`, border `#8a4a55`, text `#f2a8b0`, 240×40, armed label "⚠️ Tap again to confirm") — it used to carry the same visual weight as Back, which is wrong for a wipe-your-save button. Icons lead the label (emoji at `fontPx + 8`, centred as a group with the text). Hover brightens (gold `#ffe08a → #f2b53e`, bigger shadow); pressed sinks 2px with the shadow removed. Wiring in `main.ts` (coordinator): while the hub is open, `pointermove` → `townHub.handlePointerMove`, `pointerdown` → `handlePointerDown`, `pointerup` → `handlePointerUp` (activates on release over the same button, cancels on release elsewhere); `pointerleave` clears the hover. A tap is down + up — the old test helper that dispatched only `pointerdown` was updated, and a new integration test proves down-alone never activates and release-off cancels. The refiner Leave chip uses the same painter (secondary style) but has no hover/pressed state — the refiner has no pointermove path.

**Lumberjack is not coming soon (Worker C).** The hub's `COMING_SOON` listed Combat and Lumberjack. Lumberjack is NOT a RuneSweat skill (Brandon's standing decision: no lumberjacking in v1). Removed; Combat stays as the only coming-soon line (Slice 2). The parked vision doc (`docs/vision-lumberjack.md`) is untouched — it is history, not a roadmap item.

**Skyline clear zone (Worker C).** The rooftop skyline's lit windows peeked out at the bottom buttons' edges. Houses keep their 36–84px heights, but a window is dropped when it would intersect any bottom button rect (`skylineLayout` + `bottomButtonRects` are the single source of truth for the renderers and the skyline).

**Still unverified (needs a real device).** The avatar on a real leaning body at phone size (scoop/straps/cuffs are geometry-proven against synthetic fixtures, but whether they read as a tank top and shorts on Brandon's actual body needs a screenshot); the buttons on a real screen at phone size (the armed Reset label is sized by estimate, not measured on a real canvas); the banner's exact pill width against the real Baloo 2 font (the test proves the ordering bug is gone, not pixel-perfect width); narrow-portrait layout (~390px: Back 320px and Reset 240px would overlap — a pre-existing issue, not changed by this slice).

## RuneSweat v3.4 — pedestal press replaces the star jumps, version display, Lumberjack out of the registry (Nov 4, 2026)

Two workers in parallel (Worker A: detector/machine/config/gate; Worker B: game/sim/wiring/docs), plus two additions from Brandon folded into the same slice. Verified: typecheck + full suite + build (counts in the final report).

**Why the press.** The Nov 4 playtest proved the star jump unplayable for Brandon: he is too tall for his room, so he cannot jump without his head/hands leaving the frame — a textbook star shape (hopper 2/2, 13 s clip) counted 0/3, and hands meeting overhead kept tripping the handedness-latch flip. The press needs arms only: no vertical space, no legs, hands stay separated. Two pedestals slide up either side of the avatar when the hopper fills; both wrists on the buttons + a downward push, held 300 ms, counts one press; 3 presses forge the bar.

**Pedestal press (Worker A: `src/core/pressDetector.ts`, `PRESS`; Worker B: `src/games/refiner/refiner.ts`).** Detector: `pressButtonZones(hipMidX, hipMidY, torsoLength)` — centres at hip-mid ±0.8 torso, top at hip − 0.15 torso, 0.5 × 0.4 torso — pure, so the game renders the same zones it detects against. `PressDetector.update(...)` fires one event per hold (both wrists in zones + downward motion at some point in the hold + 300 ms hold); re-arms when a wrist leaves its zone, plus a 500 ms minimum interval. `progress(...)` is the mean of (left in, right in, hold elapsed / 300 ms), for live feedback. Machine: phase `'pressing'` (was `'jumping'`), snapshot `pressesDone`, event `'press'` (`Press n/3!`), input `press: boolean`, hint `Hopper full! Press both buttons down — 3 presses to forge the bar!`. Config: `REFINER.pressesPerBatch = 3`, `PRESS = { holdMs: 300, minIntervalMs: 500, buttonOffsetTorsoFrac: 0.8, buttonZoneWTorsoFrac: 0.5, buttonZoneHTorsoFrac: 0.4, buttonZoneTopOffsetTorsoFrac: -0.15, slideMs: 400, pressDepthTorsoFrac: 0.12 }`, `GATE_ACTIVITIES` key `'refiner-press'` (same values as the old `'refiner-jump'`: no knees, 1500 ms grace). Game: feeds the detector only while phase is `'pressing'` AND the pedestals are fully up (slide-in 400 ms); draws the pedestals after the pile/hopper and before the Leave chip (narrower columns, 60% of button width, so they cover less of the pile/hopper behind them — the buttons sit at waist height where the hands rest, so they overlap the pile/hopper edges on screen); the button sinks as the hold progresses (from `pressProgress` 2/3 to 1); the forging bar in the hopper squashes one step per press (full → 2/3 → 1/3 height); HUD `🔨 n/3`. Hip-mid comes from `BodyState.torsoX`/`torsoY` (the smoothed hip-midpoint — there are no per-hip landmark fields). `src/core/starJump.ts` deleted.

**Mouse-sim press (Worker B, `src/sim/mouseSource.ts`).** `X` (legs wide) is gone with the star jumps. `P` (hold) presses both buttons: wrists animate out to hip-mid ±0.8 torso at the hip line, then push down to hip line + 0.12 torso over 240 ms total (the push half runs at ~1 torso length/s, a deliberate downward move the detector reads — not a teleport). `W` jump stays as a general sim capability, it is just no longer the refiner's input. `F` was considered for the press and rejected: it is the fullscreen toggle. Full batch is sim-playable, proven by a test (grab ×2, drop ×2, 3 P presses → +1 refined, +15 XP). Sim artifact, documented in the test: the sim's hanging wrists rest just inside the button zones (0.330 vs the 0.335 edge), so between presses the test clasps `A`+`D` to pull the hands to the centre and re-arm the detector — a real player's hanging hands sit well inside the zones' inner edge (~0.4 vs 0.55 torso), so real play re-arms by lowering the hands.

**Version display (Brandon's ask).** He could not tell which build he was on when he refreshed, and Pages serves the HTML with `Cache-Control: max-age=600`, so a stale page can linger ~10 minutes after a deploy. Single source of truth: `package.json` `version` (bumped to `3.4.0`), read directly by `src/core/version.ts` (`VERSION`, `versionLabel()` → `RuneSweat vX.Y.Z`) — no mirror constant, so it cannot drift. Displayed on the game-select screen (`#app-version` in `index.html`, filled by `main.ts` at boot) and in the Town Hub (canvas-drawn top-left, `(12, 12)`, on both the main and shop screens). Tests: `version.test.ts` (valid semver, matches `package.json`), `main.test.ts` (select-screen text matches the single source), `townHub.test.ts` (hub draws the label at top-left). Release process: bump the version in `package.json`, build, deploy. Display only — no update-check machinery.

**Lumberjack out of the registry.** The v3.3 fix removed Lumberjack from the hub's `COMING_SOON` list, but the game-select screen OUTSIDE the canvas still showed a Lumberjack "Coming soon" card: `config.ts` still had the disabled registry entry and `main.ts` renders every registry entry as a card. Removed the entry (and its blurb in `main.ts`); the select screen now shows one card (Swing Lab). The parked vision doc (`docs/vision-lumberjack.md`) stays — history, not a game.

**Still unverified (needs a real device / Brandon).** Real-body press feel (are the buttons at a comfortable height? does the press read on a real camera?); the pedestal buttons overlapping the pile/hopper edges on screen (they sit at waist height where the hands rest — check the look on a real frame); whether the version label reads on the hub at phone size; the Pages cache behaviour after a deploy (does the version actually change on refresh within ~10 minutes?).

## RuneSweat v3.5 — pedestals close to the body, fist-sized buttons (Nov 5, 2026)

**Why.** Brandon playtested the v3.4 press on camera: "yeah its bad lol. i was thinking the pedestals would pop up closer to my body so i can reach em, way smaller buttons, etc." Verified from frames: the v3.4 pedestals were two giant gold slabs at the far bottom corners (~1/4 of the stage width each), below and far out from the avatar — his hands hung at his sides nowhere near them, and the slabs covered the top edge of the "Leave to town" chip and the bottom of the "Hopper: 2/2" label. There was no distinct button — the whole slab WAS the button. Worse, the drawn slabs were bigger than the detection zones, so the render and the detector disagreed.

**The numbers (Worker A).** `PRESS`: `buttonOffsetTorsoFrac` 0.8 → **0.55**, `buttonZoneWTorsoFrac` 0.5 → **0.25**, `buttonZoneHTorsoFrac` 0.4 → **0.2**, `buttonZoneTopOffsetTorsoFrac` −0.15 → **+0.02**; hold 300 ms, min interval 500 ms, slide 400 ms, `pressDepthTorsoFrac` 0.12 unchanged. Anchored to a measurement, not a guess: the sim's hanging wrists rest at hip-mid ±0.567 torso, hip + 0.048 torso, so the resting wrist lands ~0.005 torso off the zone centre and just below the zone top, with a 0.1-torso push fitting inside the zone. At 960×540 (hip-mid 0.5/0.55, torso 0.3) each pad is 72 × 32.4 px.

**The render (Worker B).** `pedestalRectsForStage()` renders from `pressButtonZones()` unchanged — the rendered pad IS the detection zone, one source, no hard-coded numbers in the render path. The pedestal is a slim post, 65% of pad width (46.8 px), centred under the pad, running to the stage bottom; the pad reads as a button at small size (gold pad + dark edge + a lighter-gold face strip across the top). The sink is capped at half the pad height, so the 0.12-torso press depth (19.4 px) never swallows the 32.4 px pad (cap: 16.2 px). The pile/hopper labels moved above their zones (the full-height posts would have crossed a label below them). Overlap margins at 960×540: button↔torso 16.8 px each side, post↔torso 29.4 px, pile-label bottom↔button top 63.6 px, Leave chip↔left post 66.2 px — no intersections, proven by a test.

**The sim retarget (coordinator).** The v3.4 sim hard-coded the button offset (±0.8) as a file-local constant in `mouseSource.ts`, so after the zone shrink the sim pressed thin air outside the zones and the batch could never complete (this is exactly the 3 failures Worker B reported: 2 refiner + 1 `main.test.ts` sim-batch). The sim now reads offset, zone top, and depth from `PRESS`, and the first-half animation target moved from the hip line to the zone top. Lesson written into the docs: sim targets and detector zones share one source, or they drift.

**Verified.** 388/388 tests (was 379; 9 net new: 4 detector, 5 refiner/sim), typecheck + lint clean, build OK, zero absolute path refs in the bundle, all 5 art files in `dist/item-art/`, version bumped to `3.5.0` (single source, shows on the select screen + hub).

**Still unverified (needs a real device / Brandon).** Real-body press feel at the new size/height (is a 72×32 px pad at hip height a comfortable push, or too small?); whether the buttons sit at Brandon's actual resting hand height (the numbers are anchored to the sim's hanging wrists, not a measured real body — his hands may hang higher/lower or narrower/wider); re-arm between presses on a real body (the hanging wrists rest just inside the zones, so presses 2 and 3 need a small lift out of the zone — confirm it doesn't take an exaggerated lift); the pedestals on a real camera frame (button↔torso margin is only 16.8 px on the sim body — a broader-shouldered real body could touch it); the version label at phone size.

**Still unverified (needs a real device / Brandon).** Real-body press feel (are the buttons at a comfortable height? does the press read on a real camera?); the pedestal buttons overlapping the pile/hopper edges on screen (they sit at waist height where the hands rest — check the look on a real frame); whether the version label reads on the hub at phone size; the Pages cache behaviour after a deploy (does the version actually change on refresh within ~10 minutes?).
