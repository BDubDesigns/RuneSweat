/**
 * Swing Lab — Active RuneSpace Mining prototype (Slice 1).
 *
 * One ore node on screen, one mechanic: a pickaxe swing is a hit. The
 * miner is the player's own live avatar (drawn by the hub) plus a
 * pickaxe anchored at the wrists. Raise both arms overhead (windup),
 * chop down fast through waist level (strike) — the node cracks, an ore
 * pops out, +Mining XP. Five hits break the node and a new one spawns.
 *
 * v3 (Nov 4, 2026, second playtest): the node is a real RuneSpace ore
 * node — the copied `boulder.webp` rock with the active tier's ore
 * crystals embedded — and the mines follow RuneSpace's own tiers
 * (`tiers.ts`, sourced from RuneSpace `game/config/balance.ts`): Ferrite
 * Shale at The Jag (Mining 1, 15 XP/hit) now, Galvanite at Deep Jag
 * (Mining 5, 25 XP/hit) locked until Mining 5. Every hit drops the real
 * ore image, which flies toward the Ore counter.
 *
 * The game owns only its simulation + canvas drawing + HUD string. It
 * never touches landmarks for gameplay: the swing is decided by
 * `SwingMachine` from `BodyState` only. All tuning lives in `SWING`
 * (`core/config.ts`); tier values live in `tiers.ts`.
 */

import { RENDER, STAGE, SWING } from '../../core/config';
import type { SoundEffects } from '../../core/audio';
import { assetUrl } from '../../core/assetUrl';
import type { BodyState } from '../../core/bodyState';
import { inventory } from '../../core/inventory';
import { clamp, toCanvas } from '../../render/stage';
import type { NormalizedLandmark } from '../../tracking/poseTypes';
import type { Game } from '../game';
import {
  SwingMachine,
  type SwingEvent,
  type SwingHandedness,
  type SwingPhase,
  type SwingSnapshot,
} from './swingMachine';
import {
  DEFAULT_TIER_ID,
  MINING_TIERS,
  tierById,
  tierLockMessage,
  tierUnlocked,
  type MiningTier,
} from './tiers';

/** Mining level for total XP: 100 XP per level, starting at level 1. */
export function miningLevel(xp: number): number {
  return Math.floor(Math.max(0, xp) / SWING.xpPerLevel) + 1;
}

/** XP earned inside the current level (0..xpPerLevel-1). */
export function xpIntoLevel(xp: number): number {
  return Math.max(0, xp) % SWING.xpPerLevel;
}

/** Crack lines drawn on the node for `hits` hits on it (max 3). */
export function cracksForHits(hits: number): number {
  return Math.min(3, Math.max(0, hits));
}

/**
 * Start loading one art file (base-relative via `assetUrl`, never a
 * leading slash — see `core/assetUrl.ts`). Returns `null` where the
 * environment has no `Image` (node tests): callers treat that as "not
 * loaded" and draw the fallback. A failed load also stays not-loaded.
 */
function loadImage(relativePath: string): LoadedImage | null {
  if (typeof Image === 'undefined') return null;
  const img = new Image();
  const entry: LoadedImage = { img, loaded: false };
  img.onload = () => {
    entry.loaded = true;
  };
  img.onerror = () => {
    entry.loaded = false;
  };
  img.src = assetUrl(relativePath);
  return entry;
}

/** The tier with this id, or the first tier if it is missing (never undefined). */
function requireTier(tierId: string): MiningTier {
  const tier = tierById(tierId);
  if (tier !== undefined) return tier;
  const first = MINING_TIERS[0];
  if (first === undefined) {
    throw new Error('swing-lab: MINING_TIERS is empty');
  }
  return first;
}

/**
 * Node radii for a stage: the v3 node is bigger and wider than v2's
 * circle (v2: radius 0.15 * min(w, h) both ways, so 0.30 wide and tall).
 * v3 is an ellipse 0.44 wide x 0.34 tall (fractions of min(w, h)) — the
 * rock reads as a boulder, not a ball.
 */
export function nodeRadiiForStage(
  width: number,
  height: number,
): { rx: number; ry: number } {
  const m = Math.min(width, height);
  return { rx: m * 0.22, ry: m * 0.17 };
}

/** Front-center node geometry: centre + radii, canvas space. */
export interface NodeGeometry {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/**
 * Front-center node position, derived from the body's canvas hip
 * position (Nov 4, 2026 playtest redesign): the node sits directly in
 * front of the avatar at chair/waist height, so the rock you chop
 * occludes the avatar's waist and below. `x` is the hip-centre canvas
 * x; the TOP of the rock sits just below the hips (v3: the centre is
 * 1.15 radii below the hips, so the top is 0.15 radii below them — the
 * rock covers the legs more than v2 did without covering more upper
 * body; v2's top sat half a radius ABOVE the hips). No body: centred
 * on the stage, waiting for a miner.
 */
export function nodeCenterForBody(
  body: BodyState | null,
  width: number,
  height: number,
): NodeGeometry {
  const { rx, ry } = nodeRadiiForStage(width, height);
  if (body === null || !body.present) {
    return { x: width / 2, y: height * 0.62, rx, ry };
  }
  const hip = toCanvas(
    { x: body.torsoX, y: body.torsoY, visibility: 1 },
    width,
    height,
  );
  return { x: hip.x, y: hip.y + ry * 1.15, rx, ry };
}

/**
 * Respawn bar rect for a stage (v3.2): bottom-left, 320 x 26, 12 px
 * from the left edge and 38 px from the bottom. Clear of the avatar
 * (centre), the tier chips (bottom-right, x >= width - 342) and the
 * swing meter's DOWN label (y = top + h + 28 = 468 on a 540 stage).
 * Pure, so tests can assert the zone without a canvas.
 */
export function respawnBarRect(
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  void width;
  return { x: 12, y: height - 38, w: 320, h: 26 };
}

/**
 * Pickaxe anchor + handle direction for a body, canvas space. The
 * pickaxe is gripped in the RIGHT hand at all times: the anchor is the
 * right wrist (mirrored through `toCanvas`), and the handle runs along
 * the right forearm (shoulder->wrist direction, from the right arm's
 * angle — unclamped, so an arm hanging down points the head down and an
 * arm raised overhead points it up).
 */
export function pickaxeAnchorForBody(
  body: BodyState,
  width: number,
  height: number,
): { x: number; y: number; dirX: number; dirY: number } {
  const anchor = toCanvas(
    { x: body.rightWristX, y: body.rightWristY, visibility: 1 },
    width,
    height,
  );
  const rad = (body.rightArm.angleDeg * Math.PI) / 180;
  return {
    x: anchor.x,
    y: anchor.y,
    dirX: -Math.sin(rad),
    dirY: -Math.cos(rad),
  };
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  untilMs: number;
  color: string;
  /** Draw radius in px (4 = sparkle, 5-9 = debris chip). */
  size: number;
}

/**
 * One chunk of a broken node: it arcs out of the rock, tumbles, falls
 * with gravity off the bottom of the canvas, and is disposed of once
 * off-screen or past its lifetime — never left accumulating.
 */
interface NodePiece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  rotV: number;
  size: number;
  untilMs: number;
  color: string;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  untilMs: number;
}

