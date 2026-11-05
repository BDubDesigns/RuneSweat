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
 * - Process: once the hopper holds the full input (2 ore), 3 pedestal
 *   presses complete the batch -> 1 refined material + XP. Progress
 *   shows 1/3, 2/3, 3/3 on screen. The press replaced the jumping
 *   step (v3.4): Brandon is too tall for his room to jump without his
 *   head/hands leaving the frame, so the jump never counted (0/3 on
 *   a textbook star shape, 13 s clip). Two pedestals slide up either
 *   side of the avatar; both wrists on the buttons + a downward push,
 *   held 300 ms, counts one press. No vertical space, no legs, hands
 *   stay separated (which also dodges the handedness-latch flip that
 *   meeting hands overhead used to trigger). v3.5 shrank them: the
 *   v3.4 pedestals were giant gold slabs at the far bottom corners
 *   that covered the pile/hopper labels and the Leave chip, with no
 *   distinct button. Now each pedestal is a slim post with a small
 *   pad that IS the detection zone, at resting-hand height beside
 *   the body — see `pedestalRectsForStage`. (v3.6 deleted the Leave
 *   chip entirely: it sat behind the left pad in the v3.5 playtest
 *   video, and the top-right action circle replaces it.)
 * - After a batch, keep carrying (if you own more ore) or leave to
 *   the hub. Leaving mid-batch ABANDONS it and the carried + hopper
 *   ore returns to inventory — nothing is ever lost to a pause.
 *   Leaving is the top-right action circle (v3.6): the old
 *   bottom-left "Leave to town" chip is gone — it sat half-hidden
 *   behind the left press pad in every frame of Brandon's v3.5
 *   playtest video, so the chip was deleted and the circle (dwell
 *   or mouse click) is the only way out by hand.
 *
 * Failure -> Slag is NOT built: the active refiner always succeeds.
 *
 * MOUSE-SIM (see README / PLAN for the full mapping): pointer steers
 * the torso, `A`+`D` clasps both hands to one point — move the clasp
 * over the pile to grab, over to the hopper to drop. Presses need `P`
 * (hold): both wrists animate onto the pedestal buttons and push
 * down. The full batch is sim-playable (see `refiner.test.ts`).
 *
 * The game owns only its simulation + canvas drawing + HUD string.
 * It reads `BodyState` only (via the machine + the press detector)
 * and the shared `inventory` store — no constructor changes:
 * `new RefinerGame(sfx)`. The coordinator wires leaving:
 * set `game.onLeaveToHub = () => ...` (called when the player
 * leaves via the top-right action circle — see `leaveToHub`);
 * the game itself abandons the batch first.
 */

import { PRESS, REFINER, RENDER, SIM, STAGE, SWING } from '../../core/config';
import type { SoundEffects } from '../../core/audio';
import { assetUrl } from '../../core/assetUrl';
import type { BodyState } from '../../core/bodyState';
import { PressDetector, pressButtonZones, type PressRect } from '../../core/pressDetector';
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

/** True when two canvas rects overlap (shared edges do not count). */
export function rectsIntersect(a: RefinerZone, b: RefinerZone): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/**
 * Pile / hopper labels sit this far ABOVE their zones (v3.5): the
 * pedestal posts run from the buttons all the way to the stage
 * bottom, so a label below the zones would sit right across a post.
 * Above the zones the labels clear everything — the title banner is
 * far above, the buttons far below.
 * 16 px (not 14): the 30 px estimate rect in `textLabelRect` must
 * clear the zone top, not just the real glyphs.
 */
const LABEL_ABOVE_PX = 16;

/**
 * Estimated canvas rect of a centred text label, for overlap tests.
 * 22 px bold game font averages ~12 px per character; 13 px is the
 * conservative estimate, so a label that clears this rect clears the
 * real text too. Height 30 covers the 22 px glyphs + the dark stroke.
 */
export function textLabelRect(
  cx: number,
  cy: number,
  text: string,
): RefinerZone {
  const w = Math.max(1, text.length * 13);
  return { x: cx - w / 2, y: cy - 15, w, h: 30 };
}

/** The exact label strings drawPile / drawHopper print. */
export function pileLabelText(shown: number, owned: number): string {
  return `Ore pile: ${shown} shown · ${owned} owned`;
}

