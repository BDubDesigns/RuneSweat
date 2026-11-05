/**
 * Local save (v3.1): inventory, skill XP, and Credits persist in
 * localStorage under a versioned key. Single-player, no server, no
 * leaderboard — local save is the model (cheating only ruins your own
 * fun, per Brandon's corrected plan for Get Rich Quick GIT: no local
 * currency save there because a leaderboard was planned; here there
 * is no leaderboard, so local is fine).
 *
 * The payload is a plain data shape — `version`, `credits`, inventory
 * counts by item id, `miningXp`, `refiningXp` — so it stays easy to
 * inspect in DevTools and to migrate. Loading is tolerant by design:
 * a missing, corrupt, or older-version save falls back to a fresh
 * save and never crashes; unknown inventory ids are dropped, unknown
 * fields are ignored, negative counts / XP / credits are clamped to 0.
 *
 * Storage is injected (`StorageLike`) so tests run against a fake and
 * game code runs against `localStorage`. Every read/write is wrapped
 * in try/catch: private mode / full storage must degrade to a fresh
 * in-memory save, never throw.
 */

import { SAVE } from './config';

/** Item ids the save can hold. Keep in sync with `inventory.ts`. */
export type SaveItemId =
  | 'ferrite-shale'
  | 'galvanite'
  | 'refined-ferrite'
  | 'galvanic-stock';

/** The saved payload. */
export interface SaveData {
  version: number;
  credits: number;
  /** Counts by item id. Absent = 0. */
  inventory: Partial<Record<SaveItemId, number>>;
  miningXp: number;
  refiningXp: number;
}

/** Minimal storage surface (localStorage satisfies this). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Default storage: `localStorage` in the browser, null in node/tests. */
export function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    return null;
  }
  return null;
}

/** A fresh save: no credits, empty inventory, both skills at 0 XP. */
export function freshSave(): SaveData {
  return {
    version: SAVE.version,
    credits: 0,
    inventory: {},
    miningXp: 0,
    refiningXp: 0,
  };
}

const KNOWN_ITEMS: readonly SaveItemId[] = [
  'ferrite-shale',
  'galvanite',
  'refined-ferrite',
  'galvanic-stock',
];

/** Is `value` a finite non-negative number? */
function cleanNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

/**
 * Validate + normalise an unknown parsed payload. Returns a fresh
 * save for anything that is not a version-1 object (wrong version,
 * wrong shape, unparseable) — the caller never sees a crash, and an
 * old version is a clean slate, not a migration (v1 is the first).
 */
export function parseSave(raw: string | null): SaveData {
  if (raw === null) return freshSave();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return freshSave();
  }
  if (typeof parsed !== 'object' || parsed === null) return freshSave();
  const obj = parsed as Record<string, unknown>;
  if (obj['version'] !== SAVE.version) return freshSave();
  const inventory: Partial<Record<SaveItemId, number>> = {};
  const rawInventory = obj['inventory'];
  if (typeof rawInventory === 'object' && rawInventory !== null) {
    const inv = rawInventory as Record<string, unknown>;
    for (const id of KNOWN_ITEMS) {
      const count = cleanNumber(inv[id]);
      if (count > 0) inventory[id] = count;
    }
  }
  return {
    version: SAVE.version,
    credits: cleanNumber(obj['credits']),
    inventory,
    miningXp: cleanNumber(obj['miningXp']),
    refiningXp: cleanNumber(obj['refiningXp']),
  };
}

/** Load the save from storage (fresh save when missing/corrupt/old). */
export function loadSave(storage: StorageLike | null = defaultStorage()): SaveData {
  if (storage === null) return freshSave();
  try {
    return parseSave(storage.getItem(SAVE.key));
  } catch {
    return freshSave();
  }
}

/** Write the save to storage. Silently no-ops when storage is absent. */
export function writeSave(
  data: SaveData,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(SAVE.key, JSON.stringify({ ...data, version: SAVE.version }));
  } catch {
    // Storage full / unavailable — the in-memory game keeps running.
  }
}

/** Clear the stored save (the hub's Reset option). */
export function clearSave(
  storage: StorageLike | null = defaultStorage(),
): void {
  if (storage === null) return;
  try {
    storage.removeItem(SAVE.key);
  } catch {
    // Nothing to do — the save is already effectively gone.
  }
}
