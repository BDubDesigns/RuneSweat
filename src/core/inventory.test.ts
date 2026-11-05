import { describe, expect, it } from 'vitest';
import { InventoryStore, skillLevel, xpIntoLevel } from './inventory';
import type { StorageLike } from './save';

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

function freshStore(): InventoryStore {
  return new InventoryStore(new FakeStorage());
}

describe('skill levels', () => {
  it('starts at level 1 and levels every 100 XP', () => {
    expect(skillLevel(0)).toBe(1);
    expect(skillLevel(99)).toBe(1);
    expect(skillLevel(100)).toBe(2);
    expect(skillLevel(250)).toBe(3);
  });

  it('reports XP inside the current level', () => {
    expect(xpIntoLevel(0)).toBe(0);
    expect(xpIntoLevel(150)).toBe(50);
  });
});

describe('InventoryStore', () => {
  it('starts empty: no ore, no credits, both skills at level 1', () => {
    const store = freshStore();
    expect(store.count('ferrite-shale')).toBe(0);
    expect(store.credits).toBe(0);
    expect(store.level('mining')).toBe(1);
    expect(store.level('refining')).toBe(1);
  });

  it('adds and removes items, and refuses to overdraw', () => {
    const store = freshStore();
    store.add('ferrite-shale', 5);
    expect(store.count('ferrite-shale')).toBe(5);
    expect(store.remove('ferrite-shale', 2)).toBe(true);
    expect(store.count('ferrite-shale')).toBe(3);
    expect(store.remove('ferrite-shale', 4)).toBe(false);
    expect(store.count('ferrite-shale')).toBe(3);
    expect(store.remove('galvanite', 1)).toBe(false);
  });

  it('tracks credits and refuses to overspend', () => {
    const store = freshStore();
    store.addCredits(10);
    expect(store.credits).toBe(10);
    expect(store.spendCredits(4)).toBe(true);
    expect(store.credits).toBe(6);
    expect(store.spendCredits(7)).toBe(false);
    expect(store.credits).toBe(6);
  });

  it('tracks XP and levels per skill independently', () => {
    const store = freshStore();
    store.addXp('refining', 15);
    expect(store.level('refining')).toBe(1);
    expect(store.xp('refining')).toBe(15);
    expect(store.level('mining')).toBe(1);
    store.addXp('refining', 90);
    expect(store.level('refining')).toBe(2);
    expect(store.level('mining')).toBe(1);
  });

  it('persists across store instances on the same storage', () => {
    const storage = new FakeStorage();
    const first = new InventoryStore(storage);
    first.add('galvanite', 4);
    first.addCredits(25);
    first.addXp('mining', 120);
    const second = new InventoryStore(storage);
    expect(second.count('galvanite')).toBe(4);
    expect(second.credits).toBe(25);
    expect(second.level('mining')).toBe(2);
  });

  it('reset clears everything, storage included', () => {
    const storage = new FakeStorage();
    const store = new InventoryStore(storage);
    store.add('ferrite-shale', 9);
    store.addCredits(50);
    store.addXp('refining', 200);
    store.reset();
    expect(store.count('ferrite-shale')).toBe(0);
    expect(store.credits).toBe(0);
    expect(store.level('refining')).toBe(1);
    expect(new InventoryStore(storage).credits).toBe(0);
  });
});