export function hopperLabelText(fill: number, capacity: number): string {
  return `Hopper: ${fill}/${capacity}`;
}

/** Canvas rect of the pile label for a stage (label sits above the pile). */
export function pileLabelRect(
  width: number,
  height: number,
  shown: number,
  owned: number,
): RefinerZone {
  const pile = pileZoneForStage(width, height);
  return textLabelRect(
    pile.x + pile.w / 2,
    pile.y - LABEL_ABOVE_PX,
    pileLabelText(shown, owned),
  );
}

/** Canvas rect of the hopper label for a stage (label sits above the hopper). */
export function hopperLabelRect(
  width: number,
  height: number,
  fill: number,
  capacity: number,
): RefinerZone {
  const hopper = hopperZoneForStage(width, height);
  return textLabelRect(
    hopper.x + hopper.w / 2,
    hopper.y - LABEL_ABOVE_PX,
    hopperLabelText(fill, capacity),
  );
}

/**
 * Canvas-space torso box for the sim body standing at
 * (`hipMidX`, `hipMidY`) with torso length `torsoLength`: shoulders
 * ±`SIM.shoulderWidth` / 2 around the hip-mid, shoulder line to hip
 * line. The test reference for "the pedestals clear the avatar" —
 * a real body is wider or narrower, but the sim body is the geometry
 * the game itself lays out against.
 */
export function simTorsoBox(
  width: number,
  height: number,
  hipMidX = 0.5,
  hipMidY: number = SIM.standingHipY,
  torsoLength: number = SIM.torsoLength,
): RefinerZone {
  const topLeft = toCanvas(
    { x: hipMidX - SIM.shoulderWidth / 2, y: hipMidY - torsoLength, visibility: 1 },
    width,
    height,
  );
  const bottomRight = toCanvas(
    { x: hipMidX + SIM.shoulderWidth / 2, y: hipMidY, visibility: 1 },
    width,
    height,
  );
  return {
    x: Math.min(topLeft.x, bottomRight.x),
    y: Math.min(topLeft.y, bottomRight.y),
    w: Math.abs(bottomRight.x - topLeft.x),
    h: Math.abs(bottomRight.y - topLeft.y),
  };
}

/**
 * One pedestal's canvas rects: the button pad + the post under it.
 */
export interface PedestalRects {
  button: RefinerZone;
  post: RefinerZone;
}

/**
 * Pedestal geometry (v3.5) — pure, single source for render + tests.
 *
 * Each pedestal is a slim post with a small pad on top. The button
 * pad rect IS the detection zone rect from `pressButtonZones` —
 * same helper, one source, no invisible extra area and no drawn
 * area that does not detect (v3.4's bug was the drawn slabs being
 * far bigger than the zones). The post is narrower than its pad
 * (65% of the pad width), centred under it, running from the pad's
 * rest bottom to the stage bottom — a post, not a wall.
 *
 * The pad sinks as the press hold progresses, to full
 * `PRESS.pressDepthTorsoFrac` at hold-complete — capped at half the
 * pad's own height, so at the new small size the pad presses INTO
 * the post instead of vanishing into it. The post top stays at the
 * pad's REST bottom while the pad sinks over it.
 *
 * `slideT` 0..1 slides the whole pedestal up from below the stage
 * (same easing as the old draw code: at 0 the pad top sits at the
 * stage bottom); `pressProgress` 0..1 is the detector's live
 * progress (2/3 = both wrists in their zones, 1 = hold complete).
 */