/**
 * One ore popping out of the node on a hit: it arcs out of the rock and
 * flies toward the Ore counter in the HUD (bottom-left of the stage),
 * shrinking and fading as it goes. `tierId` is the tier it came from, so
 * the drop draws that tier's real ore image.
 */
export interface OreDrop {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startMs: number;
  durationMs: number;
  tierId: string;
}

/** How long one ore drop flies, in ms. */
export const ORE_DROP_MS = 800;

/**
 * Node break lifecycle (v3). Values live in `SWING` in `config.ts` (the
 * SSOT); this object just renames them for the game code.
 */
export const BREAK = {
  /** Respawn wait after a break: the progress bar fills over this long. */
  respawnMs: SWING.breakRespawnMs,
  /** The new node fades in over this long once the wait completes. */
  fadeInMs: SWING.breakFadeInMs,
  /** Rock pieces fly for this long before they are disposed of. */
  pieceLifetimeMs: SWING.breakPieceLifetimeMs,
  /** Pieces one broken node splits into. */
  pieceCount: SWING.breakPieceCount,
  /** Debris chips thrown off by every counted hit. */
  debrisPerHit: SWING.breakDebrisPerHit,
  /** Debris chips live this long (ms). */
  debrisLifetimeMs: SWING.breakDebrisLifetimeMs,
  /** Hit shake: harder than v2's 150 ms / 5 px, so a hit feels like a hit. */
  shakeMs: SWING.breakShakeMs,
  shakePx: SWING.breakShakePx,
} as const;

/** Preloaded art, or `null` where the browser has no `Image` (tests). */
interface LoadedImage {
  img: HTMLImageElement;
  loaded: boolean;
}

/**
 * Pure: screen-shake offset for `nowMs`, in canvas px.
 *
 * Root cause of the v3 "HUD stays jangled" complaint: the shake was a
 * constant-amplitude random offset that cut to zero the frame the shake
 * ended, and the HUD text was drawn inside the same transform — so
 * during active play (a hit every couple of seconds) the meter, phase
 * text and chips were almost always jangled. This helper decays the
 * amplitude linearly to exactly (0, 0) at `shakeUntilMs` — the last
 * shaken frames are already (near-)centred, so there is no snap — and
 * returns exactly (0, 0) once the shake is over. `render()` also draws
 * the HUD outside the shake transform, so the HUD never moves at all.
 * `rand` is injectable so tests can pin the offset; render passes the
 * default (`Math.random`).
 */
export function shakeOffsetPx(
  nowMs: number,
  shakeStartMs: number,
  shakeUntilMs: number,
  shakeAmpPx: number,
  rand: () => number = Math.random,
): { x: number; y: number } {
  if (
    nowMs < shakeStartMs ||
    nowMs >= shakeUntilMs ||
    shakeUntilMs <= shakeStartMs
  ) {
    return { x: 0, y: 0 };
  }
  const remaining = (shakeUntilMs - nowMs) / (shakeUntilMs - shakeStartMs);
  const m = shakeAmpPx * remaining;
  return { x: (rand() * 2 - 1) * m, y: (rand() * 2 - 1) * m };
}

/** Read-only snapshot of the live state, for the debug HUD and tests. */
export interface SwingLabSnapshot {
  ore: number;
  xp: number;
  level: number;
  xpIntoLevel: number;
  nodeHits: number;
  swings: number;
  nodesBroken: number;
  cracks: number;
  phase: SwingPhase;
  lastEvent: SwingEvent | null;
  lastHandedness: SwingHandedness | null;
  particles: number;
  /** The mine being worked right now (`tiers.ts` id). */
  tierId: string;
  /** Display name of the active tier (`'Ferrite Shale'`). */
  tierName: string;
  /** Weak-swing detail from the machine (measured reject reason), or null after a hit. */
  lastWeakDetail: string | null;
  /** Ore drops currently flying toward the Ore counter. */
  oreDrops: number;
  /** True while the node is gone between break and respawn. */
  nodeGone: boolean;
  /** Respawn progress 0..1 (1 = node present). */
  respawnProgress: number;
  /** Rock pieces currently falling from a broken node. */
  nodePieces: number;
}

/**
 * Canvas phase banner (v3.2): a SHORT phase signal at the top of the
 * stage (y 58), never the instruction sentence. The instruction lives
 * in the HUD only (`swingInstruction`) — in v3.1 the ready line AND
 * the tip AND the ghost-arc text all overlapped at the top of the
 * stage (t4), and the 34 px ready sentence was wider than the stage.
 */
const PHASE_LINES: Record<SwingPhase, string> = {
  ready: '⛏️ Ready',
  windup: 'SWING DOWN! ⬇️',
  strike: 'STRIKE!',
  recover: '⛏️ HIT!',
};

/**
 * The instruction for a phase — the single instruction surface, shown
 * in the HUD (`hudHtml`) and nowhere on the canvas. Ready + tip are
 * merged into one line (v3.2): the tip ("hands together overhead,
 * then chop straight down") only restated the ready line.
 */
export function swingInstruction(
  phase: SwingPhase,
  lastEvent: SwingEvent | null,
): string {
  switch (phase) {
    case 'ready':
      return 'Both hands up together, then chop down in front of you!';
    case 'windup':
      return 'Chop straight down in front of you — through waist height!';
    case 'strike':
      return 'Chop through to the node!';
    case 'recover':
      if (lastEvent !== null && lastEvent.kind === 'hit') {
        return `${HANDEDNESS_LABELS[lastEvent.handedness]} Hands up for the next swing!`;
      }
      return 'Hands up for the next swing!';
  }
}

const HANDEDNESS_LABELS: Record<SwingHandedness, string> = {
  'two-handed': 'Two-handed!',
  left: 'Left arm!',
  right: 'Right arm!',
};

