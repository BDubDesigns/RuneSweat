/**
 * Refiner — Active RuneSpace Refining prototype (Slice 1.5, v3.1).
 *
 * A `Game` like Swing Lab, so the coordinator registers / switches it
 * in `main.ts` exactly the same way. The hub opens it (see
 * `hub/townHub.ts` `onOpenRefiner`); leaving returns to the hub.
 *
 * THE LOOP (Brandon's design, Nov 4, 2026):
 * - Recipe picker: Refined Ferrite (Refining 1) and Galvanic Stock
 *   (Refining 5), gated by Refining level AND owned ore — a recipe
 *   you cannot afford or are not levelled for shows locked, with why.
 * - The input ore appears as a pile in a wheelbarrow/bin on the
 *   LEFT-CENTRE — up to 10 visible at a time, refilling from owned
 *   stock when one is taken; fewer than 10 owned shows exactly the
 *   owned count. (v3.2: pulled in from the far left so the player
 *   does not have to lean out of frame to reach it.)
 * - Grab: BOTH hands over the pile (held ~200 ms) -> one ore sticks
 *   to the hands. One ore at a time.
 * - Carry both hands to the hopper on the RIGHT -> the ore unsticks
 *   and drops loose into the hopper. Hopper fill shows 1/2, 2/2.
 * - Process: once the hopper holds the full input (2 ore), 3 star
 *   jumps complete the batch -> 1 refined material + XP. Progress
 *   shows 1/3, 2/3, 3/3 on screen.
 * - After a batch, keep carrying (if you own more ore) or leave to
 *   the hub. Leaving mid-batch ABANDONS it and the carried + hopper
 *   ore returns to inventory — nothing is ever lost to a pause.
 *
 * Failure -> Slag is NOT built: the active refiner always succeeds.
 *
 * MOUSE-SIM (see README / PLAN for the full mapping): pointer steers
 * the torso, `A`+`D` clasps both hands to one point — move the clasp
 * over the pile to grab, over to the hopper to drop. Star jumps need
 * `W` (jump) + `Q`+`E` (arms wide) — BUT the current sim cannot
 * spread its ankles, so a sim star jump can never satisfy the
 * detector's legs-apart condition (see `core/starJump.ts`). The
 * coordinator needs a sim leg-spread input before the full slice is
 * mouse-playable; the grab/carry/drop half plays in the sim today.
 *
 * The game owns only its simulation + canvas drawing + HUD string.
 * It reads `BodyState` only (via the machine + the star-jump
 * detector) and the shared `inventory` store — no constructor
 * changes: `new RefinerGame(sfx)`. The coordinator wires leaving:
 * set `game.onLeaveToHub = () => ...` (called when the player taps
 * "Leave to town"); the game itself abandons the batch first.
 */

import { RENDER, REFINER, STAGE, SWING } from '../../core/config';
import type { SoundEffects } from '../../core/audio';
import { assetUrl } from '../../core/assetUrl';
import { paintButton } from '../../hub/townHub';
import type { BodyState } from '../../core/bodyState';
import { StarJumpDetector } from '../../core/starJump';
import { inventory } from '../../core/inventory';
import { toCanvas } from '../../render/stage';
import type { NormalizedLandmark } from '../../tracking/poseTypes';
import type { Game } from '../game';
import {
  REFINING_RECIPES,
  inputName,
  recipeLockReason,
  type RefiningRecipe,
} from './recipes';
import {
  RefinerMachine,
  type RefinerEvent,
  type RefinerSnapshot,
} from './refinerMachine';

