import { describe, expect, it } from 'vitest';
import {
  REFINING_RECIPES,
  inputName,
  recipeAffordable,
  recipeById,
  recipeLockReason,
  recipeUnlocked,
} from './recipes';

describe('refining recipes', () => {
  it('has the two RuneSpace recipes with the real rates', () => {
    const ferrite = recipeById('refined-ferrite');
    expect(ferrite).toMatchObject({
      requiredRefiningLevel: 1,
      inputItemId: 'ferrite-shale',
      inputQuantity: 2,
      outputItemId: 'refined-ferrite',
      outputQuantity: 1,
      xpPerBatch: 15,
    });
    const galvanic = recipeById('galvanic-stock');
    expect(galvanic).toMatchObject({
      requiredRefiningLevel: 5,
      inputItemId: 'galvanite',
      inputQuantity: 2,
      outputItemId: 'galvanic-stock',
      outputQuantity: 1,
      xpPerBatch: 25,
    });
    expect(REFINING_RECIPES).toHaveLength(2);
  });

  it('gates on Refining level', () => {
    const ferrite = recipeById('refined-ferrite');
    const galvanic = recipeById('galvanic-stock');
    if (ferrite === undefined || galvanic === undefined) {
      throw new Error('recipes missing');
    }
    expect(recipeUnlocked(ferrite, 1)).toBe(true);
    expect(recipeUnlocked(galvanic, 1)).toBe(false);
    expect(recipeUnlocked(galvanic, 4)).toBe(false);
    expect(recipeUnlocked(galvanic, 5)).toBe(true);
  });

  it('gates on owned ore (2 per batch)', () => {
    const ferrite = recipeById('refined-ferrite');
    if (ferrite === undefined) throw new Error('recipe missing');
    expect(recipeAffordable(ferrite, 0)).toBe(false);
    expect(recipeAffordable(ferrite, 1)).toBe(false);
    expect(recipeAffordable(ferrite, 2)).toBe(true);
  });

  it('explains the lock: level first, then ore', () => {
    const galvanic = recipeById('galvanic-stock');
    if (galvanic === undefined) throw new Error('recipe missing');
    expect(recipeLockReason(galvanic, 1, 99)).toBe('Unlocks at Refining 5');
    expect(recipeLockReason(galvanic, 5, 1)).toContain('Needs 2 Galvanite');
    expect(recipeLockReason(galvanic, 5, 2)).toBeNull();
  });

  it('names the input ore for the lock message', () => {
    const ferrite = recipeById('refined-ferrite');
    const galvanic = recipeById('galvanic-stock');
    if (ferrite === undefined || galvanic === undefined) {
      throw new Error('recipes missing');
    }
    expect(inputName(ferrite)).toBe('Ferrite Shale');
    expect(inputName(galvanic)).toBe('Galvanite');
  });

  it('returns undefined for an unknown recipe', () => {
    expect(recipeById('galvaferrite')).toBeUndefined();
  });
});
