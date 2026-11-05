import { describe, expect, it } from 'vitest';
import { SAVE } from './config';
import {
  clearSave,
  freshSave,
  loadSave,
  parseSave,
  writeSave,
  type StorageLike,
} from './save';

/** In-memory stand-in for localStorage. */
class FakeStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  public getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  public setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  public removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe('save', () => {
  it('uses the versioned key', () => {
    expect(SAVE.key).toBe('activersespace-save-v1');
    expect(SAVE.version).toBe(1);
  });

  it('round-trips a save through storage', () => {
    const storage = new FakeStorage();
    const save = freshSave();
    save.credits = 42;
    save.inventory = { 'ferrite-shale': 7, 'refined-ferrite': 2 };
    save.miningXp = 150;
    save.refiningXp = 30;
    writeSave(save, storage);
    expect(loadSave(storage)).toEqual({
      version: 1,
      credits: 42,
      inventory: { 'ferrite-shale': 7, 'refined-ferrite': 2 },
      miningXp: 150,
      refiningXp: 30,
    });
  });

  it('loads a fresh save when nothing is stored', () => {
    expect(loadSave(new FakeStorage())).toEqual(freshSave());
  });

  it('falls back to fresh on corrupt JSON, never throws', () => {
    expect(parseSave('not json at all')).toEqual(freshSave());
    expect(parseSave('{"version":1')).toEqual(freshSave());
    expect(parseSave('[]')).toEqual(freshSave());
    expect(parseSave('"hello"')).toEqual(freshSave());
    expect(() => loadSave(new FakeStorage())).not.toThrow();
  });

  it('falls back to fresh on an older version', () => {
    const old = JSON.stringify({
      version: 0,
      credits: 999,
      inventory: { 'ferrite-shale': 99 },
      miningXp: 999,
      refiningXp: 999,
    });
    expect(parseSave(old)).toEqual(freshSave());
  });

  it('falls back to fresh on a newer version', () => {
    const future = JSON.stringify({ version: 2, credits: 5 });
    expect(parseSave(future)).toEqual(freshSave());
  });

  it('drops unknown item ids and clamps negative / fractional values', () => {
    const raw = JSON.stringify({
      version: 1,
      credits: -5,
      inventory: { 'ferrite-shale': 3.7, 'mystery-ore': 10, galvanite: -2 },
      miningXp: 12.9,
      refiningXp: 'lots',
    });
    expect(parseSave(raw)).toEqual({
      version: 1,
      credits: 0,
      inventory: { 'ferrite-shale': 3 },
      miningXp: 12,
      refiningXp: 0,
    });
  });

  it('clearSave removes the stored save', () => {
    const storage = new FakeStorage();
    writeSave({ ...freshSave(), credits: 10 }, storage);
    expect(storage.getItem(SAVE.key)).not.toBeNull();
    clearSave(storage);
    expect(storage.getItem(SAVE.key)).toBeNull();
    expect(loadSave(storage)).toEqual(freshSave());
  });

  it('tolerates a storage that throws', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadSave(throwing)).toEqual(freshSave());
    expect(() => writeSave(freshSave(), throwing)).not.toThrow();
    expect(() => clearSave(throwing)).not.toThrow();
  });
});
