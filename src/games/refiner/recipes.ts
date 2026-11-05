/**
 * Refining recipes for the Refiner (v3.1).
 *
 * Sourced from the RuneSpace repo (`game/config/balance.ts`, main
 * ba93790, refining `recipes`): the level requirement, input, output
 * and success XP are RuneSpace's own `minimumLevel` / `inputs` /
 * `outputItemId` / `successXp`, copied here so the prototype pays the
 * real game's rates. The level curve (100 XP per level) stays the
 * active game's own (`REFINER.xpPerLevel`).
 *
 * - Refined Ferrite: Refining 1, 2 Ferrite Shale -> 1 Refined Ferrite, 15 XP.
 * - Galvanic Stock: Refining 5, 2 Galvanite -> 1 Galvanic Stock, 25 XP.
 *
 * Failure -> Slag is NOT built this round: the active refiner always
 * succeeds (RuneSpace: Refined Ferrite failure -> 1 Slag, 3 XP;
 * Galvanic Stock failure -> 2 Slag, 5 XP). Whether to add a failure
 * chance later is an open question in PLAN.md.
 *
 * NEXT recipe (not this round): Galvaferrite — Refining 8, 1 Refined
 * Ferrite + 1 Galvanic Stock -> 1 Galvaferrite, 35 XP. It needs a
 * two-input recipe, so it waits for the machine to support more than
 * one input item; adding it is a data-only change once that lands.
 */

import type { InventoryItemId } from '../../core/inventory';

/** One refining recipe. */
export interface RefiningRecipe {
  /** Stable id: `'refined-ferrite'`, `'galvanic-stock'`, ... */
  id: string;
  /** RuneSpace item name of the OUTPUT: `'Refined Ferrite'`. */
  name: string;
  /** The output item id (an inventory id). */
  outputItemId: InventoryItemId;
  /** RuneSpace `minimumLevel` for the recipe. */
  requiredRefiningLevel: number;
  /** The single input item id (v3.1 recipes have exactly one input). */
  inputItemId: InventoryItemId;
  /** RuneSpace input quantity (2 for both v3.1 recipes). */
  inputQuantity: number;
  /** RuneSpace `successXp` — XP per completed batch. */
  xpPerBatch: number;
  /** Output units per completed batch (1 for both v3.1 recipes). */
  outputQuantity: number;
  /**
   * Output art, relative to `public/` (resolved with `assetUrl`,
   * never a leading slash). Copied from RuneSpace `public/item-art/`.
   */
  outputImage: string;
  /** Colour of the output's drawn fallback gem (sampled from the art). */
  fallbackColor: string;
}

export const REFINING_RECIPES: readonly RefiningRecipe[] = [
  {
    id: 'refined-ferrite',
    name: 'Refined Ferrite',
    outputItemId: 'refined-ferrite',
    requiredRefiningLevel: 1,
    inputItemId: 'ferrite-shale',
    inputQuantity: 2,
    xpPerBatch: 15,
    outputQuantity: 1,
    outputImage: 'item-art/refined-ferrite.webp',
    fallbackColor: '#d97b3f',
  },
  {
    id: 'galvanic-stock',
    name: 'Galvanic Stock',
    outputItemId: 'galvanic-stock',
    requiredRefiningLevel: 5,
    inputItemId: 'galvanite',
    inputQuantity: 2,
    xpPerBatch: 25,
    outputQuantity: 1,
    outputImage: 'item-art/galvanic-stock.webp',
    fallbackColor: '#d7dde6',
  },
] as const;

/** Look a recipe up by id; `undefined` for an unknown id. */
export function recipeById(id: string): RefiningRecipe | undefined {
  return REFINING_RECIPES.find((recipe) => recipe.id === id);
}

/** True when a player at `refiningLevel` may use this recipe. */
export function recipeUnlocked(
  recipe: RefiningRecipe,
  refiningLevel: number,
): boolean {
  return refiningLevel >= recipe.requiredRefiningLevel;
}

/** True when the player owns enough input ore for one batch. */
export function recipeAffordable(
  recipe: RefiningRecipe,
  ownedInput: number,
): boolean {
  return ownedInput >= recipe.inputQuantity;
}

/**
 * Why a recipe cannot be started right now, or null when it can:
 * level first, then ore. The picker shows this on the locked chip.
 */
export function recipeLockReason(
  recipe: RefiningRecipe,
  refiningLevel: number,
  ownedInput: number,
): string | null {
  if (!recipeUnlocked(recipe, refiningLevel)) {
    return `Unlocks at Refining ${recipe.requiredRefiningLevel}`;
  }
  if (!recipeAffordable(recipe, ownedInput)) {
    return `Needs ${recipe.inputQuantity} ${inputName(recipe)} (own ${ownedInput})`;
  }
  return null;
}

/** Display name of a recipe's input ore. */
export function inputName(recipe: RefiningRecipe): string {
  return recipe.inputItemId === 'ferrite-shale'
    ? 'Ferrite Shale'
    : recipe.inputItemId === 'galvanite'
      ? 'Galvanite'
      : recipe.inputItemId;
}
