/**
 * Inventory store (v3.1): the module-singleton home for everything
 * the player owns — ore, refined materials, Credits, Mining and
 * Refining XP. Games and the hub import the singleton; the
 * `GameConstructor` only takes sound effects, so the store must be
 * importable with NO constructor changes — and it is: `import {
 * inventory } from '../core/inventory'`.
 *
 * API (all methods persist to the save immediately, so a refresh
 * never loses a batch):
 * - `inventory.count(id)` / `add(id, n)` / `remove(id, n): boolean`
 *   — `remove` returns false and changes nothing when the player
 *   does not own enough.
 * - `inventory.credits` / `addCredits(n)` / `spendCredits(n): boolean`
 * - `inventory.xp('mining' | 'refining')` / `addXp(skill, n)` /
 *   `level(skill)` — level = floor(xp / 100) + 1, starting at 1.
 * - `inventory.snapshot()` — a plain copy of the save (for the hub).
 * - `inventory.reset()` — clears everything (hub Reset option).
 *
 * The singleton loads from localStorage on first import. Tests (and
 * the coordinator's wiring) can build their own store with a fake
 * storage: `new InventoryStore(fakeStorage)` — the singleton is just
 * `new InventoryStore()` with the default storage. Swing Lab's own
 * in-memory ore/XP (v3) is NOT yet wired into this store — that is a
 * coordinator step: on a counted hit, Swing Lab should call
 * `inventory.add(tier.id, orePerHit)` and
 * `inventory.addXp('mining', xpPerHit)` (and read its starting ore/XP
 * from the store on `start()`). Until that lands, mining gains live
 * only in the Swing Lab session and the refiner/hub read the store.
 */

import { REFINER } from './config';
import {
  clearSave,
  defaultStorage,
  loadSave,
  writeSave,
  type SaveData,
  type SaveItemId,
  type StorageLike,
} from './save';

/** Item ids the inventory can hold. */
export type InventoryItemId = SaveItemId;

/** `'mining'` or `'refining'`. */
export type SkillId = 'mining' | 'refining';

/** XP per level, shared with the save (100, like Mining). */
export const XP_PER_LEVEL = REFINER.xpPerLevel;

/** Skill level for total XP: 100 XP per level, starting at level 1. */
export function skillLevel(xp: number): number {
  return Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1;
}

/** XP earned inside the current level (0..xpPerLevel-1). */
export function xpIntoLevel(xp: number): number {
  return Math.max(0, xp) % XP_PER_LEVEL;
}

export class InventoryStore {
  private data: SaveData;
  private readonly storage: StorageLike | null;

  public constructor(storage: StorageLike | null = defaultStorage()) {
    this.storage = storage;
    this.data = loadSave(storage);
  }

  /** How many of `id` the player owns (0 when absent). */
  public count(id: InventoryItemId): number {
    return this.data.inventory[id] ?? 0;
  }

  /** Add `n` of `id` (n <= 0 is a no-op). */
  public add(id: InventoryItemId, n: number): void {
    if (n <= 0) return;
    this.data.inventory[id] = this.count(id) + Math.floor(n);
    this.persist();
  }

  /**
   * Remove `n` of `id`. Returns false and changes nothing when the
   * player does not own enough (n <= 0 is a no-op that returns true).
   */
  public remove(id: InventoryItemId, n: number): boolean {
    if (n <= 0) return true;
    const owned = this.count(id);
    if (owned < n) return false;
    const left = owned - Math.floor(n);
    if (left <= 0) delete this.data.inventory[id];
    else this.data.inventory[id] = left;
    this.persist();
    return true;
  }

  /** Current Credits. */
  public get credits(): number {
    return this.data.credits;
  }

  /** Add Credits (n <= 0 is a no-op). */
  public addCredits(n: number): void {
    if (n <= 0) return;
    this.data.credits += Math.floor(n);
    this.persist();
  }

  /** Spend Credits; false (no change) when unaffordable. */
  public spendCredits(n: number): boolean {
    if (n <= 0) return true;
    if (this.data.credits < n) return false;
    this.data.credits -= Math.floor(n);
    this.persist();
    return true;
  }

  /** Total XP in a skill. */
  public xp(skill: SkillId): number {
    return skill === 'mining' ? this.data.miningXp : this.data.refiningXp;
  }

  /** Add XP to a skill (n <= 0 is a no-op). */
  public addXp(skill: SkillId, n: number): void {
    if (n <= 0) return;
    if (skill === 'mining') this.data.miningXp += Math.floor(n);
    else this.data.refiningXp += Math.floor(n);
    this.persist();
  }

  /** Current level in a skill (1 + floor(xp / 100)). */
  public level(skill: SkillId): number {
    return skillLevel(this.xp(skill));
  }

  /** Plain copy of the save, for the hub / debug HUD. */
  public snapshot(): SaveData {
    return {
      version: this.data.version,
      credits: this.data.credits,
      inventory: { ...this.data.inventory },
      miningXp: this.data.miningXp,
      refiningXp: this.data.refiningXp,
    };
  }

  /** Clear everything (hub Reset) — storage included. */
  public reset(): void {
    clearSave(this.storage);
    this.data = loadSave(this.storage);
    this.persist();
  }

  private persist(): void {
    writeSave(this.data, this.storage);
  }
}

/** The shared store. Games and the hub import this directly. */
export const inventory = new InventoryStore();