export function pedestalRectsForStage(
  width: number,
  height: number,
  hipMidX: number,
  hipMidY: number,
  torsoLength: number,
  slideT = 1,
  pressProgress = 0,
): { left: PedestalRects; right: PedestalRects } {
  const zones = pressButtonZones(hipMidX, hipMidY, torsoLength);
  const sinkFrac = Math.min(
    1,
    Math.max(0, (pressProgress - 2 / 3) * 3),
  );
  const rectFor = (zone: PressRect): PedestalRects => {
    // toCanvas mirrors x: the video-space left zone is the
    // canvas-right pedestal. Take min/max, not the raw corners.
    const top = toCanvas(
      { x: zone.x, y: zone.y, visibility: 1 },
      width,
      height,
    );
    const bottom = toCanvas(
      { x: zone.x + zone.w, y: zone.y + zone.h, visibility: 1 },
      width,
      height,
    );
    const bx = Math.min(top.x, bottom.x);
    const bw = Math.abs(bottom.x - top.x);
    const by = top.y;
    const bh = bottom.y - top.y;
    // Slide: at slideT 0 the pad top sits at the stage bottom
    // (fully below the screen); at 1 it sits at its zone.
    const dy = (1 - slideT) * (height - by);
    const depressPx =
      Math.min(
        PRESS.pressDepthTorsoFrac * torsoLength * height,
        bh * 0.5,
      ) * sinkFrac;
    const postW = bw * 0.65;
    return {
      button: { x: bx, y: by + dy + depressPx, w: bw, h: bh },
      post: {
        x: bx + (bw - postW) / 2,
        y: by + dy + bh,
        w: postW,
        h: Math.max(0, height - (by + dy + bh)),
      },
    };
  };
  return { left: rectFor(zones.left), right: rectFor(zones.right) };
}

/**
 * Recipe-picker card geometry (v3.2): one opaque card per recipe.
 *
 * Cards are 640 x 96 — big tap targets — stacked from y 140 with a
 * 16 px gap, so two cards end at y 348: clear of the gate banner
 * (bottom y 40, see `GATE_BANNER` in `render/renderer.ts`). The
 * footer note sits below the cards. Pure, so tests can assert the
 * zones never overlap without a canvas. (v3.6: the bottom-left
 * "Leave to town" chip that used to sit at y 488 is deleted — the
 * top-right action circle replaces it.)
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

/** Whole picker layout for a stage: cards, title lines, footer. */
export interface PickerLayout {
  titleY: number;
  subtitleY: number;
  cards: PickerCardRect[];
  /** First footer line (selection hint); a second line follows +28. */
  footerY: number;
}

export function pickerCardLayout(width: number, _height: number): PickerLayout {
  // `_height` is unused since the v3.6 chip deletion: the layout is
  // top-anchored (title 60, cards from 140), nothing sits at the
  // stage bottom any more. The parameter stays so the (width, height)
  // call shape — and the footer placement it may serve again — does
  // not churn every caller.
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
  /** Pedestal presses done this batch (mirrors the machine). */
  presses: number;
  /** Current press progress 0..1 (live body feedback). */
  pressProgress: number;
  /** Pedestal slide 0..1 (0 = down / gone, 1 = fully up). */
  pedestalSlideT: number;
}

/**
 * Pedestal colours (v3.4): dark steel columns, gold buttons that
 * darken while pressed. Exported so tests can find the pedestals in
 * a recording context by fill style.
 */
export const PEDESTAL_STYLE = {
  column: '#3a3f4a',
  columnEdge: '#23262e',
  button: '#ffd166',
  buttonEdge: '#b8860b',
  /** Lighter gold strip across the pad face — at the new small size
   * this is what makes the pad read as a button, not a flat tile. */
  buttonTop: '#ffe08a',
  // Deeper gold than the buttons, on purpose: tests (and eyes)
  // tell the forging bar apart from the buttons by colour alone.
  bar: '#e8a93d',
  barEdge: '#b8860b',
} as const;

export class RefinerGame implements Game {
  public readonly id = 'refiner';
  public readonly title = 'Refiner';
  public paused = false;

  /**
   * Coordinator hook: called when the player leaves via the
   * top-right action circle (see `leaveToHub`), after the batch is
   * abandoned. `main.ts` sets this to switch back to Swing Lab +
   * open the hub. Null = leaving does nothing (the game just
   * returns to its picker).
   */
  public onLeaveToHub: (() => void) | null = null;

  private readonly sfx: SoundEffects;
  private readonly machine = new RefinerMachine({
    owned: (id) => inventory.count(id),
    take: (id, n) => inventory.remove(id, n),
    give: (id, n) => inventory.add(id, n),
  });
  private readonly pressDetector = new PressDetector();

