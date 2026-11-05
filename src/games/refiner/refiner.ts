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
 * - The input ore appears as a pile in a wheelbarrow/bin on the LEFT
 *   — up to 10 visible at a time, refilling from owned stock when one
 *   is taken; fewer than 10 owned shows exactly the owned count.
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
import type { BodyState } from '../../core/bodyState';
import { StarJumpDetector } from '../../core/starJump';
import { inventory } from '../../core/inventory';
import { toCanvas } from '../../render/stage';
import type { NormalizedLandmark } from '../../tracking/poseTypes';
import type { Game } from '../game';
import { REFINING_RECIPES, recipeLockReason } from './recipes';
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
 * Pile zone for a stage: LEFT side, waist height, where the hands
 * rest when the arms hang (clasped hands read ~0.57 of stage height
 * in the mouse sim). The hopper mirrors it on the RIGHT.
 */
export function pileZoneForStage(
  width: number,
  height: number,
): RefinerZone {
  return { x: width * 0.04, y: height * 0.44, w: width * 0.24, h: height * 0.3 };
}

export function hopperZoneForStage(
  width: number,
  height: number,
): RefinerZone {
  return { x: width * 0.72, y: height * 0.44, w: width * 0.24, h: height * 0.3 };
}

/** True when canvas point (x, y) is inside zone. */
export function pointInZone(
  x: number,
  y: number,
  zone: RefinerZone,
): boolean {
  return x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h;
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
  private lastEvent: RefinerEvent | null = null;
  private leaveRequested = false;
  /** Recipe-picker chips + leave button, recomputed every render. */
  private chipRects: {
    x: number;
    y: number;
    w: number;
    h: number;
    action: string;
  }[] = [];
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
   * Start a batch on a recipe (the picker calls this; the hub may
   * deep-link it). Returns false when the recipe is locked — the
   * picker shows the lock reason instead.
   */
  public selectRecipe(recipeId: string): boolean {
    return this.machine.selectRecipe(recipeId);
  }

  /** Back to the recipe picker (abandons the live batch). */
  public backToPicker(nowMs: number): void {
    void nowMs;
    this.machine.backToPicker();
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
   * Canvas-space pointer tap. A tap on a recipe chip starts that
   * batch (or shows the lock reason); a tap on "Leave to town"
   * abandons the batch and fires `onLeaveToHub`.
   */
  public pointerDownAt(x: number, y: number, _nowMs: number): boolean {
    for (const chip of this.chipRects) {
      if (x < chip.x || x > chip.x + chip.w || y < chip.y || y > chip.y + chip.h) {
        continue;
      }
      if (chip.action === 'leave') {
        this.requestLeave();
        return true;
      }
      if (chip.action.startsWith('recipe:')) {
        return this.machine.selectRecipe(chip.action.slice('recipe:'.length));
      }
      if (chip.action === 'picker') {
        this.machine.backToPicker();
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
    this.lastEvent = null;
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
    if (event !== null) this.applyEvent(event);
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

    // Fresh hit rects every frame: stale picker chips must never stay
    // tappable once a batch is running.
    if (snap.phase !== 'pick') this.chipRects = [];
    if (snap.phase === 'pick') {
      this.drawPicker(ctx, width, height, nowMs);
      return;
    }
    this.drawPile(ctx, pile, snap, nowMs);
    this.drawHopper(ctx, hopper, snap, nowMs);
    this.drawCarriedOre(ctx, body, width, height, snap);
    this.drawProgress(ctx, snap, width, height);
    this.drawHint(ctx, snap, width);
    this.drawLeaveChip(ctx, width, height);
    if (body === null || !body.present) {
      this.drawNoBody(ctx, width, height);
    }
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

  private applyEvent(event: RefinerEvent): void {
    this.lastEvent = event;
    if (event.kind === 'dropped') this.sfx.reload();
    if (event.kind === 'grabbed') this.sfx.shoot();
    if (event.kind === 'star-jump') this.sfx.feedback('good');
    if (event.kind === 'batch-complete') {
      const recipe = this.machine.currentRecipe;
      if (recipe !== null) {
        inventory.addXp('refining', recipe.xpPerBatch);
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

  private drawPicker(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    _nowMs: number,
  ): void {
    const level = inventory.level('refining');
    this.chipRects = [];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 34px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 6;
    ctx.strokeText('🔥 Refiner — pick a recipe', width / 2, 60);
    ctx.fillText('🔥 Refiner — pick a recipe', width / 2, 60);
    ctx.font = `22px ${RENDER.gameFont}`;
    ctx.fillStyle = '#e8e8f0';
    ctx.fillText(
      `Refining Lv ${level} — ${inventory.xp('refining') % REFINER.xpPerLevel}/${REFINER.xpPerLevel} XP · 💰 ${inventory.credits} cr`,
      width / 2,
      100,
    );

    const chipW = 560;
    const chipH = 64;
    const gap = 16;
    const x = width / 2 - chipW / 2;
    REFINING_RECIPES.forEach((recipe, i) => {
      const cy = 150 + i * (chipH + gap);
      const owned = inventory.count(recipe.inputItemId);
      const lock = recipeLockReason(recipe, level, owned);
      this.chipRects.push({
        x,
        y: cy,
        w: chipW,
        h: chipH,
        action: `recipe:${recipe.id}`,
      });
      ctx.fillStyle =
        lock === null ? 'rgba(11, 11, 18, 0.72)' : 'rgba(11, 11, 18, 0.45)';
      ctx.fillRect(x, cy, chipW, chipH);
      ctx.strokeStyle = lock === null ? '#ffd166' : 'rgba(232, 232, 240, 0.4)';
      ctx.lineWidth = lock === null ? 3 : 2;
      ctx.strokeRect(x, cy, chipW, chipH);
      ctx.textAlign = 'left';
      ctx.font = `700 24px ${RENDER.gameFont}`;
      ctx.fillStyle = lock === null ? '#e8e8f0' : '#b9b9d6';
      const label =
        lock === null
          ? `${recipe.name} — ${recipe.inputQuantity} ore → ${recipe.outputQuantity} · +${recipe.xpPerBatch} XP (own ${owned})`
          : `🔒 ${recipe.name} — ${lock}`;
      ctx.fillText(label, x + 14, cy + chipH / 2);
    });
    ctx.textAlign = 'center';
    ctx.font = `20px ${RENDER.gameFont}`;
    ctx.fillStyle = '#b9b9d6';
    ctx.fillText(
      'Next recipe: Galvaferrite (Refining 8) — coming in a later slice.',
      width / 2,
      150 + REFINING_RECIPES.length * (chipH + gap) + 10,
    );
    this.drawLeaveChip(ctx, width, height);
    ctx.restore();
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

  private drawProgress(
    ctx: CanvasRenderingContext2D,
    snap: RefinerSnapshot,
    width: number,
    height: number,
  ): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 34px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 6;
    const title = snap.recipeName ?? 'Refiner';
    ctx.strokeText(`🔥 ${title}`, width / 2, 58);
    ctx.fillText(`🔥 ${title}`, width / 2, 58);
    if (snap.phase === 'jumping' || snap.jumpsDone > 0) {
      const stars = '⭐'.repeat(snap.jumpsDone) + '☆'.repeat(REFINER.starJumpsPerBatch - snap.jumpsDone);
      ctx.font = `40px ${RENDER.gameFont}`;
      ctx.strokeText(stars, width / 2, 104);
      ctx.fillStyle = '#ffd166';
      ctx.fillText(stars, width / 2, 104);
      ctx.font = `22px ${RENDER.gameFont}`;
      ctx.fillStyle = '#e8e8f0';
      ctx.fillText(
        `Star jumps: ${snap.jumpsDone}/${REFINER.starJumpsPerBatch} — jump with arms and legs wide!`,
        width / 2,
        140,
      );
    } else if (this.lastEvent !== null) {
      ctx.font = `24px ${RENDER.gameFont}`;
      ctx.fillStyle = '#e8e8f0';
      ctx.fillText(this.lastEvent.message, width / 2, 104);
    }
    void height;
    ctx.restore();
  }

  private drawHint(
    ctx: CanvasRenderingContext2D,
    snap: RefinerSnapshot,
    width: number,
  ): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `22px ${RENDER.gameFont}`;
    ctx.fillStyle = '#e8e8f0';
    ctx.fillText(snap.hint, width / 2, 178);
    ctx.restore();
  }

  private drawLeaveChip(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    const w = 220;
    const h = 40;
    const x = 12;
    const y = height - h - 12;
    // Picker render resets chipRects; the game render appends to it —
    // keep exactly one leave chip by replacing any previous one.
    this.chipRects = this.chipRects.filter((c) => c.action !== 'leave');
    this.chipRects.push({ x, y, w, h, action: 'leave' });
    ctx.save();
    ctx.fillStyle = 'rgba(11, 11, 18, 0.72)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(232, 232, 240, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `20px ${RENDER.gameFont}`;
    ctx.fillStyle = '#e8e8f0';
    ctx.fillText('⬅ Leave to town', x + w / 2, y + h / 2);
    ctx.restore();
    void width;
  }

  private drawNoBody(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 28px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffd166';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 6;
    ctx.strokeText('Step into frame to refine!', width / 2, height / 2);
    ctx.fillText('Step into frame to refine!', width / 2, height / 2);
    ctx.restore();
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
