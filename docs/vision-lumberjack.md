# Vision: Lumberjack — active RuneScape / RuneSpace

> PARKED. Not built in v1. This doc is the parking lot so the idea doesn't
> get lost and doesn't get half-built by accident.
>
> RuneSweat note: this parked vision is where RuneSweat's pickaxe swing came
> from — the chop mechanic, retargeted from trees to ore. The Lara framing
> below is historical; RuneSweat's player is Brandon (and later, everyone).

## The dream (Brandon, Nov 4, 2026)

A game where Lara swings her body like she's chopping a tree, controlling
a little cute lumberjack SVG that swings and chops down trees — XP + wood
per chop — then whittles with her hands, or mimes using a hammer on a
different screen to craft items, unlocking higher-level trees and items,
with mining and better tools on top. Like an active RuneScape. Or
RuneSpace, if we run with our own IP.

## Why it fits this framework

Every input it needs is already (or nearly) in `BodyState`:

| Action | Body signal | Status in v1 |
|---|---|---|
| Chop swing | torso twist + arm swing arc (shoulder angle sweeping down) | NEW — needs a swing detector (angle velocity + direction change) |
| Chop impact | arm reaching the bottom of the swing | NEW — part of the swing detector |
| Whittle | small hand circles / finger movement near the chest | NEW — needs hand landmarks at close range; PoseLandmarker gives 17-22 hand points but coarse |
| Hammer mime | arm raising and bringing down in a short arc | Reuse swing detector with a smaller arc |
| Walk to a new tree | torsoX / stepping in place | Reuse torsoX + jump/duck |
| Mining | same swing, different tool + rock target | Reuse swing detector |

The framework's job for this game is one new module: a **swing detector**
in `core/` that consumes the `BodyState` arm-angle stream and emits
discrete `SWING` events with a power (peak angular velocity). Everything
else — XP, wood, unlocks, crafting screens — is game logic on top of the
same `Game` interface.

## Game sketch (not a spec — to be designed with Lara)

- **Chop:** each full swing that lands = one chop. Tree has HP by level
  (normal tree 3 chops, oak 8, ...). Wood + XP per chop, bonus for a
  "perfect" swing (full arc, good tempo).
- **Whittle / craft:** after chopping, a crafting screen: mime the tool
  (sawing = arm back-and-forth, hammering = short down-swings) to turn
  wood into items. Items unlock by level, RuneScape-style.
- **Progression:** higher trees need a better axe; better axe needs
  wood + crafted parts; mining unlocks metal for the axe. The loop is
  RuneScape's, the input is the body.
- **IP:** RuneSpace if we want our own world (lumberjack on Skatboll?);
  the mechanics don't care. Decide when the game is real, not now.

## What must be proven first (before building this)

1. The swing detector works for a 5-year-old's swing — big, loose,
   inconsistent arcs. If it only works for crisp adult swings, the game
   is frustrating, not fun.
2. A full session (10+ minutes of swinging) is physically fun, not
   tiring. Playtest with Lara before any progression design.
3. Hand-mime crafting reads reliably at living-room distance. If the
   hand landmarks are too noisy that far away, crafting becomes arm-mime
   instead — decide from evidence, not from the sketch.

## Explicitly not decided

- RuneScape vs RuneSpace IP.
- Any economy, trading, or multiplayer.
- Whether whittling uses hand landmarks or arm mimes.

## Follow-on: Active RuneSpace (Brandon, Nov 4, 2026)

If the Lara pose version works, the next step is a single-player active
RuneSpace on this same pose framework — NOT a second framework. Reuse
RuneSpace assets/dialogue for quests; skills Mining / Refining /
Fabrication / Welding (no lumberjacking — that's the lumberjack game
above); daily + weekly missions; premium currency for upgrades; outfits
that render on the skeleton body with per-activity loadouts/bonuses.
Combat: a swing is an attack with damage at the swing point, monsters
swing back on a timer, no standing still getting hit forever, no
swing-spam (cooldown / full-arc / stamina gate). Differentiator vs
GymScape (camera rep-counting: pushups = hits, steps mine/chop): a full
RPG loop with crafting/quests/outfits, not just rep counting. Planning
page: "Active RuneSpace — Planning" in Notion under jellybean HQ
(ID 40e2a9ef-9db2-8178-b848-f2fc7b642929), separate from RuneSpace canon.

**Gate: the Lara pose version must work first.** Nothing here is built
until the v1 playtest with Lara says the framework is fun.