  private lastWidth: number = STAGE.width;
  private lastHeight: number = STAGE.height;
  private lastPressProgress = 0;
  /** ms clock of the last update/render (drives the pedestal slide). */
  private lastNowMs = 0;
  /**
   * Pedestal slide state (v3.4): slide-in starts the frame the
   * machine enters 'pressing'; slide-out starts the frame it leaves
   * (batch complete or leave). Both run over `PRESS.slideMs`.
   */
  private pedestalInStartMs: number | null = null;
  private pedestalOutStartMs: number | null = null;
  /**
   * Last seen hip-mid + torso length: the pedestals render from the
   * live body when present, from these when it drops mid-press.
   */
  private lastHipMidX: number = 0.5;
  private lastHipMidY: number = SIM.standingHipY;
  private lastTorsoLength: number = SIM.torsoLength;
  private leaveRequested = false;
  /**
   * Recipe-picker cards, recomputed every render.
   * `action` is `'recipe:<id>'`.
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
    const prev = this.machine.currentRecipe?.id ?? null;
    this.machine.backToPicker();
    // The last recipe stays selected, so one tap re-starts it.
    this.selectedId = prev;
    this.announcementText = null;
    this.announcementUntilMs = 0;
    this.trackPedestals('pick', nowMs);
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
   * nothing — its lock reason is printed on the card itself.
   * Leaving is NOT a tap here any more (v3.6): the "Leave to town"
   * chip is deleted, and the coordinator calls `leaveToHub` from the
   * top-right action circle instead.
   */
  public pointerDownAt(x: number, y: number, _nowMs: number): boolean {
    // `_nowMs` is unused since the v3.6 chip deletion: the only
    // time-dependent branch was the Leave tap. The parameter stays
    // so the tap signature matches Swing Lab's `pointerDownAt` and
    // the coordinator's call shape does not churn.
    for (const card of this.cardRects) {
      if (x < card.x || x > card.x + card.w || y < card.y || y > card.y + card.h) {
        continue;
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

  /**
   * Leave for town (v3.6): the top-right action circle's town action.
   * Abandons the live batch (carried + hopper ore returns to
   * inventory) and fires `onLeaveToHub` — the coordinator restores
   * the suspended Swing Lab and opens the hub. This replaces the
   * deleted "Leave to town" chip's tap path; nothing else calls it.
   */
  public leaveToHub(nowMs: number): void {
    this.machine.leave();
    this.lastNowMs = nowMs;
    this.trackPedestals('pick', nowMs);
    this.leaveRequested = true;
    if (this.onLeaveToHub !== null) this.onLeaveToHub();
  }

  public start(): void {
    this.machine.setRefiningLevel(inventory.level('refining'));
    this.machine.leave();
    this.pressDetector.reset();
    this.pedestalInStartMs = null;
    this.pedestalOutStartMs = null;
    this.lastPressProgress = 0;
    this.paused = false;
    this.leaveRequested = false;
    this.selectedId = null;
    this.announcementText = null;
    this.announcementUntilMs = 0;
  }

  public stop(): void {
    this.machine.leave();
    this.trackPedestals('pick', this.lastNowMs);
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
    this.lastNowMs = nowMs;
    this.machine.setRefiningLevel(inventory.level('refining'));

    const width = this.lastWidth;
    const height = this.lastHeight;
    const pile = pileZoneForStage(width, height);
    const hopper = hopperZoneForStage(width, height);

    // Remember the body's hip-mid + torso: the pedestals render
    // from the live body when present, from these when it drops.
    // BodyState carries hip-mid directly as torsoX/torsoY (the
    // smoothed hip-midpoint) — there are no per-hip landmark fields.
    if (body !== null && body.present && body.torsoLength > 0) {
      this.lastHipMidX = body.torsoX;
      this.lastHipMidY = body.torsoY;
      this.lastTorsoLength = body.torsoLength;
    }

    // Pedestal press (v3.4): the detector only runs while the
    // machine is in 'pressing' AND the pedestals are fully up — a
    // press must never count while they are still sliding in.
    let pressEvent: { kind: 'press'; atMs: number } | null = null;
    this.lastPressProgress = 0;
    if (
      this.machine.snapshot().phase === 'pressing' &&
      body !== null &&
      body.present &&
      body.torsoLength > 0 &&
      this.pedestalSlideT(nowMs) >= 1
    ) {
      const left = { x: body.leftWristX, y: body.leftWristY };
      const right = { x: body.rightWristX, y: body.rightWristY };
      pressEvent = this.pressDetector.update(
        left,
        right,
        body.torsoX,
        body.torsoY,
        body.torsoLength,
        nowMs,
      );
      // Progress is a pure read — update first, then this.
      this.lastPressProgress = this.pressDetector.progress(
        left,
        right,
        body.torsoX,
        body.torsoY,
        body.torsoLength,
        nowMs,
      );
    }

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
        press: pressEvent !== null,
      },
      pile,
      hopper,
      nowMs,
    );
    if (event !== null) this.applyEvent(event, nowMs);
    this.trackPedestals(this.machine.snapshot().phase, nowMs);
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
    this.lastNowMs = nowMs;
    this.attachPointerListener(ctx.canvas);
    const snap = this.machine.snapshot();
    this.trackPedestals(snap.phase, nowMs);
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
    this.drawPedestals(ctx, width, height, body, nowMs);
    this.drawProgress(ctx, snap, width, height, nowMs);
    // No Leave chip here any more (v3.6): leaving is the top-right
    // action circle, drawn by main.ts — the game draws no exit UI.
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
      `<span>🔨 ${snap.pressesDone}/${REFINER.pressesPerBatch}</span> &nbsp; ` +
      `<span>${snap.hint}</span>`
    );
  }

