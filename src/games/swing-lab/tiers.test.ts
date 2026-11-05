import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIER_ID,
  MINING_TIERS,
  tierById,
  tierLockMessage,
  tierUnlocked,
} from './tiers';

/**
 * RuneSpace mining tiers (Swing Lab v3). Values are RuneSpace's own from
 * `game/config/balance.ts` (main ba93790): Ferrite Shale — The Jag,
 * requiredMiningLevel 1, successXp 15; Galvanite — Deep Jag,
 * requiredMiningLevel 5, successXp 25.
 */
describe('Mining tiers', () => {
  it('ships Ferrite Shale first and Galvanite second', () => {
    expect(MINING_TIERS.map((tier) => tier.id)).toEqual([
      'ferrite-shale',
      'galvanite',
    ]);
    expect(DEFAULT_TIER_ID).toBe('ferrite-shale');
  });

  it('Ferrite Shale is the level 1 node: The Jag, 15 XP per hit', () => {
    const tier = tierById('ferrite-shale');
    expect(tier).toBeDefined();
    expect(tier?.name).toBe('Ferrite Shale');
    expect(tier?.location).toBe('The Jag');
    expect(tier?.requiredMiningLevel).toBe(1);
    expect(tier?.xpPerHit).toBe(15);
    expect(tier?.orePerHit).toBe(1);
    expect(tier?.oreImage).toBe('item-art/ferrite-shale.webp');
  });

  it('Galvanite is the level 5 node: Deep Jag, 25 XP per hit', () => {
    const tier = tierById('galvanite');
    expect(tier).toBeDefined();
    expect(tier?.name).toBe('Galvanite');
    expect(tier?.location).toBe('Deep Jag');
    expect(tier?.requiredMiningLevel).toBe(5);
    expect(tier?.xpPerHit).toBe(25);
    expect(tier?.orePerHit).toBe(1);
    expect(tier?.oreImage).toBe('item-art/galvanite.webp');
  });

  it('Galvanite is locked below Mining 5 and open at Mining 5', () => {
    const galvanite = tierById('galvanite');
    if (galvanite === undefined) throw new Error('galvanite tier missing');
    expect(tierUnlocked(galvanite, 1)).toBe(false);
    expect(tierUnlocked(galvanite, 4)).toBe(false);
    expect(tierUnlocked(galvanite, 5)).toBe(true);
    expect(tierUnlocked(galvanite, 9)).toBe(true);
  });

  it('Ferrite Shale is unlocked from level 1', () => {
    const ferrite = tierById('ferrite-shale');
    if (ferrite === undefined) throw new Error('ferrite tier missing');
    expect(tierUnlocked(ferrite, 1)).toBe(true);
  });

  it('the lock message names the level and the location', () => {
    const galvanite = tierById('galvanite');
    if (galvanite === undefined) throw new Error('galvanite tier missing');
    expect(tierLockMessage(galvanite)).toBe('Unlocks at Mining 5 — Deep Jag');
  });

  it('unknown tier ids look up as undefined (no crash, no default)', () => {
    expect(tierById('no-such-ore')).toBeUndefined();
  });

  it('every tier has art + a crystal colour (data-only extension point)', () => {
    for (const tier of MINING_TIERS) {
      expect(tier.oreImage).toMatch(/^item-art\/[a-z-]+\.webp$/);
      expect(tier.crystalColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(tier.xpPerHit).toBeGreaterThan(0);
      expect(tier.requiredMiningLevel).toBeGreaterThanOrEqual(1);
    }
  });
});
