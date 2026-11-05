/**
 * Refiner state machine (v3.1, press v3.4): the pure carry-and-press
 * loop, no canvas, no DOM, no landmarks. It reads a tiny hand input
 * (are both hands together? where is their midpoint, in canvas space?
 * did a pedestal press just fire?) plus a stock adapter, so it is
 * unit-testable with synthetic inputs and runs unchanged on the real
 * tracker, the mouse simulator, and replay fixtures.
 *
 * THE LOOP (Brandon's design, Nov 4, 2026):
 * - pick: choose a recipe (gated by Refining level + owned ore).
 * - carrying: the input ore sits in a pile in a wheelbarrow/bin on
 *   one side — up to 10 visible at a time, refilling from owned stock
 *   when one is taken; fewer than 10 owned shows exactly the owned
 *   count. Both hands over the pile (together, held for
 *   `REFINER.grabDwellMs`) grab ONE ore — one at a time, both-hands
 *   requirement, consistent with the swing.
 * - carry the ore to the hopper on the other side: the ore unsticks
 *   and drops loose into the hopper. The hopper shows its fill (1/2,
 *   2/2) for the recipe's input quantity (2 ore).
 * - pressing: once the hopper holds the full input quantity, 3
 *   pedestal presses complete the batch -> 1 refined material + XP
 *   into inventory. The player can keep carrying (if they own more
 *   ore) or leave to the hub.
 * - Leaving mid-batch ABANDONS it: the carried ore and any ore in
 *   the hopper return to inventory. That is the simplest honest rule
 *   — nothing is ever lost to a pause — and `stop()` / `leave()`
 *   apply it. The batch is only spent when the presses complete.
 *
 * Failure -> Slag is NOT built: the active refiner always succeeds.
 *
 * The stock adapter is the inventory in the game (`inventory.add` /
 * `remove` / `count`); tests pass a Map-backed fake. Ore leaves the
 * stock the moment it is grabbed (it is in the player's hands, not
 * in the pile any more), so the pile count is always
 * `min(pileVisibleMax, owned)`.
 */

import { REFINER } from '../../core/config';
import type { InventoryItemId } from '../../core/inventory';
import {
  recipeAffordable,
  recipeById,
  recipeLockReason,
  recipeUnlocked,
  type RefiningRecipe,
} from './recipes';

/** The stock the machine draws ore from and pays output into. */
export interface RefinerStock {
  owned(itemId: InventoryItemId): number;
  /** Take `n` (false when not enough — the machine never takes blind). */
  take(itemId: InventoryItemId, n: number): boolean;
  give(itemId: InventoryItemId, n: number): void;
}

/** Hand input for one step, in canvas space (the game translates BodyState). */
export interface RefinerHandInput {
  /** A body is present and usable. */
  present: boolean;
  /** Both wrists are together (clasped on one point). */
  handsTogether: boolean;
  /** Midpoint of the two wrists, canvas space. */
  handX: number;
  handY: number;
  /** A pedestal press fired on this step (from `PressDetector`). */
  press: boolean;
}

export type RefinerPhase = 'pick' | 'carrying' | 'pressing' | 'done';

export type RefinerEventKind =
  | 'grabbed'
  | 'dropped'
  | 'press'
  | 'batch-complete';

/** What happened on this step (null = nothing). */
export interface RefinerEvent {
  kind: RefinerEventKind;
  message: string;
}

/** Read-only snapshot, for the HUD, render, and tests. */
export interface RefinerSnapshot {
  phase: RefinerPhase;
  recipeId: string | null;
  recipeName: string | null;
  /** Ore visible in the pile right now (cap 10, refill, under-10 = owned). */
  pileVisible: number;
  /** Ore owned of the recipe's input (after any grabbed/carried). */
  ownedInput: number;
  /** True while one ore is stuck to the hands. */
  carrying: boolean;
  /** Ore in the hopper (0..inputQuantity). */
  hopperFill: number;
  /** Pedestal presses done this batch (0..3). */
  pressesDone: number;
  /** Batches completed this session. */
  batchesDone: number;
  /** Last event (null until the first). */
  lastEvent: RefinerEvent | null;
  /** Hint line for the player. */
  hint: string;
}