  /** Read-only snapshot of the live state, for the debug HUD and tests. */
  public snapshot(): RefinerGameSnapshot {
    const snap = this.machine.snapshot();
    return {
      ...snap,
      presses: snap.pressesDone,
      pressProgress: this.lastPressProgress,
      pedestalSlideT: this.pedestalSlideT(this.lastNowMs),
    };
  }

  private applyEvent(event: RefinerEvent, nowMs: number): void {
    if (event.kind === 'dropped') this.sfx.reload();
    if (event.kind === 'grabbed') this.sfx.shoot();
    if (event.kind === 'press') {
      this.sfx.feedback('good');
    }
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

  /**
   * Pedestal slide state machine (v3.4). Entering 'pressing' starts
   * the slide-in (and re-arms the detector, so a stale hold from a
   * previous batch can never count); leaving 'pressing' starts the
   * slide-out. Called from update() and render() — whichever runs
   * first after the transition wins, and a repeated call is a no-op.
   */
  private trackPedestals(
    phase: RefinerSnapshot['phase'],
    nowMs: number,
  ): void {
    if (phase === 'pressing') {
      if (this.pedestalInStartMs === null) {
        this.pedestalInStartMs = nowMs;
        this.pedestalOutStartMs = null;
        this.pressDetector.reset();
      }
      return;
    }
    if (
      this.pedestalInStartMs !== null &&
      this.pedestalOutStartMs === null
    ) {
      this.pedestalOutStartMs = nowMs;
    }
  }

  /**
   * Pedestal slide 0..1 at `nowMs`: 0 = down / gone, 1 = fully up.
   * Slides in over `PRESS.slideMs` from the in-start, out over the
   * same from the out-start. Once the slide-out finishes the state
   * resets, so the next batch slides in from scratch.
   */
  private pedestalSlideT(nowMs: number): number {
    if (this.pedestalInStartMs === null) return 0;
    if (this.pedestalOutStartMs !== null) {
      const t = 1 - (nowMs - this.pedestalOutStartMs) / PRESS.slideMs;
      if (t <= 0) {
        this.pedestalInStartMs = null;
        this.pedestalOutStartMs = null;
        return 0;
      }
      return t;
    }
    return Math.min(
      1,
      Math.max(0, (nowMs - this.pedestalInStartMs) / PRESS.slideMs),
    );
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
    // Label ABOVE the pile (v3.5): the pedestal posts run to the
    // stage bottom, so a label below the pile would sit across a
    // post. See `pileLabelRect` — same position, one source.
    const label = pileLabelText(snap.pileVisible, snap.ownedInput);
    ctx.strokeText(label, pile.x + pile.w / 2, pile.y - LABEL_ABOVE_PX);
    ctx.fillText(label, pile.x + pile.w / 2, pile.y - LABEL_ABOVE_PX);
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
    // Forging bar (v3.4): while pressing, the ore in the hopper is a
    // gold bar that visibly squashes one step per press — full height
    // at 0 presses, a third of it at 2. On the 3rd press the batch
    // completes and the bar pops out (announcement, not drawn here).
    if (snap.phase === 'pressing') {
      const fullH = hopper.h * 0.3;
      const barH = Math.max(
        6,
        fullH * (1 - snap.pressesDone / REFINER.pressesPerBatch),
      );
      const barW = hopper.w * 0.4;
      const barX = hopper.x + (hopper.w - barW) / 2;
      const barY = hopper.y + hopper.h * 0.97 - barH;
      ctx.fillStyle = PEDESTAL_STYLE.bar;
      ctx.fillRect(barX, barY, barW, barH);
      ctx.strokeStyle = PEDESTAL_STYLE.barEdge;
      ctx.lineWidth = 2;
      ctx.strokeRect(barX, barY, barW, barH);
    }
    ctx.font = `700 22px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 5;
    // Label ABOVE the hopper (v3.5): same reason as the pile label —
    // the posts run to the stage bottom (see `hopperLabelRect`).
    const label = hopperLabelText(snap.hopperFill, REFINER.hopperCapacity);
    ctx.strokeText(label, hopper.x + hopper.w / 2, hopper.y - LABEL_ABOVE_PX);
    ctx.fillText(label, hopper.x + hopper.w / 2, hopper.y - LABEL_ABOVE_PX);
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
   * Pedestals (v3.5): slim posts with small pads, rendered from
   * `pedestalRectsForStage` — the pads ARE the detector's zones, so
   * what the player sees is exactly what detects (v3.4's slabs were
   * drawn far bigger than the zones and covered the pile/hopper
   * labels and the Leave chip). The pads sit at resting-hand height
   * where the zones sit; the press is a small downward push, not a
   * big travel. The pads sink into their posts as the hold
   * progresses (see the helper for the sink cap); a lighter strip
   * across the pad face is what reads as a button at this size.
   *
   * They slide up from below the stage over `PRESS.slideMs` when
   * the hopper fills and back down on batch-complete / leave. The
   * pile/hopper labels moved above their zones in v3.5 so the posts
   * — which run to the stage bottom — never cross a label.
   */
  private drawPedestals(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    body: BodyState | null,
    nowMs: number,
  ): void {
    const slideT = this.pedestalSlideT(nowMs);
    if (slideT <= 0) return;
    const hipMidX =
      body !== null && body.present ? body.torsoX : this.lastHipMidX;
    const hipMidY =
      body !== null && body.present ? body.torsoY : this.lastHipMidY;
    const torsoLength =
      body !== null && body.present && body.torsoLength > 0
        ? body.torsoLength
        : this.lastTorsoLength;
    const rects = pedestalRectsForStage(
      width,
      height,
      hipMidX,
      hipMidY,
      torsoLength,
      slideT,
      this.lastPressProgress,
    );
    ctx.save();
    for (const side of [rects.left, rects.right]) {
      // Post first (behind), pad on top: a sunk pad overlaps the
      // post's top and reads as pressed into it.
      if (side.post.h > 0) {
        ctx.fillStyle = PEDESTAL_STYLE.column;
        ctx.fillRect(side.post.x, side.post.y, side.post.w, side.post.h);
        ctx.strokeStyle = PEDESTAL_STYLE.columnEdge;
        ctx.lineWidth = 2;
        ctx.strokeRect(side.post.x, side.post.y, side.post.w, side.post.h);
      }
      ctx.fillStyle = PEDESTAL_STYLE.button;
      ctx.fillRect(
        side.button.x,
        side.button.y,
        side.button.w,
        side.button.h,
      );
      ctx.strokeStyle = PEDESTAL_STYLE.buttonEdge;
      ctx.lineWidth = 3;
      ctx.strokeRect(
        side.button.x,
        side.button.y,
        side.button.w,
        side.button.h,
      );
      // Pad face: a lighter strip across the top of the pad.
      const hlH = Math.max(2, Math.min(4, side.button.h * 0.18));
      ctx.fillStyle = PEDESTAL_STYLE.buttonTop;
      ctx.fillRect(
        side.button.x + 2,
        side.button.y + 2,
        Math.max(0, side.button.w - 4),
        hlH,
      );
    }
    ctx.restore();
  }

  /**
   * Title / phase banner ONLY (v3.2). The press progress lives in the
   * HUD (🔨 n/3) — the old canvas progress sat on the avatar's hat
   * (t70) — and the press instruction + last-event line duplicated the
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