export class SwingLabGame implements Game {
  public readonly id = 'swing-lab';
  public readonly title = 'Swing Lab';
  public paused = false;

  private readonly sfx: SoundEffects;
  private readonly machine = new SwingMachine();

  private ore = 0;
  private xp = 0;
  private nodeHits = 0;
  private swings = 0;
  private nodesBroken = 0;
  private lastHandedness: SwingHandedness | null = null;
  private lastSnapshot: SwingSnapshot | null = null;
  private prevPhase: SwingPhase = 'ready';

  private shakeUntilMs = 0;
  /** ms the current shake started at (0 = no shake running). */
  private shakeStartMs = 0;
  private flashUntilMs = 0;
  private breakBannerUntilMs = 0;
  private levelBannerUntilMs = 0;
  private lastWidth: number = STAGE.width;
  private lastHeight: number = STAGE.height;
  /** Latest body, for the front-center node position (see nodeCenter). */
  private lastBody: BodyState | null = null;
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  /** Ore drops currently flying from the node to the Ore counter. */
  private oreDrops: OreDrop[] = [];
  /** Rock chunks of a broken node, still falling (disposed off-screen). */
  private nodePieces: NodePiece[] = [];
  /**
   * ms the node broke at (0 = never / node present). The node is gone
   * until `breakAtMs + BREAK.respawnMs`, then fades back in.
   */
  private breakAtMs = 0;
  /** Latest clock reading, so `snapshot()` can report gone/progress. */
  private lastNowMs = 0;
  /** Current screen-shake amplitude in px (bigger right after a hit). */
  private shakeAmpPx = SWING.shakePx * 2;
  /** The mine being worked; Ferrite Shale until the player picks another. */
  private activeTier: MiningTier = requireTier(DEFAULT_TIER_ID);
  /**
   * The mine-selector chips drawn on the canvas (bottom-right), with
   * their canvas-space hit rects, recomputed every render. `pointerDownAt`
   * reads these, so a tap on a chip switches mines.
   */
  private chipRects: { x: number; y: number; w: number; h: number; tierId: string }[] =
    [];
  /** True once the canvas pointer listener is attached (render attaches it). */
  private pointerListenerAttached = false;
  /** The canvas the game is currently rendering into, for pointer math. */
  private lastCanvas: HTMLCanvasElement | null = null;
  /**
   * RuneSpace art, preloaded once: the boulder rock face + one ore image
   * per tier. A missing/failed image leaves `loaded` false and the game
   * draws the fallback instead — never a broken image, never a crash.
   * `null` in environments without `Image` (node tests): everything
   * falls back to drawn shapes there.
   */
  private readonly boulderImage: LoadedImage | null;
  private readonly oreImages = new Map<string, LoadedImage>();

  public constructor(sfx: SoundEffects) {
    this.sfx = sfx;
    this.boulderImage = loadImage('item-art/boulder.webp');
    for (const tier of MINING_TIERS) {
      const image = loadImage(tier.oreImage);
      if (image !== null) this.oreImages.set(tier.id, image);
    }
  }

  /**
   * Switch mines. A locked tier (level too low) stays put and shows its
   * lock message as a floater instead; switching to a new mine starts a
   * fresh node (cracks reset). Returns false when nothing changed.
   */
  public selectTier(tierId: string, nowMs: number): boolean {
    const tier = tierById(tierId);
    if (tier === undefined) return false;
    if (!tierUnlocked(tier, miningLevel(this.xp))) {
      const pos = this.floaterPos();
      this.floaters.push({
        x: pos.x,
        y: pos.y,
        text: `🔒 ${tierLockMessage(tier)}`,
        untilMs: nowMs + SWING.floaterMs,
      });
      return false;
    }
    if (tier.id === this.activeTier.id) return true;
    this.activeTier = tier;
    this.nodeHits = 0;
    // The ore counter follows the mine: it shows what you own of the
    // newly selected tier (the store holds every tier separately).
    this.ore = inventory.count(tier.id);
    return true;
  }

  /**
   * Canvas-space pointer tap (the canvas listener converts client
   * coordinates and calls this). A tap on a mine-selector chip switches
   * mines; anywhere else does nothing.
   */
  public pointerDownAt(x: number, y: number, nowMs: number): boolean {
    for (const chip of this.chipRects) {
      if (x >= chip.x && x <= chip.x + chip.w && y >= chip.y && y <= chip.y + chip.h) {
        return this.selectTier(chip.tierId, nowMs);
      }
    }
    return false;
  }

  public start(): void {
    this.reset();
    this.paused = false;
  }