const PICK_HINT = 'Pick a recipe to refine — tap a chip!';
const CARRY_HINT =
  'Both hands over the pile, hold — then carry the ore to the hopper!';
const PRESS_HINT = 'Hopper full! Press both buttons down — 3 presses to forge the bar!';

export class RefinerMachine {
  private readonly stock: RefinerStock;
  private recipe: RefiningRecipe | null = null;
  private phase: RefinerPhase = 'pick';
  private carrying = false;
  private hopperFill = 0;
  private pressesDone = 0;
  private batchesDone = 0;
  private lastEvent: RefinerEvent | null = null;
  /** ms both hands have been over the pile continuously (grab dwell). */
  private grabHeldSinceMs: number | null = null;
  /** Refining level the picker judges against (set by the game). */
  private refiningLevel = 1;

  public constructor(stock: RefinerStock) {
    this.stock = stock;
  }

  /** The picker reads this level for lock reasons. */
  public setRefiningLevel(level: number): void {
    this.refiningLevel = Math.max(1, level);
  }

  public get currentRecipe(): RefiningRecipe | null {
    return this.recipe;
  }

  public get currentPhase(): RefinerPhase {
    return this.phase;
  }

  /**
   * Start a batch on a recipe. False when the recipe is unknown,
   * locked by level, or unaffordable — the picker shows
   * `recipeLockReason` instead, so this is the enforcement, not the
   * UI. Starting a batch does NOT take ore: ore leaves the stock one
   * piece at a time, when grabbed.
   */
  public selectRecipe(recipeId: string): boolean {
    const recipe = recipeById(recipeId);
    if (recipe === undefined) return false;
    if (!recipeUnlocked(recipe, this.refiningLevel)) return false;
    if (!recipeAffordable(recipe, this.stock.owned(recipe.inputItemId))) {
      return false;
    }
    this.recipe = recipe;
    this.phase = 'carrying';
    this.carrying = false;
    this.hopperFill = 0;
    this.pressesDone = 0;
    this.grabHeldSinceMs = null;
    return true;
  }

  /** Back to the picker (hopper + carried ore return to inventory). */
  public backToPicker(): void {
    this.abandonBatch();
    this.recipe = null;
    this.phase = 'pick';
  }

  /**
   * Leave the refiner (hub / stop): abandon the live batch, carried
   * + hopper ore back in inventory. Safe to call with no batch live.
   */
  public leave(): void {
    this.abandonBatch();
    this.recipe = null;
    this.phase = 'pick';
  }

  /** Ore visible in the pile: cap 10, refill from stock, under-10 = owned. */
  public pileVisible(): number {
    if (this.recipe === null) return 0;
    return Math.min(REFINER.pileVisibleMax, this.stock.owned(this.recipe.inputItemId));
  }

  public snapshot(): RefinerSnapshot {
    const hint =
      this.phase === 'pick'
        ? PICK_HINT
        : this.phase === 'pressing'
          ? PRESS_HINT
          : this.carrying
            ? 'Carry it to the hopper on the other side!'
            : CARRY_HINT;
    return {
      phase: this.phase,
      recipeId: this.recipe?.id ?? null,
      recipeName: this.recipe?.name ?? null,
      pileVisible: this.pileVisible(),
      ownedInput:
        this.recipe === null
          ? 0
          : this.stock.owned(this.recipe.inputItemId),
      carrying: this.carrying,
      hopperFill: this.hopperFill,
      pressesDone: this.pressesDone,
      batchesDone: this.batchesDone,
      lastEvent: this.lastEvent,
      hint,
    };
  }

  /**
   * One step. `pile` / `hopper` are the canvas-space zones the hands
   * must be inside to grab / drop (the game owns the geometry). At
   * most one event per step.
   */
  public update(
    input: RefinerHandInput,
    pile: { x: number; y: number; w: number; h: number },
    hopper: { x: number; y: number; w: number; h: number },
    nowMs: number,
  ): RefinerEvent | null {
    if (this.phase === 'pick' || this.recipe === null) return null;
    if (!input.present) {
      this.grabHeldSinceMs = null;
      return null;
    }

    if (this.phase === 'pressing') {
      if (input.press) {
        this.pressesDone += 1;
        const event: RefinerEvent = {
          kind: 'press',
          message: `Press ${this.pressesDone}/${REFINER.pressesPerBatch}!`,
        };
        this.lastEvent = event;
        if (this.pressesDone >= REFINER.pressesPerBatch) {
          this.completeBatch(nowMs);
          // completeBatch replaces lastEvent with batch-complete.
          return this.lastEvent;
        }
        return event;
      }
      return null;
    }

    // Phase 'carrying' (or 'done' just after a batch — same handling).
    if (this.phase === 'done') this.phase = 'carrying';

    if (!this.carrying) {
      return this.stepGrab(input, pile, nowMs);
    }
    return this.stepCarry(input, hopper);
  }