/** Canvas-space zone (pile / hopper). */
export interface RefinerZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Pile zone for a stage: LEFT-CENTRE, waist height, where the hands
 * rest when the arms hang (clasped hands read ~0.57 of stage height
 * in the mouse sim). The hopper mirrors it on the RIGHT-CENTRE.
 *
 * v3.2 (Brandon's idea, Nov 4 playtest): the zones were far left
 * (centre 0.16w) and far right (0.84w), so the player leaned and
 * shifted side to side to reach them and their hips/knees slid out
 * of frame — which tripped the gate mid-refine. Centres are now
 * 0.30w / 0.70w: a ~0.20w reach from a centred stance, well inside
 * the ~0.32w arm reach, while the pile's right edge (0.42w) still
 * clears the torso's left edge (~0.44w) — any further inward and the
 * bin would sit under the avatar. Height is unchanged (0.44h, waist
 * height): the player must not have to bend forward to grab.
 */
export function pileZoneForStage(
  width: number,
  height: number,
): RefinerZone {
  return { x: width * 0.18, y: height * 0.44, w: width * 0.24, h: height * 0.3 };
}

export function hopperZoneForStage(
  width: number,
  height: number,
): RefinerZone {
  return { x: width * 0.58, y: height * 0.44, w: width * 0.24, h: height * 0.3 };
}

/** True when canvas point (x, y) is inside zone. */
export function pointInZone(
  x: number,
  y: number,
  zone: RefinerZone,
): boolean {
  return x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h;
}

/**
 * Recipe-picker card geometry (v3.2): one opaque card per recipe.
 *
 * Cards are 640 x 96 — big tap targets — stacked from y 140 with a
 * 16 px gap, so two cards end at y 348: clear of the gate banner
 * (bottom y 40, see `GATE_BANNER` in `render/renderer.ts`) and clear
 * of the "Leave to town" chip (top y 488). The footer note sits
 * below the cards. Pure, so tests can assert the zones never overlap
 * without a canvas.
 */
export const PICKER_CARD = {
  w: 640,
  h: 96,
  gap: 16,
  top: 140,
} as const;

/** One picker card's canvas-space rect + recipe. */
export interface PickerCardRect {
  x: number;
  y: number;
  w: number;
  h: number;
  recipeId: string;
}

/** Whole picker layout for a stage: cards, title lines, footer, leave. */
export interface PickerLayout {
  titleY: number;
  subtitleY: number;
  cards: PickerCardRect[];
  /** First footer line (selection hint); a second line follows +28. */
  footerY: number;
  leave: { x: number; y: number; w: number; h: number };
}

export function pickerCardLayout(width: number, height: number): PickerLayout {
  const x = Math.round(width / 2 - PICKER_CARD.w / 2);
  return {
    titleY: 60,
    subtitleY: 100,
    cards: REFINING_RECIPES.map((recipe, i) => ({
      x,
      y: PICKER_CARD.top + i * (PICKER_CARD.h + PICKER_CARD.gap),
      w: PICKER_CARD.w,
      h: PICKER_CARD.h,
      recipeId: recipe.id,
    })),
    footerY:
      PICKER_CARD.top +
      REFINING_RECIPES.length * (PICKER_CARD.h + PICKER_CARD.gap) +
      10,
    leave: { x: 12, y: height - 52, w: 220, h: 40 },
  };
}

/** Drawn colour of an input ore when its art has not loaded. */
export function inputOreColor(recipe: RefiningRecipe): string {
  return recipe.inputItemId === 'galvanite' ? '#d7dde6' : '#d97b3f';
}

interface LoadedImage {
  img: HTMLImageElement;
  loaded: boolean;
}

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

/** Read-only snapshot of the live state, for the debug HUD and tests. */
export interface RefinerGameSnapshot extends RefinerSnapshot {
  /** Star jumps done this batch (mirrors the machine). */
  starJumps: number;
  /** Current star-jump shape progress 0..1 (live body feedback). */
  starShapeProgress: number;
}

export class RefinerGame implements Game {
  public readonly id = 'refiner';
  public readonly title = 'Refiner';
  public paused = false;

  /**
   * Coordinator hook: called when the player taps "Leave to town"
   * (after the batch is abandoned). `main.ts` sets this to switch
   * back to Swing Lab + open the hub. Null = leaving does nothing
   * (the game just returns to its picker).
   */
  public onLeaveToHub: (() => void) | null = null;

  private readonly sfx: SoundEffects;
  private readonly machine = new RefinerMachine({
    owned: (id) => inventory.count(id),
    take: (id, n) => inventory.remove(id, n),
    give: (id, n) => inventory.add(id, n),
  });
  private readonly starJump = new StarJumpDetector();

  private lastWidth: number = STAGE.width;
  private lastHeight: number = STAGE.height;
  private lastShapeProgress = 0;
  private leaveRequested = false;
  /**
   * Recipe-picker cards + leave chip, recomputed every render.
   * `action` is `'leave'` or `'recipe:<id>'`.
   */
  private cardRects: {
    x: number;
    y: number;
    w: number;
    h: number;
    action: string;
  }[] = [];
  /**
   * Picker selection (v3.2): tap a card once to select it
   * (highlighted), tap it again to start the batch. A tap never
   * starts a batch by accident, and returning to the picker keeps
   * the last recipe selected.
   */
  private selectedId: string | null = null;
  /**
   * Batch-complete announcement, drawn in the title banner zone
   * until `announcementUntilMs` (v3.2): the canvas keeps only the
   * phase banner — the instruction lives in the HUD.
   */
  private announcementText: string | null = null;
  private announcementUntilMs = 0;
  private pointerListenerAttached = false;
  private lastCanvas: HTMLCanvasElement | null = null;
  private readonly outputImages = new Map<string, LoadedImage>();
  private readonly oreImages = new Map<string, LoadedImage>();

  public constructor(sfx: SoundEffects) {
    this.sfx = sfx;
    for (const recipe of REFINING_RECIPES) {
      const image = loadImage(recipe.outputImage);
      if (image !== null) this.outputImages.set(recipe.id, image);
    }
    // Input ore art: reuse the mining tier images.
    for (const [id, path] of [
      ['ferrite-shale', 'item-art/ferrite-shale.webp'],
      ['galvanite', 'item-art/galvanite.webp'],
    ] as const) {
      const image = loadImage(path);
      if (image !== null) this.oreImages.set(id, image);
    }
  }

  /**
   * Start a batch on a recipe (the picker calls this on the second
   * tap on a selected card; the hub may deep-link it). Returns false
   * when the recipe is locked — the picker shows the lock reason
   * instead.
   */
  public selectRecipe(recipeId: string): boolean {
    const started = this.machine.selectRecipe(recipeId);
    if (started) {
      this.selectedId = null;
      this.announcementText = null;
      this.announcementUntilMs = 0;
    }
    return started;
  }

  /** The recipe the picker has selected (null = none). */
  public get selectedRecipeId(): string | null {
    return this.selectedId;
  }

  /** Back to the recipe picker (abandons the live batch). */
  public backToPicker(nowMs: number): void {
    void nowMs;
    const prev = this.machine.currentRecipe?.id ?? null;
    this.machine.backToPicker();
    // The last recipe stays selected, so one tap re-starts it.
    this.selectedId = prev;
    this.announcementText = null;
    this.announcementUntilMs = 0;
  }

  /** True once the player has asked to leave (coordinator polls this). */
  public get leavePending(): boolean {
    return this.leaveRequested;
  }

  /** The coordinator calls this after handling a leave request. */
  public clearLeaveRequest(): void {
    this.leaveRequested = false;
  }

  /**
   * Canvas-space pointer tap. A tap on a recipe card selects it (or
   * starts the batch on the second tap); a tap on a locked card does
   * nothing — its lock reason is printed on the card itself. A tap on
   * "Leave to town" abandons the batch and fires `onLeaveToHub`.
   */
  public pointerDownAt(x: number, y: number, _nowMs: number): boolean {
    for (const card of this.cardRects) {
      if (x < card.x || x > card.x + card.w || y < card.y || y > card.y + card.h) {
        continue;
      }
      if (card.action === 'leave') {
        this.requestLeave();
        return true;
      }
      if (card.action.startsWith('recipe:')) {
        const id = card.action.slice('recipe:'.length);
        const recipe = REFINING_RECIPES.find((r) => r.id === id);
        if (recipe === undefined) return false;
        const lock = recipeLockReason(
          recipe,
          inventory.level('refining'),
          inventory.count(recipe.inputItemId),
        );
        if (lock !== null) return true;
        if (this.selectedId === id) {
          return this.selectRecipe(id);
        }
        this.selectedId = id;
        return true;
      }
    }
    return false;
  }

  public start(): void {
    this.machine.setRefiningLevel(inventory.level('refining'));
    this.machine.leave();
    this.starJump.reset();
    this.paused = false;
    this.leaveRequested = false;
    this.selectedId = null;
    this.announcementText = null;
    this.announcementUntilMs = 0;
  }

  public stop(): void {
    this.machine.leave();
    this.paused = true;
    this.detachPointerListener();
  }

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    this.paused = false;
  }

  public restart(): void {
    this.start();
  }

  public update(
    dtMs: number,
    nowMs: number,
    body: BodyState | null,
    _landmarks: readonly NormalizedLandmark[] | null,
  ): void {
    if (this.paused) return;
    void dtMs;
    this.machine.setRefiningLevel(inventory.level('refining'));

    const width = this.lastWidth;
    const height = this.lastHeight;
    const pile = pileZoneForStage(width, height);
    const hopper = hopperZoneForStage(width, height);

    const jumpEvent = this.starJump.update(body, nowMs);
    this.lastShapeProgress = this.starJump.shape(body).progress;

    let handX = width / 2;
    let handY = height / 2;
    let handsTogether = false;
    if (body !== null && body.present && body.torsoLength > 0) {
      const left = toCanvas(
        { x: body.leftWristX, y: body.leftWristY, visibility: 1 },
        width,
        height,
      );
      const right = toCanvas(
        { x: body.rightWristX, y: body.rightWristY, visibility: 1 },
        width,
        height,
      );
      handX = (left.x + right.x) / 2;
      handY = (left.y + right.y) / 2;
      const gap =
        Math.hypot(
          body.leftWristX - body.rightWristX,
          body.leftWristY - body.rightWristY,
        ) / body.torsoLength;
      handsTogether = gap <= SWING.handsTogetherTorsoFrac;
    }

    const event = this.machine.update(
      {
        present: body !== null && body.present,
        handsTogether,
        handX,
        handY,
        starJump: jumpEvent !== null,
      },
      pile,
      hopper,
      nowMs,
    );
    if (event !== null) this.applyEvent(event, nowMs);
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
    this.attachPointerListener(ctx.canvas);
    const snap = this.machine.snapshot();
    const pile = pileZoneForStage(width, height);
    const hopper = hopperZoneForStage(width, height);

    // Fresh hit rects every frame: stale picker cards must never stay
    // tappable once a batch is running.
    if (snap.phase !== 'pick') this.cardRects = [];
    if (snap.phase === 'pick') {
      this.drawPicker(ctx, width, height, nowMs);
      return;
    }
    this.drawPile(ctx, pile, snap, nowMs);
    this.drawHopper(ctx, hopper, snap, nowMs);
    this.drawCarriedOre(ctx, body, width, height, snap);
    this.drawProgress(ctx, snap, width, height, nowMs);
    this.drawLeaveChip(ctx, width, height);
    // No "step into frame" text here: the gate owns that message (a
    // small top banner while an activity screen is up — see
    // `drawGateBanner`), and a mid-stage line would sit on top of the
    // picker / pile / hopper.
  }

  public hudHtml(): string {
    const snap = this.machine.snapshot();
    const level = inventory.level('refining');
    const xpInto = inventory.xp('refining') % REFINER.xpPerLevel;
    const recipe = snap.recipeName ?? '—';
    return (
      `<span>🔥 Refining Lv ${level} — ${xpInto}/${REFINER.xpPerLevel} XP</span> &nbsp; ` +
      `<span>💰 ${inventory.credits} cr</span> &nbsp; ` +
      `<span>Recipe: ${recipe}</span> &nbsp; ` +
      `<span>Hopper ${snap.hopperFill}/${REFINER.hopperCapacity}</span> &nbsp; ` +
      `<span>⭐ ${snap.jumpsDone}/${REFINER.starJumpsPerBatch}</span> &nbsp; ` +
      `<span>${snap.hint}</span>`
    );
  }

  /** Read-only snapshot of the live state, for the debug HUD and tests. */
  public snapshot(): RefinerGameSnapshot {
    const snap = this.machine.snapshot();
    return {
      ...snap,
      starJumps: snap.jumpsDone,
      starShapeProgress: this.lastShapeProgress,
    };
  }

  private applyEvent(event: RefinerEvent, nowMs: number): void {
    if (event.kind === 'dropped') this.sfx.reload();
    if (event.kind === 'grabbed') this.sfx.shoot();
    if (event.kind === 'star-jump') this.sfx.feedback('good');
    if (event.kind === 'batch-complete') {
      const recipe = this.machine.currentRecipe;
      if (recipe !== null) {
        inventory.addXp('refining', recipe.xpPerBatch);
        // The batch-complete line is an announcement, not an
        // instruction: it replaces the title banner for a moment
        // (top of the stage, clear of the head) and never also lands
        // in the HUD hint — one surface per message.
        this.announcementText =
          `✨ ${recipe.name} made! +${recipe.xpPerBatch} Refining XP`;
        this.announcementUntilMs = nowMs + 1600;
      }
      this.sfx.win();
    }
  }

  private requestLeave(): void {
    this.machine.leave();
    this.leaveRequested = true;
    if (this.onLeaveToHub !== null) this.onLeaveToHub();
  }

  // ------------------------------------------------------------- drawing ---

  /**
   * Recipe picker (v3.2): one opaque card per recipe — the v3.1 chips
   * were translucent (`rgba(..., 0.72 / 0.45)`), so the avatar showed
   * through them, and the gate overlay drew on top of them whenever
   * the body was lost. A card carries the input ore image (left),
   * the output image (right), the recipe name, `input → output`, XP
   * per batch, the owned count, and — when locked — its reason. The
   * selected card gets a thick gold border + a ✓ on its name. Cards
   * are solid fills: nothing behind them ever shows through.
   */
  private drawPicker(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    _nowMs: number,
  ): void {
    const level = inventory.level('refining');
    const layout = pickerCardLayout(width, height);
    this.cardRects = [];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 34px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 6;
    ctx.strokeText('🔥 Refiner — pick a recipe', width / 2, layout.titleY);
    ctx.fillText('🔥 Refiner — pick a recipe', width / 2, layout.titleY);
    ctx.font = `22px ${RENDER.gameFont}`;
    ctx.fillStyle = '#e8e8f0';
    ctx.fillText(
      `Refining Lv ${level} — ${inventory.xp('refining') % REFINER.xpPerLevel}/${REFINER.xpPerLevel} XP · 💰 ${inventory.credits} cr`,
      width / 2,
      layout.subtitleY,
    );

    for (const card of layout.cards) {
      const recipe = REFINING_RECIPES.find((r) => r.id === card.recipeId);
      if (recipe === undefined) continue;
      const owned = inventory.count(recipe.inputItemId);
      const lock = recipeLockReason(recipe, level, owned);
      const selected = this.selectedId === recipe.id;
      this.cardRects.push({
        x: card.x,
        y: card.y,
        w: card.w,
        h: card.h,
        action: `recipe:${recipe.id}`,
      });
      // Solid fills only — a translucent card lets the avatar show
      // through and kills readability (v3.1 bug).
      ctx.fillStyle =
        lock !== null ? '#1a1a2b' : selected ? '#2e2e4a' : '#232338';
      ctx.fillRect(card.x, card.y, card.w, card.h);
      ctx.strokeStyle =
        lock !== null ? 'rgba(232, 232, 240, 0.4)' : '#ffd166';
      ctx.lineWidth = selected ? 4 : lock !== null ? 2 : 3;
      ctx.strokeRect(card.x, card.y, card.w, card.h);
      // Input ore image (left) + output image (right), 56 px each;
      // a drawn diamond in the item colour when the art has not
      // loaded — never a hole, never a broken image.
      this.drawCardIcon(ctx, card.x + 16, card.y + 20, 56, this.oreImages.get(recipe.inputItemId), inputOreColor(recipe));
      this.drawCardIcon(ctx, card.x + card.w - 72, card.y + 20, 56, this.outputImages.get(recipe.id), recipe.fallbackColor);
      // Line 1: name (✓ when selected) + XP per batch, right-aligned.
      ctx.textAlign = 'left';
      ctx.font = `700 24px ${RENDER.gameFont}`;
      ctx.fillStyle = lock !== null ? '#b9b9d6' : '#ffffff';
      const name =
        lock !== null
          ? `🔒 ${recipe.name}`
          : selected
            ? `✓ ${recipe.name}`
            : recipe.name;
      ctx.fillText(name, card.x + 88, card.y + 32);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffd166';
      ctx.fillText(`+${recipe.xpPerBatch} XP`, card.x + card.w - 88, card.y + 32);
      // Line 2: input → output + owned, or the lock reason.
      ctx.textAlign = 'left';
      ctx.font = `20px ${RENDER.gameFont}`;
      ctx.fillStyle = lock !== null ? '#b9b9d6' : '#e8e8f0';
      const detail =
        lock ??
        `${recipe.inputQuantity} ${inputName(recipe)} → ${recipe.outputQuantity} ${recipe.name} · own ${owned}`;
      ctx.fillText(detail, card.x + 88, card.y + 66);
    }

    ctx.textAlign = 'center';
    ctx.font = `20px ${RENDER.gameFont}`;
    ctx.fillStyle = '#b9b9d6';
    ctx.fillText(
      this.selectedId === null
        ? 'Tap a recipe to select it — tap again to start.'
        : '✓ Tap the highlighted recipe again to start.',
      width / 2,
      layout.footerY,
    );
    ctx.fillText(
      'Next recipe: Galvaferrite (Refining 8) — coming in a later slice.',
      width / 2,
      layout.footerY + 28,
    );
    this.drawLeaveChip(ctx, width, height);
    ctx.restore();
  }

  /** One 56 px item icon inside a picker card (image or fallback gem). */
  private drawCardIcon(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    image: LoadedImage | undefined,
    fallbackColor: string,
  ): void {
    if (image !== undefined && image.loaded) {
      ctx.drawImage(image.img, x, y, size, size);
      return;
    }
    const cx = x + size / 2;
    const cy = y + size / 2;
    ctx.fillStyle = fallbackColor;
    ctx.beginPath();
    ctx.moveTo(cx, cy - size / 2);
    ctx.lineTo(cx + size * 0.35, cy);
    ctx.lineTo(cx, cy + size / 2);
    ctx.lineTo(cx - size * 0.35, cy);
    ctx.closePath();
    ctx.fill();
  }

  private drawPile(
    ctx: CanvasRenderingContext2D,
    pile: RefinerZone,
    snap: RefinerSnapshot,
    _nowMs: number,
  ): void {
    const recipe = this.machine.currentRecipe;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Wheelbarrow / bin: brown tub.
    ctx.fillStyle = '#6b4a2f';
    ctx.fillRect(pile.x, pile.y + pile.h * 0.55, pile.w, pile.h * 0.45);
    ctx.strokeStyle = '#4a3018';
    ctx.lineWidth = 3;
    ctx.strokeRect(pile.x, pile.y + pile.h * 0.55, pile.w, pile.h * 0.45);
    // Ore in the pile: up to 10, refilling from stock.
    const shown = snap.pileVisible;
    const img =
      recipe === null ? undefined : this.oreImages.get(recipe.inputItemId);
    for (let i = 0; i < shown; i += 1) {
      const col = i % 5;
      const row = Math.floor(i / 5);
      const ox = pile.x + pile.w * (0.15 + col * 0.175);
      const oy = pile.y + pile.h * (0.3 + row * 0.22);
      const size = 34;
      if (img !== undefined && img.loaded) {
        ctx.drawImage(img.img, ox - size / 2, oy - size / 2, size, size);
      } else {
        ctx.fillStyle = recipe?.id === 'galvanic-stock' ? '#d7dde6' : '#d97b3f';
        ctx.beginPath();
        ctx.moveTo(ox, oy - size / 2);
        ctx.lineTo(ox + size * 0.35, oy);
        ctx.lineTo(ox, oy + size / 2);
        ctx.lineTo(ox - size * 0.35, oy);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.font = `700 22px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 5;
    const label = `Ore pile: ${shown} shown · ${snap.ownedInput} owned`;
    ctx.strokeText(label, pile.x + pile.w / 2, pile.y + pile.h + 24);
    ctx.fillText(label, pile.x + pile.w / 2, pile.y + pile.h + 24);
    ctx.restore();
  }

  private drawHopper(
    ctx: CanvasRenderingContext2D,
    hopper: RefinerZone,
    snap: RefinerSnapshot,
    _nowMs: number,
  ): void {
    const recipe = this.machine.currentRecipe;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Hopper: funnel + bin.
    ctx.fillStyle = '#3f5a7a';
    ctx.beginPath();
    ctx.moveTo(hopper.x, hopper.y);
    ctx.lineTo(hopper.x + hopper.w, hopper.y);
    ctx.lineTo(hopper.x + hopper.w * 0.75, hopper.y + hopper.h * 0.45);
    ctx.lineTo(hopper.x + hopper.w * 0.25, hopper.y + hopper.h * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2c415c';
    ctx.fillRect(
      hopper.x + hopper.w * 0.25,
      hopper.y + hopper.h * 0.45,
      hopper.w * 0.5,
      hopper.h * 0.55,
    );
    ctx.strokeStyle = '#1d2c40';
    ctx.lineWidth = 3;
    ctx.strokeRect(
      hopper.x + hopper.w * 0.25,
      hopper.y + hopper.h * 0.45,
      hopper.w * 0.5,
      hopper.h * 0.55,
    );
    // Fill pips: ore already dropped in.
    const img =
      recipe === null ? undefined : this.oreImages.get(recipe.inputItemId);
    for (let i = 0; i < snap.hopperFill; i += 1) {
      const ox = hopper.x + hopper.w * (0.35 + i * 0.3);
      const oy = hopper.y + hopper.h * 0.62;
      const size = 34;
      if (img !== undefined && img.loaded) {
        ctx.drawImage(img.img, ox - size / 2, oy - size / 2, size, size);
      } else {
        ctx.fillStyle = '#d97b3f';
        ctx.beginPath();
        ctx.arc(ox, oy, size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.font = `700 22px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 5;
    const label = `Hopper: ${snap.hopperFill}/${REFINER.hopperCapacity}`;
    ctx.strokeText(label, hopper.x + hopper.w / 2, hopper.y + hopper.h + 24);
    ctx.fillText(label, hopper.x + hopper.w / 2, hopper.y + hopper.h + 24);
    ctx.restore();
  }

  private drawCarriedOre(
    ctx: CanvasRenderingContext2D,
    body: BodyState | null,
    width: number,
    height: number,
    snap: RefinerSnapshot,
  ): void {
    if (!snap.carrying || body === null || !body.present) return;
    const recipe = this.machine.currentRecipe;
    const left = toCanvas(
      { x: body.leftWristX, y: body.leftWristY, visibility: 1 },
      width,
      height,
    );
    const right = toCanvas(
      { x: body.rightWristX, y: body.rightWristY, visibility: 1 },
      width,
      height,
    );
    const x = (left.x + right.x) / 2;
    const y = (left.y + right.y) / 2;
    const img =
      recipe === null ? undefined : this.oreImages.get(recipe.inputItemId);
    ctx.save();
    if (img !== undefined && img.loaded) {
      ctx.drawImage(img.img, x - 23, y - 23, 46, 46);
    } else {
      ctx.fillStyle = '#d97b3f';
      ctx.beginPath();
      ctx.moveTo(x, y - 23);
      ctx.lineTo(x + 16, y);
      ctx.lineTo(x, y + 23);
      ctx.lineTo(x - 16, y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Title / phase banner ONLY (v3.2). The star progress lives in the
   * HUD (⭐ n/3) — the canvas stars sat on the avatar's hat (t70) —
   * and the star-jump instruction + last-event line duplicated the
   * HUD hint (t48: the same instruction three times). The one
   * exception is a batch-complete announcement, which replaces the
   * title in the same banner zone for a moment.
   */
  private drawProgress(
    ctx: CanvasRenderingContext2D,
    snap: RefinerSnapshot,
    width: number,
    height: number,
    nowMs: number,
  ): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 34px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 6;
    const text =
      this.announcementText !== null && nowMs < this.announcementUntilMs
        ? this.announcementText
        : `🔥 ${snap.recipeName ?? 'Refiner'}`;
    ctx.strokeText(text, width / 2, 58);
    ctx.fillText(text, width / 2, 58);
    void height;
    ctx.restore();
  }

  private drawLeaveChip(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    const { x, y, w, h } = pickerCardLayout(width, height).leave;
    // Picker render resets cardRects; the game render appends to it —
    // keep exactly one leave chip by replacing any previous one.
    this.cardRects = this.cardRects.filter((c) => c.action !== 'leave');
    this.cardRects.push({ x, y, w, h, action: 'leave' });
    // Same game-button look as the town hub (secondary style):
    // opaque gradient, darker lip, rounded corners, drop shadow —
    // not the old flat rectangle. (No hover/pressed state: the
    // refiner has no pointermove path; it draws idle.)
    paintButton(ctx, x, y, w, h, '⬅ Leave to town', 'secondary', 'idle', 20);
    void width;
  }

  private attachPointerListener(canvas: HTMLCanvasElement): void {
    if (this.pointerListenerAttached) return;
    this.lastCanvas = canvas;
    if (typeof canvas.addEventListener !== 'function') return;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.pointerListenerAttached = true;
  }

  private detachPointerListener(): void {
    if (
      this.lastCanvas !== null &&
      this.pointerListenerAttached &&
      typeof this.lastCanvas.removeEventListener === 'function'
    ) {
      this.lastCanvas.removeEventListener('pointerdown', this.handlePointerDown);
      this.pointerListenerAttached = false;
    }
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    // Paused (hub open over the refiner): taps belong to the overlay,
    // not to the recipe chips / leave chip underneath it.
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
}