  public stop(): void {
    this.paused = true;
    if (
      this.lastCanvas !== null &&
      this.pointerListenerAttached &&
      typeof this.lastCanvas.removeEventListener === 'function'
    ) {
      this.lastCanvas.removeEventListener('pointerdown', this.handlePointerDown);
      this.pointerListenerAttached = false;
    }
  }

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    this.paused = false;
  }

  public restart(): void {
    this.reset();
    this.paused = false;
  }

  public update(
    dtMs: number,
    nowMs: number,
    body: BodyState | null,
    _landmarks: readonly NormalizedLandmark[] | null,
  ): void {
    if (this.paused) return;
    const dtSec = dtMs / 1000;
    this.lastBody = body;
    this.lastNowMs = nowMs;

    const event = this.machine.update(body, nowMs);
    const phase = this.machine.currentPhase;
    if (phase === 'strike' && this.prevPhase !== 'strike') {
      this.sfx.whoosh();
    }
    this.prevPhase = phase;
    this.lastSnapshot = this.machine.snapshot();

    if (event !== null) this.applyEvent(event, nowMs);
    this.updateParticles(dtSec, nowMs);
    this.updatePieces(dtSec, nowMs);
    this.oreDrops = this.oreDrops.filter(
      (drop) => nowMs < drop.startMs + drop.durationMs,
    );
    this.floaters = this.floaters.filter((f) => nowMs < f.untilMs);
    // The wait + fade-in are done: forget the break, the node is back.
    if (
      this.breakAtMs !== 0 &&
      nowMs >= this.breakAtMs + BREAK.respawnMs + BREAK.fadeInMs
    ) {
      this.breakAtMs = 0;
    }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    nowMs: number,
    body: BodyState | null,
    _landmarks: readonly NormalizedLandmark[] | null,
  ): void {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    this.lastWidth = width;
    this.lastHeight = height;
    this.lastBody = body;
    this.lastNowMs = nowMs;
    this.attachPointerListener(ctx.canvas);
    const snap = this.lastSnapshot ?? this.machine.snapshot();
    const gone = this.nodeGone(nowMs);

    ctx.save();
    // Screen shake (v3.1): the WORLD shakes — node, particles, pieces,
    // drops, pickaxe, floaters — and the offset decays to exactly (0, 0)
    // when the shake ends (see shakeOffsetPx). The HUD below is drawn
    // AFTER the restore, outside the shake transform, so the meter,
    // phase text, tier chips, banners and respawn bar never move.
    const shake = shakeOffsetPx(
      nowMs,
      this.shakeStartMs,
      this.shakeUntilMs,
      this.shakeAmpPx,
    );
    ctx.translate(shake.x, shake.y);

    if (!gone) {
      // The respawned node fades in from transparent over BREAK.fadeInMs.
      ctx.save();
      ctx.globalAlpha = this.nodeFadeAlpha(nowMs);
      this.drawNode(ctx);
      ctx.restore();
    }
    this.drawParticles(ctx);
    this.drawNodePieces(ctx, nowMs);
    this.drawOreDrops(ctx, nowMs);
    this.drawPickaxe(ctx, body, width, height);
    this.drawFloaters(ctx, nowMs);
    ctx.restore();

    // HUD — never shaken.
    this.drawSwingMeter(ctx, snap, nowMs);
    this.drawTierChips(ctx, width, height);
    this.drawPhaseText(ctx, snap, width, nowMs);
    if (snap.phase === 'ready' && this.swings === 0) {
      this.drawGhostArc(ctx, width, height);
    }
    this.drawBanners(ctx, nowMs, width);
    if (gone) this.drawRespawnBar(ctx, nowMs);
  }

  /**
   * The canvas pointer listener, attached once from render (the game has
   * no canvas reference before the first frame). Taps on the mine-selector
   * chips switch mines; everything else is ignored. Guarded for stub
   * contexts in tests, which have no `addEventListener`.
   */
  private attachPointerListener(canvas: HTMLCanvasElement): void {
    if (this.pointerListenerAttached) return;
    this.lastCanvas = canvas;
    if (typeof canvas.addEventListener !== 'function') return;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.pointerListenerAttached = true;
  }

  /** Canvas `pointerdown` -> canvas-space coords -> `pointerDownAt`. */
  private readonly handlePointerDown = (event: PointerEvent): void => {
    // Paused (hub open, or auto-paused): taps belong to the overlay, not
    // to the mine-selector chips underneath it.
    if (this.paused) return;
    const canvas = this.lastCanvas;
    if (canvas === null) return;
    const rect =
      typeof canvas.getBoundingClientRect === 'function'
        ? canvas.getBoundingClientRect()
        : null;
    if (rect === null || rect.width <= 0 || rect.height <= 0) return;
    const x = ((event.clientX - rect.left) * canvas.width) / rect.width;
    const y = ((event.clientY - rect.top) * canvas.height) / rect.height;
    this.pointerDownAt(x, y, event.timeStamp);
  };

  public hudHtml(): string {
    const snap = this.lastSnapshot ?? this.machine.snapshot();
    const level = miningLevel(this.xp);
    const tier = this.activeTier;
    // The Ore counter shows the real ore image next to the count (same
    // art as the drops). The browser caches it, so re-setting innerHTML
    // each frame does not re-fetch; a missing image degrades to the
    // tier name text, never a broken-image icon in the count itself.
    const oreImg =
      `<img src="${assetUrl(tier.oreImage)}" alt="${tier.name}" ` +
      `style="height:1.3em;vertical-align:-0.25em">`;
    // The instruction lives HERE and nowhere on the canvas (v3.2):
    // one line, merged ready + tip. The facing hint rides along when
    // the machine sees the body sideways — it used to be a third
    // canvas line across the face.
    let instruction = swingInstruction(snap.phase, snap.lastEvent);
    if (this.snapshotFacingOk(snap) === false) {
      instruction += " Face the camera — I can't see you from the side.";
    }
    return (
      `<span>⛏️ Mining Lv ${level} — ${xpIntoLevel(this.xp)}/${SWING.xpPerLevel} XP</span> &nbsp; ` +
      `<span>${oreImg} Ore ${this.ore} · ${tier.name}</span> &nbsp; ` +
      `<span>💰 ${inventory.credits} cr</span> &nbsp; ` +
      `<span>Swings ${this.swings}</span> &nbsp; ` +
      `<span>Node ${this.nodeHits}/${SWING.hitsPerNode}</span> &nbsp; ` +
      `<span>Phase: ${snap.phase} · L ${snap.leftVel.toFixed(1)} R ${snap.rightVel.toFixed(1)} torso/s</span> &nbsp; ` +
      `<span>${instruction}</span>`
    );
  }

  /** Read-only snapshot of the live state, for the debug HUD and tests. */
  public snapshot(): SwingLabSnapshot {
    const snap = this.lastSnapshot ?? this.machine.snapshot();
    return {
      ore: this.ore,
      xp: this.xp,
      level: miningLevel(this.xp),
      xpIntoLevel: xpIntoLevel(this.xp),
      nodeHits: this.nodeHits,
      swings: this.swings,
      nodesBroken: this.nodesBroken,
      cracks: cracksForHits(this.nodeHits),
      phase: snap.phase,
      lastEvent: snap.lastEvent,
      lastHandedness: this.lastHandedness,
      particles: this.particles.length,
      tierId: this.activeTier.id,
      tierName: this.activeTier.name,
      lastWeakDetail: snap.lastWeakDetail,
      oreDrops: this.oreDrops.length,
      nodeGone: this.nodeGone(this.lastNowMs),
      respawnProgress: this.respawnProgress(this.lastNowMs),
      nodePieces: this.nodePieces.length,
    };
  }

  private reset(): void {
    this.machine.reset();
    this.ore = 0;
    this.xp = 0;
    this.nodeHits = 0;
    this.swings = 0;
    this.nodesBroken = 0;
    this.lastHandedness = null;
    this.lastSnapshot = null;
    this.prevPhase = 'ready';
    this.lastBody = null;
    this.shakeStartMs = 0;
    this.shakeUntilMs = 0;
    this.flashUntilMs = 0;
    this.breakBannerUntilMs = 0;
    this.levelBannerUntilMs = 0;
    this.particles = [];
    this.floaters = [];
    this.oreDrops = [];
    this.nodePieces = [];
    this.breakAtMs = 0;
    this.shakeAmpPx = SWING.shakePx * 2;
    // A fresh game starts at Mining 1, so it starts on the level 1 mine:
    // Galvanite would be locked at this level anyway.
    this.activeTier = requireTier(DEFAULT_TIER_ID);
    // The inventory store is the source of truth across sessions (v3.1):
    // ore/XP earned in earlier sessions are still owned, so the display
    // starts from the store instead of zero. reset() is also called by
    // restart(), so a restart keeps what you own.
    this.ore = inventory.count(this.activeTier.id);
    this.xp = inventory.xp('mining');
  }

  private applyEvent(event: SwingEvent, nowMs: number): void {
    // While the node is gone (break -> respawn wait) there is nothing to
    // hit: swings in the wait count for nothing, not even a weak tick.
    if (this.nodeGone(nowMs)) return;
    if (event.kind === 'weak') {
      this.sfx.weakTick();
      return;
    }
    // Counted hit: ore + tier XP + a crack on the node + an ore drop.
    // The inventory store is the source of truth (v3.1): the hit lands
    // in the store immediately, so the refiner and the hub see it and a
    // refresh never loses it. The session counters mirror the store.
    this.swings += 1;
    this.ore += this.activeTier.orePerHit;
    inventory.add(this.activeTier.id, this.activeTier.orePerHit);
    const prevLevel = miningLevel(this.xp);
    this.xp += this.activeTier.xpPerHit;
    inventory.addXp('mining', this.activeTier.xpPerHit);
    this.nodeHits += 1;
    this.lastHandedness = event.handedness;
    this.sfx.crack();
    // Harder hit feedback (v3): a bigger, longer shake plus debris
    // chips flying off the rock.
    this.shakeStartMs = nowMs;
    this.shakeUntilMs = nowMs + BREAK.shakeMs;
    this.shakeAmpPx = BREAK.shakePx;
    this.flashUntilMs = nowMs + 200;
    this.spawnDebris(nowMs);
    this.spawnOreDrop(nowMs);
    const pos = this.floaterPos();
    this.floaters.push({
      x: pos.x,
      y: pos.y,
      text: `+${this.activeTier.xpPerHit} XP`,
      untilMs: nowMs + SWING.floaterMs,
    });
    if (miningLevel(this.xp) > prevLevel) {
      this.levelBannerUntilMs = nowMs + 1400;
    }
    if (this.nodeHits >= SWING.hitsPerNode) {
      this.nodesBroken += 1;
      this.nodeHits = 0;
      this.sfx.win();
      this.breakBannerUntilMs = nowMs + SWING.breakBannerMs;
      this.breakNode(nowMs);
      this.spawnBreakParticles(nowMs);
    }
  }

  /**
   * The node breaks apart: it splits into rock pieces that tumble and
   * fall off the bottom of the canvas, and the 3 s respawn wait starts.
   * The node is gone (no mining) until the wait completes.
   */
  private breakNode(nowMs: number): void {
    const { x, y, rx, ry } = this.nodeCenter();
    this.breakAtMs = nowMs;
    const colors = ['#8d7d6b', '#5d5145', '#6b5d4f', this.activeTier.crystalColor];
    for (let i = 0; i < BREAK.pieceCount; i += 1) {
      // Mostly upward/outward, then gravity takes them down off-screen.
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2;
      const speed = 120 + Math.random() * 220;
      this.nodePieces.push({
        x: x + (Math.random() - 0.5) * rx,
        y: y + (Math.random() - 0.5) * ry,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 80,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 10,
        size: 18 + Math.random() * 26,
        untilMs: nowMs + BREAK.pieceLifetimeMs,
        color: colors[i % colors.length] ?? '#8d7d6b',
      });
    }
  }

  /** Debris chips thrown off the rock by every counted hit. */
  private spawnDebris(nowMs: number): void {
    const { x, y } = this.nodeCenter();
    const colors = [
      '#8d7d6b',
      '#5d5145',
      this.activeTier.crystalColor,
      '#ffd166',
    ];
    for (let i = 0; i < BREAK.debrisPerHit; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 90 + Math.random() * 200;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 120,
        untilMs: nowMs + BREAK.debrisLifetimeMs + Math.random() * 200,
        color: colors[i % colors.length] ?? '#8d7d6b',
        size: 5 + Math.random() * 4,
      });
    }
  }

  private nodeCenter(): NodeGeometry {
    return nodeCenterForBody(this.lastBody, this.lastWidth, this.lastHeight);
  }

  /**
   * Floater anchor (v3.2): right of the node, clear of the avatar.
   * The v3 floater sat above the node centre — over the torso /
   * boxers, low-contrast (t48). The node is front-centre, so its
   * right edge is past the torso (shoulder half-width ~0.37 torso
   * vs node radius 0.22 * min(w, h) ≈ 0.73 torso); the floater rides
   * there with a dark pill behind it (see `drawFloaters`).
   */
  private floaterPos(): { x: number; y: number } {
    const { x, y, rx } = this.nodeCenter();
    return { x: x + rx + 40, y: y - 20 };
  }

  /** True while the node is gone between break and respawn. */
  private nodeGone(nowMs: number): boolean {
    return this.breakAtMs !== 0 && nowMs < this.breakAtMs + BREAK.respawnMs;
  }

  /** Respawn progress 0..1 (1 = node present). */
  private respawnProgress(nowMs: number): number {
    if (this.breakAtMs === 0) return 1;
    return clamp((nowMs - this.breakAtMs) / BREAK.respawnMs, 0, 1);
  }

  /**
   * Fade-in alpha for the respawned node: 0 while gone, ramping 0..1
   * over `BREAK.fadeInMs` once the wait completes, 1 after.
   */
  private nodeFadeAlpha(nowMs: number): number {
    if (this.breakAtMs === 0) return 1;
    const sinceRespawn = nowMs - (this.breakAtMs + BREAK.respawnMs);
    if (sinceRespawn < 0) return 0;
    return clamp(sinceRespawn / BREAK.fadeInMs, 0, 1);
  }

  /**
   * One ore pops out of the node on a hit and flies toward the Ore
   * counter in the HUD, which sits below the stage — so the drop arcs up
   * out of the rock first, then down to the bottom-left of the stage,
   * shrinking and fading as it goes.
   */
  private spawnOreDrop(nowMs: number): void {
    const { x, y } = this.nodeCenter();
    this.oreDrops.push({
      fromX: x,
      fromY: y,
      toX: this.lastWidth * 0.12,
      toY: this.lastHeight - 14,
      startMs: nowMs,
      durationMs: ORE_DROP_MS,
      tierId: this.activeTier.id,
    });
  }

  private spawnBreakParticles(nowMs: number): void {
    const { x, y } = this.nodeCenter();
    const colors = ['#ffd166', '#fff7ae', '#7ee787', '#4ea1ff'];
    for (let i = 0; i < SWING.breakParticles; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 180;
      const color = colors[i % colors.length] ?? '#ffd166';
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        untilMs: nowMs + 500 + Math.random() * 300,
        color,
        size: 4,
      });
    }
  }

  private updateParticles(dtSec: number, nowMs: number): void {
    const remaining: Particle[] = [];
    for (const p of this.particles) {
      if (nowMs >= p.untilMs) continue;
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.vy += 500 * dtSec;
      remaining.push(p);
    }
    this.particles = remaining;
  }

  /**
   * Rock pieces fall with gravity and are disposed of the moment they
   * leave the bottom of the canvas (or their lifetime ends). The list is
   * also hard-capped, so a pathological run can never accumulate pieces
   * across many broken nodes.
   */
  private updatePieces(dtSec: number, nowMs: number): void {
    const remaining: NodePiece[] = [];
    for (const piece of this.nodePieces) {
      if (nowMs >= piece.untilMs) continue;
      piece.x += piece.vx * dtSec;
      piece.y += piece.vy * dtSec;
      piece.vy += 900 * dtSec;
      piece.rot += piece.rotV * dtSec;
      if (piece.y - piece.size > this.lastHeight + 40) continue;
      remaining.push(piece);
    }
    this.nodePieces = remaining.slice(-24);
  }

  // ------------------------------------------------------------- drawing ---

  private drawNode(ctx: CanvasRenderingContext2D): void {
    const { x, y, rx, ry } = this.nodeCenter();
    const tier = this.activeTier;
    ctx.save();
    // Ground shadow.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + ry * 0.95, rx * 1.05, ry * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    // Rock body: the real RuneSpace boulder art, cover-fit into the
    // ellipse. The drawn rock is the fallback when the art has not
    // loaded (or failed to load) — never a hole in the stage.
    const boulder = this.boulderImage;
    if (boulder !== null && boulder.loaded) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      const scale = Math.max(
        (rx * 2) / boulder.img.width,
        (ry * 2) / boulder.img.height,
      );
      const dw = boulder.img.width * scale;
      const dh = boulder.img.height * scale;
      ctx.drawImage(boulder.img, x - dw / 2, y - dh / 2, dw, dh);
      ctx.restore();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#8d7d6b';
      ctx.strokeStyle = '#5d5145';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Highlight.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.beginPath();
      ctx.ellipse(
        x - rx * 0.35,
        y - ry * 0.4,
        rx * 0.4,
        ry * 0.25,
        -0.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    // Ore crystals embedded in the rock face, in the active tier's
    // colour: rusty orange for Ferrite Shale, bright silver for
    // Galvanite (sampled from the real art).
    ctx.fillStyle = tier.crystalColor;
    const crystals: readonly (readonly [number, number, number])[] = [
      [-0.35, -0.35, 0.16],
      [0.3, -0.45, 0.13],
      [0.05, 0.12, 0.18],
    ];
    for (const [dx, dy, size] of crystals) {
      const cx = x + dx * rx;
      const cy = y + dy * ry;
      const w = rx * size;
      const h = ry * size * 1.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy - h);
      ctx.lineTo(cx + w, cy);
      ctx.lineTo(cx, cy + h);
      ctx.lineTo(cx - w, cy);
      ctx.closePath();
      ctx.fill();
    }
    // Cracks: jagged lines from the top, one per hit (max 3). They get
    // thicker and the rock darkens as the hits pile up, so the crack
    // stages read clearly instead of all looking the same.
    const cracks = cracksForHits(this.nodeHits);
    if (this.nodeHits > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${0.07 * this.nodeHits})`;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#3a3128';
    ctx.lineWidth = 3 + cracks;
    ctx.lineCap = 'round';
    const crackPaths: readonly (readonly [number, number][])[] = [
      [[0, -0.85], [0.08, -0.4], [-0.05, -0.05]],
      [[-0.55, -0.6], [-0.35, -0.25], [-0.45, 0.15]],
      [[0.55, -0.55], [0.3, -0.2], [0.45, 0.25]],
    ];
    for (let i = 0; i < cracks; i += 1) {
      const path = crackPaths[i];
      if (path === undefined) continue;
      ctx.beginPath();
      path.forEach(([dx, dy], j) => {
        const px = x + dx * rx;
        const py = y + dy * ry;
        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    // Node HP pips under the rock: 🪨 = hits landed (cracks), ⬜ = hits
    // still to go. The count of white squares is the hits remaining.
    ctx.font = `22px ${RENDER.gameFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8e8f0';
    const pips =
      '🪨'.repeat(this.nodeHits) + '⬜'.repeat(SWING.hitsPerNode - this.nodeHits);
    ctx.fillText(pips, x, y + ry + 26);
    ctx.restore();
  }

  /**
   * Ore drops flying from the node toward the Ore counter: the real ore
   * image for the tier they came from, arcing up out of the rock and
   * down to the bottom-left of the stage, shrinking and fading. If the
   * image has not loaded, the drawn gem in the tier's crystal colour.
   */
  private drawOreDrops(ctx: CanvasRenderingContext2D, nowMs: number): void {
    ctx.save();
    for (const drop of this.oreDrops) {
      const t = clamp((nowMs - drop.startMs) / drop.durationMs, 0, 1);
      const px = drop.fromX + (drop.toX - drop.fromX) * t;
      const py =
        drop.fromY +
        (drop.toY - drop.fromY) * t -
        Math.sin(Math.PI * t) * 90;
      const size = 46 * (1 - 0.35 * t);
      ctx.globalAlpha =
        t > 0.75 ? clamp(1 - (t - 0.75) / 0.25, 0, 1) : 1;
      const image = this.oreImages.get(drop.tierId);
      if (image !== undefined && image.loaded) {
        ctx.drawImage(image.img, px - size / 2, py - size / 2, size, size);
      } else {
        const tier = tierById(drop.tierId) ?? this.activeTier;
        ctx.fillStyle = tier.crystalColor;
        ctx.beginPath();
        ctx.moveTo(px, py - size / 2);
        ctx.lineTo(px + size * 0.35, py);
        ctx.lineTo(px, py + size / 2);
        ctx.lineTo(px - size * 0.35, py);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /**
   * Mine selector, bottom-right: one chip per tier in `MINING_TIERS`.
   * The active mine is highlighted; a locked mine shows its level
   * requirement (tapping it shows the full lock message as a floater).
   * Adding a tier is data-only — a new chip appears here on its own.
   * `pointerDownAt` (via the canvas listener) makes the chips tappable.
   */
  private drawTierChips(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    const level = miningLevel(this.xp);
    const chipW = 330;
    const chipH = 38;
    const gap = 8;
    const x = width - chipW - 12;
    this.chipRects = [];
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `18px ${RENDER.gameFont}`;
    MINING_TIERS.forEach((tier, i) => {
      const cy =
        height - 12 - (MINING_TIERS.length - i) * chipH - (MINING_TIERS.length - 1 - i) * gap;
      const unlocked = tierUnlocked(tier, level);
      const active = tier.id === this.activeTier.id;
      this.chipRects.push({ x, y: cy, w: chipW, h: chipH, tierId: tier.id });
      ctx.fillStyle = active
        ? 'rgba(255, 209, 102, 0.25)'
        : 'rgba(11, 11, 18, 0.72)';
      ctx.fillRect(x, cy, chipW, chipH);
      ctx.strokeStyle = active ? '#ffd166' : 'rgba(232, 232, 240, 0.5)';
      ctx.lineWidth = active ? 3 : 2;
      ctx.strokeRect(x, cy, chipW, chipH);
      ctx.fillStyle = unlocked ? '#e8e8f0' : '#b9b9d6';
      const label = !unlocked
        ? `🔒 ${tier.name} — ${tier.location} (Lv ${tier.requiredMiningLevel})`
        : active
          ? `✓ ${tier.name} — ${tier.location}`
          : `⛏️ ${tier.name} — ${tier.location}`;
      ctx.fillText(label, x + 10, cy + chipH / 2);
    });
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const p of this.particles) {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Tumbling rock chunks of a broken node, fading as they fall. */
  private drawNodePieces(ctx: CanvasRenderingContext2D, nowMs: number): void {
    ctx.save();
    for (const piece of this.nodePieces) {
      const age = 1 - (piece.untilMs - nowMs) / BREAK.pieceLifetimeMs;
      ctx.globalAlpha = clamp(1 - age * age, 0, 1);
      ctx.fillStyle = piece.color;
      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.rot);
      ctx.fillRect(
        -piece.size / 2,
        -piece.size / 2,
        piece.size,
        piece.size * 0.7,
      );
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Respawn bar rect (v3.2): bottom-left of the stage, clear of the
   * avatar (centre), the tier chips (bottom-right) and the swing
   * meter (left, ends y 440 + DOWN label at 468). The v3 bar sat
   * where the node broke — front-centre at waist height, over the
   * avatar's legs. Pure, so tests can assert the zone.
   */
  private drawRespawnBar(ctx: CanvasRenderingContext2D, nowMs: number): void {
    const { x, y, w, h } = respawnBarRect(this.lastWidth, this.lastHeight);
    const progress = this.respawnProgress(nowMs);
    const secs = Math.max(
      0,
      Math.ceil((this.breakAtMs + BREAK.respawnMs - nowMs) / 1000),
    );
    ctx.save();
    // Track.
    ctx.fillStyle = '#14141f';
    ctx.fillRect(x, y, w, h);
    // Fill.
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(x, y, w * progress, h);
    ctx.strokeStyle = 'rgba(232, 232, 240, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    // Countdown text INSIDE the bar (no separate label line above it
    // to collide with the meter's DOWN label): white with a dark
    // outline, readable over the dark track and the gold fill alike.
    ctx.font = `700 20px ${RENDER.gameFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 5;
    ctx.strokeText(`⛏️ New node in ${secs}…`, x + w / 2, y + h / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`⛏️ New node in ${secs}…`, x + w / 2, y + h / 2);
    ctx.restore();
  }

  /**
   * The pickaxe, gripped in the RIGHT hand at all times. The anchor is
   * the right wrist and the handle runs along the right forearm — never
   * the midpoint of both wrists, never teleported. Arms down: the miner
   * holds it at rest by their side, head down. No body: leaning on the
   * rock, waiting for a miner. Canvas space — the wrist is mirrored
   * through `toCanvas` like the avatar.
   */
  private drawPickaxe(
    ctx: CanvasRenderingContext2D,
    body: BodyState | null,
    width: number,
    height: number,
  ): void {
    const { x: rockX, y: rockY, rx, ry } = this.nodeCenter();
    if (body === null || !body.present) {
      // No body: pickaxe leaning on the rock, waiting for a miner.
      this.drawPickaxeShape(ctx, rockX - rx - 8, rockY + ry * 0.4, -0.5, -0.85);
      return;
    }
    const { x, y, dirX, dirY } = pickaxeAnchorForBody(body, width, height);
    this.drawPickaxeShape(ctx, x, y, dirX, dirY);
  }

  /** Handle + curved head along unit direction (`dirX`, `dirY`). */
  private drawPickaxeShape(
    ctx: CanvasRenderingContext2D,
    ax: number,
    ay: number,
    dirX: number,
    dirY: number,
  ): void {
    const hx = ax + dirX * 52;
    const hy = ay + dirY * 52;
    const bx = ax - dirX * 26;
    const by = ay - dirY * 26;
    ctx.save();
    ctx.lineCap = 'round';
    // Handle.
    ctx.strokeStyle = '#8d5a2b';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    // Curved steel head at the top end.
    const ang = Math.atan2(dirY, dirX);
    ctx.strokeStyle = '#c0c8d0';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(hx, hy, 17, ang - 2.4, ang + 0.9);
    ctx.stroke();
    // Hands grip.
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(ax, ay, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Vertical windup meter on the left: fills as the wrists rise.
   *
   * v3.2: the meter moved down (top 110 -> 140, height 340 -> 300)
   * and lost its "⬆ UP" label — the label sat at y 54, exactly
   * where the phase banner (y 58) runs, so the two overlapped (t4).
   * "SWING" stays above the meter, "⬇ DOWN" below it; the respawn
   * bar (bottom-left, y 502..528) clears the DOWN label (y 468).
   */
  private drawSwingMeter(
    ctx: CanvasRenderingContext2D,
    snap: SwingSnapshot,
    nowMs: number,
  ): void {
    const x = 54;
    const top = 140;
    const h = 300;
    const w = 40;
    const progress = clamp(snap.windupProgress, 0, 1);
    const flashing =
      snap.phase === 'strike' || nowMs < this.flashUntilMs;
    ctx.save();
    ctx.font = `700 24px ${RENDER.gameFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8e8f0';
    ctx.fillText('SWING', x + w / 2, top - 28);
    // Track.
    ctx.fillStyle = 'rgba(11, 11, 18, 0.72)';
    ctx.fillRect(x, top, w, h);
    // Fill from the bottom.
    const fillH = h * progress;
    ctx.fillStyle = flashing
      ? '#ffd166'
      : progress >= 1
        ? '#ffd166'
        : '#7ee787';
    ctx.fillRect(x, top + h - fillH, w, fillH);
    if (flashing) {
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 4;
      ctx.strokeRect(x - 3, top - 3, w + 6, h + 6);
    } else {
      ctx.strokeStyle = 'rgba(232, 232, 240, 0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, top, w, h);
    }
    ctx.font = `20px ${RENDER.gameFont}`;
    ctx.fillStyle = '#e8e8f0';
    ctx.fillText('⬇ DOWN', x + w / 2, top + h + 28);
    ctx.restore();
  }

  /**
   * Read `facingOk` off the snapshot when the field exists. The swing
   * machine rework (Worker B) adds `facingOk: boolean` to
   * `SwingSnapshot`; until that lands the field is absent and this
   * returns `undefined` — no hint, no crash, and no type error either
   * way. The hint is advisory only, never a block.
   */
  private snapshotFacingOk(snap: SwingSnapshot): boolean | undefined {
    if (!('facingOk' in snap)) return undefined;
    const value = snap.facingOk;
    return typeof value === 'boolean' ? value : undefined;
  }

  /**
   * Phase banner ONLY (v3.2): one short line at y 58, 30 px so even
   * the longest label fits the 960 stage. The v3.1 second line (tip /
   * last-swing) is gone — the instruction lives in the HUD — and so
   * is the facing hint (also HUD now): both used to sit across the
   * avatar's face. While a level-up / node-broken announcement is
   * live it owns this same zone instead (see `drawBanners`), so the
   * two never stack.
   */
  private drawPhaseText(
    ctx: CanvasRenderingContext2D,
    snap: SwingSnapshot,
    width: number,
    nowMs: number,
  ): void {
    if (this.activeBanner(nowMs) !== null) return;
    const line = PHASE_LINES[snap.phase];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 30px ${RENDER.gameFont}`;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 6;
    ctx.strokeText(line, width / 2, 58);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(line, width / 2, 58);
    ctx.restore();
  }

  /**
   * Ghost of the ideal swing, until the first hit lands: both hands
   * together rise up the left (dashed), swing over the top to the
   * centre front, then chop straight down in front (solid arrow) — the
   * two-hand clasp from the Nov 4 reference frames, not the old
   * two-arrow arc.
   */
  private drawGhostArc(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    const cx = width * 0.5;
    const topY = height * 0.28;
    const botY = height * 0.62;
    const riseX = cx - 90;
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    // Rise: dashed line up the left, arrowhead at the top.
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(riseX, botY);
    ctx.lineTo(riseX, topY + 14);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(riseX - 12, topY + 26);
    ctx.lineTo(riseX, topY);
    ctx.lineTo(riseX + 12, topY + 26);
    ctx.closePath();
    ctx.fill();
    // Hands together over the top: dashed arc from the rise to centre.
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(riseX, topY + 14);
    ctx.quadraticCurveTo(cx - 45, topY - 30, cx, topY - 6);
    ctx.stroke();
    ctx.setLineDash([]);
    // Two clasped hands at the top, centre front.
    for (const dx of [-13, 13]) {
      ctx.beginPath();
      ctx.arc(cx + dx, topY - 6, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    // Chop: solid thick arrow straight down the centre, in front.
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(cx, topY + 16);
    ctx.lineTo(cx, botY - 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 14, botY - 28);
    ctx.lineTo(cx, botY);
    ctx.lineTo(cx + 14, botY - 28);
    ctx.closePath();
    ctx.fill();
    // No label on the arc (v3.2): its text sat at y ~99, on the
    // avatar's hat, under the phase banner and the tip. The phase
    // banner + HUD instruction say the same thing.
    ctx.restore();
  }

  /**
   * Floaters ("+15 XP", lock messages): a dark pill behind the text
   * (v3.2) — the bare gold text was low-contrast over the boxers and
   * the rock — anchored right of the node (see `floaterPos`), clear
   * of the avatar. They rise and fade over `SWING.floaterMs`.
   */
  private drawFloaters(ctx: CanvasRenderingContext2D, nowMs: number): void {
    ctx.save();
    ctx.font = `700 36px ${RENDER.gameFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.floaters) {
      const age = 1 - (f.untilMs - nowMs) / SWING.floaterMs;
      const y = f.y - age * 30;
      const textWidth =
        typeof ctx.measureText === 'function'
          ? ctx.measureText(f.text).width
          : f.text.length * 20;
      ctx.globalAlpha = clamp(1 - age, 0, 1);
      // Pill behind the text: solid, so the floater reads over any
      // background (torso, rock, stage).
      ctx.fillStyle = '#14141f';
      ctx.fillRect(
        f.x - textWidth / 2 - 14,
        y - 26,
        textWidth + 28,
        52,
      );
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        f.x - textWidth / 2 - 14,
        y - 26,
        textWidth + 28,
        52,
      );
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.lineWidth = 6;
      ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = '#ffd166';
      ctx.fillText(f.text, f.x, y);
    }
    ctx.restore();
  }

  /** The live announcement (node broken beats level up), or null. */
  private activeBanner(nowMs: number): string | null {
    if (nowMs < this.breakBannerUntilMs) {
      return '⛏️ Node broken! New node!';
    }
    if (nowMs < this.levelBannerUntilMs) {
      return `Level up! Mining Lv ${miningLevel(this.xp)}!`;
    }
    return null;
  }

  /**
   * Announcements (v3.2): drawn in the phase-banner zone at the top
   * of the stage (y 58), clear of the head — never mid-stage across
   * the avatar's face (v3.1: `height / 2 - 60`, t48). While one is
   * live it replaces the phase banner in the same zone.
   */
  private drawBanners(
    ctx: CanvasRenderingContext2D,
    nowMs: number,
    width: number,
  ): void {
    const text = this.activeBanner(nowMs);
    if (text === null) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 40px ${RENDER.gameFont}`;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 7;
    ctx.strokeText(text, width / 2, 58);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, width / 2, 58);
    ctx.restore();
  }
}
