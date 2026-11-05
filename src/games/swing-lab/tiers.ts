/**
 * RuneSpace mining tiers for Swing Lab (v3).
 *
 * Sourced from the RuneSpace repo (`game/config/balance.ts`, main ba93790,
 * mining `sources`): the level requirement and XP per hit are RuneSpace's
 * own `requiredMiningLevel` / `successXp` for each mining action, copied
 * here so the prototype pays the real game's rates. The level curve
 * (100 XP per level) stays Swing Lab's own (`SWING.xpPerLevel`).
 *
 * - Ferrite Shale: The Jag, Mining 1, 15 XP/hit. The L1 node — playable now.
 * - Galvanite: Deep Jag, Mining 5, 25 XP/hit. Locked until Mining 5.
 *
 * Adding the next tier is a data-only change: append one entry to
 * `MINING_TIERS` (with its RuneSpace values + art file) and nothing else
 * in the game needs to change — the selector, the lock, the ore drops and
 * the XP all read this table.
 */

import type { SaveItemId } from '../../core/save';

/** One mineable RuneSpace ore node. */
export interface MiningTier {
  /**
   * Stable id: `'ferrite-shale'`, `'galvanite'`, ... — a `SaveItemId`,
   * not a bare string, so a tier's ore can go straight into the
   * inventory store (v3.1) with no cast. A new tier must first be a
   * known save item id.
   */
  id: SaveItemId;
  /** RuneSpace item name: `'Ferrite Shale'`. */
  name: string;
  /** Where it is mined in RuneSpace: `'The Jag'`. */
  location: string;
  /** RuneSpace `requiredMiningLevel` for the mining action. */
  requiredMiningLevel: number;
  /** RuneSpace `successXp` — XP per counted hit in Swing Lab. */
  xpPerHit: number;
  /** Ore per counted hit (RuneSpace yield is 1-2; Swing Lab pays 1). */
  orePerHit: number;
  /**
   * Ore art, relative to `public/` (resolved with `assetUrl`, never a
   * leading slash). Copied from RuneSpace `public/item-art/`.
   */
  oreImage: string;
  /**
   * Colour of the ore crystals drawn embedded in the rock face, sampled
   * from the real art: Ferrite Shale's vein is rusty orange, Galvanite's
   * is bright silver.
   */
  crystalColor: string;
}

export const MINING_TIERS: readonly MiningTier[] = [
  {
    id: 'ferrite-shale',
    name: 'Ferrite Shale',
    location: 'The Jag',
    requiredMiningLevel: 1,
    xpPerHit: 15,
    orePerHit: 1,
    oreImage: 'item-art/ferrite-shale.webp',
    crystalColor: '#d97b3f',
  },
  {
    id: 'galvanite',
    name: 'Galvanite',
    location: 'Deep Jag',
    requiredMiningLevel: 5,
    xpPerHit: 25,
    orePerHit: 1,
    oreImage: 'item-art/galvanite.webp',
    crystalColor: '#d7dde6',
  },
] as const;

/** The node a fresh game starts on: the level 1 ore. */
export const DEFAULT_TIER_ID = 'ferrite-shale';

/** Look a tier up by id; `undefined` for an unknown id. */
export function tierById(id: string): MiningTier | undefined {
  return MINING_TIERS.find((tier) => tier.id === id);
}

/** True when a player at `miningLevel` may mine this tier. */
export function tierUnlocked(tier: MiningTier, miningLevel: number): boolean {
  return miningLevel >= tier.requiredMiningLevel;
}

/** What the selector shows for a tier the player cannot mine yet. */
export function tierLockMessage(tier: MiningTier): string {
  return `Unlocks at Mining ${tier.requiredMiningLevel} — ${tier.location}`;
}