  /** Both hands over the pile, together, held for the dwell -> grab one ore. */
  private stepGrab(
    input: RefinerHandInput,
    pile: { x: number; y: number; w: number; h: number },
    nowMs: number,
  ): RefinerEvent | null {
    if (this.recipe === null) return null;
    // No grabbing while the hopper is already full — the presses come first.
    if (this.hopperFill >= this.recipe.inputQuantity) return null;
    const overPile =
      input.handsTogether &&
      input.handX >= pile.x &&
      input.handX <= pile.x + pile.w &&
      input.handY >= pile.y &&
      input.handY <= pile.y + pile.h;
    if (!overPile) {
      this.grabHeldSinceMs = null;
      return null;
    }
    if (this.grabHeldSinceMs === null) this.grabHeldSinceMs = nowMs;
    if (nowMs - this.grabHeldSinceMs < REFINER.grabDwellMs) return null;
    // Take ONE ore from the stock — it is in the hands now, so the
    // pile refills from what is left on the next snapshot.
    if (!this.stock.take(this.recipe.inputItemId, 1)) {
      this.grabHeldSinceMs = null;
      return null;
    }
    this.carrying = true;
    this.grabHeldSinceMs = null;
    const event: RefinerEvent = {
      kind: 'grabbed',
      message: 'Got one! Carry it to the hopper!',
    };
    this.lastEvent = event;
    return event;
  }

  /** Carrying: hands inside the hopper zone drop the ore loose. */
  private stepCarry(
    input: RefinerHandInput,
    hopper: { x: number; y: number; w: number; h: number },
  ): RefinerEvent | null {
    if (this.recipe === null) return null;
    const overHopper =
      input.handX >= hopper.x &&
      input.handX <= hopper.x + hopper.w &&
      input.handY >= hopper.y &&
      input.handY <= hopper.y + hopper.h;
    if (!overHopper) return null;
    this.carrying = false;
    this.hopperFill += 1;
    const event: RefinerEvent = {
      kind: 'dropped',
      message: `Into the hopper! ${this.hopperFill}/${this.recipe.inputQuantity}`,
    };
    this.lastEvent = event;
    if (this.hopperFill >= this.recipe.inputQuantity) {
      this.phase = 'pressing';
      this.pressesDone = 0;
    }
    return event;
  }

  /** 3 presses done: pay out the output + XP, reset for the next batch. */
  private completeBatch(_nowMs: number): void {
    if (this.recipe === null) return;
    this.stock.give(this.recipe.outputItemId, this.recipe.outputQuantity);
    this.batchesDone += 1;
    this.hopperFill = 0;
    this.pressesDone = 0;
    this.phase = 'done';
    this.lastEvent = {
      kind: 'batch-complete',
      message:
        `+${this.recipe.outputQuantity} ${this.recipe.name}! ` +
        `+${this.recipe.xpPerBatch} Refining XP`,
    };
  }

  /** Return carried + hopper ore to the stock; called on leave / picker. */
  private abandonBatch(): void {
    if (this.recipe === null) return;
    const returning = (this.carrying ? 1 : 0) + this.hopperFill;
    if (returning > 0) {
      this.stock.give(this.recipe.inputItemId, returning);
    }
    this.carrying = false;
    this.hopperFill = 0;
    this.pressesDone = 0;
    this.grabHeldSinceMs = null;
  }
}

/** Lock reason for the picker, from the machine's level + live stock. */
export function pickerLockReason(
  recipe: RefiningRecipe,
  refiningLevel: number,
  ownedInput: number,
): string | null {
  return recipeLockReason(recipe, refiningLevel, ownedInput);
}
