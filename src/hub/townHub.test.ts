import { beforeEach, describe, expect, it } from 'vitest';
import { inventory, InventoryStore } from '../core/inventory';
import type { StorageLike } from '../core/save';
import {
  bixSellPrice,
  sellAll,
  sellOne,
  TOWN_BACKGROUND,
  TownHub,
} from './townHub';

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

function stubContext(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get: (_t, prop) => {
      if (prop === 'canvas') return { width: 960, height: 540 };
      return () => undefined;
    },
    set: (t, prop, value) => {
      t[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/**
 * A recording stand-in: every method call is logged (name + args)
 * and every `fillStyle` set is recorded, so tests can prove the town
 * screen paints an opaque full-canvas background first.
 */
interface RecordedCall {
  method: string;
  args: unknown[];
}
function recordingContext(): {
  ctx: CanvasRenderingContext2D;
  calls: RecordedCall[];
  fillStyles: string[];
  texts: string[];
} {
  const calls: RecordedCall[] = [];
  const fillStyles: string[] = [];
  const texts: string[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get: (_t, prop) => {
      if (prop === 'canvas') return { width: 960, height: 540 };
      return (...args: unknown[]) => {
        calls.push({ method: String(prop), args });
        if (prop === 'fillText' && typeof args[0] === 'string') {
          texts.push(args[0]);
        }
      };
    },
    set: (t, prop, value) => {
      if (prop === 'fillStyle' && typeof value === 'string') {
        fillStyles.push(value);
      }
      t[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, fillStyles, texts };
}

describe('Bix sell prices (active-game-only)', () => {
  it('charges the config prices', () => {
    expect(bixSellPrice('ferrite-shale')).toBe(2);
    expect(bixSellPrice('galvanite')).toBe(4);
    expect(bixSellPrice('refined-ferrite')).toBe(6);
    expect(bixSellPrice('galvanic-stock')).toBe(10);
  });

  it('sell 1: -1 item, +price credits', () => {
    const store = new InventoryStore(new FakeStorage());
    store.add('ferrite-shale', 5);
    expect(sellOne(store, 'ferrite-shale')).toBe(2);
    expect(store.count('ferrite-shale')).toBe(4);
    expect(store.credits).toBe(2);
  });

  it('sell all: empties the stack and pays per unit', () => {
    const store = new InventoryStore(new FakeStorage());
    store.add('galvanic-stock', 3);
    expect(sellAll(store, 'galvanic-stock')).toBe(30);
    expect(store.count('galvanic-stock')).toBe(0);
    expect(store.credits).toBe(30);
  });

  it('selling what you do not own pays nothing', () => {
    const store = new InventoryStore(new FakeStorage());
    expect(sellOne(store, 'galvanite')).toBe(0);
    expect(sellAll(store, 'galvanite')).toBe(0);
    expect(store.credits).toBe(0);
  });
});

describe('TownHub', () => {
  beforeEach(() => {
    inventory.reset();
  });

  function setup() {
    const calls: string[] = [];
    const hub = new TownHub({
      onLeaveTown: () => calls.push('leave-town'),
      onOpenMine: () => calls.push('mine'),
      onOpenRefiner: () => calls.push('refiner'),
      onReset: () => calls.push('reset'),
    });
    const ctx = stubContext();
    return { hub, ctx, calls };
  }

  it('opens closed, renders, and Space leaves town', () => {
    const { hub, ctx, calls } = setup();
    expect(hub.isOpen).toBe(false);
    expect(hub.handlePointer(500, 200)).toBe(false);
    hub.open();
    expect(hub.isOpen).toBe(true);
    expect(() => hub.render(ctx, 1000)).not.toThrow();
    expect(hub.handleKey(' ')).toBe(true);
    expect(hub.isOpen).toBe(false);
    expect(calls).toEqual(['leave-town']);
  });

  it('Escape also leaves town; other keys do nothing', () => {
    const { hub, calls } = setup();
    hub.open();
    expect(hub.handleKey('a')).toBe(false);
    expect(hub.isOpen).toBe(true);
    expect(hub.handleKey('Escape')).toBe(true);
    expect(calls).toEqual(['leave-town']);
  });

  it('Mine button leaves town for the mine', () => {
    const { hub, ctx, calls } = setup();
    hub.open();
    hub.render(ctx, 1000);
    // Right column, first activity button: x 492..936, y 156..208.
    expect(hub.handlePointer(600, 182)).toBe(true);
    expect(calls).toEqual(['mine']);
    expect(hub.isOpen).toBe(false);
  });

  it('Refiner button opens the refiner (and closes the hub)', () => {
    const { hub, ctx, calls } = setup();
    hub.open();
    hub.render(ctx, 1000);
    // Right column, second activity button: x 492..936, y 218..270.
    expect(hub.handlePointer(600, 244)).toBe(true);
    expect(calls).toEqual(['refiner']);
    expect(hub.isOpen).toBe(false);
  });

  it("Bix's shop opens, sells 1 then all, and goes back", () => {
    const { hub, ctx, calls } = setup();
    inventory.add('ferrite-shale', 5);
    hub.open();
    hub.render(ctx, 1000);
    // Shop button: right column, third activity button, y 280..332.
    expect(hub.handlePointer(600, 306)).toBe(true);
    expect(hub.currentScreen).toBe('shop');
    expect(calls).toEqual([]);
    hub.render(ctx, 1000);
    // First row (Ferrite Shale): Sell 1 at x 686..796, y 142..182.
    expect(hub.handlePointer(740, 162)).toBe(true);
    expect(inventory.count('ferrite-shale')).toBe(4);
    expect(inventory.credits).toBe(2);
    // Sell all at x 806..936.
    expect(hub.handlePointer(870, 162)).toBe(true);
    expect(inventory.count('ferrite-shale')).toBe(0);
    expect(inventory.credits).toBe(2 + 4 * 2);
    // Back to town: bottom-left, x 24..244, y 476..524.
    expect(hub.handlePointer(100, 500)).toBe(true);
    expect(hub.currentScreen).toBe('main');
  });

  it('Reset is two-tap: first tap arms, second clears the save', () => {
    const { hub, ctx, calls } = setup();
    inventory.add('ferrite-shale', 9);
    inventory.addCredits(50);
    hub.open();
    hub.render(ctx, 1000);
    // Reset button: bottom-right, x 676..936, y 476..524.
    expect(hub.handlePointer(800, 500)).toBe(true);
    expect(hub.snapshot().resetArmed).toBe(true);
    expect(inventory.count('ferrite-shale')).toBe(9);
    expect(hub.handlePointer(800, 500)).toBe(true);
    expect(inventory.count('ferrite-shale')).toBe(0);
    expect(inventory.credits).toBe(0);
    expect(calls).toEqual(['reset']);
  });

  it('a missed tap disarms the Reset confirm', () => {
    const { hub, ctx } = setup();
    hub.open();
    hub.render(ctx, 1000);
    expect(hub.handlePointer(800, 500)).toBe(true);
    expect(hub.snapshot().resetArmed).toBe(true);
    expect(hub.handlePointer(480, 270)).toBe(false);
    expect(hub.snapshot().resetArmed).toBe(false);
  });

  it('renders the shop screen without throwing', () => {
    const { hub, ctx } = setup();
    inventory.add('galvanite', 3);
    inventory.add('refined-ferrite', 1);
    hub.open();
    hub.render(ctx, 1000);
    expect(hub.handlePointer(600, 306)).toBe(true);
    expect(() => hub.render(ctx, 1000)).not.toThrow();
  });

  it('the town screen is opaque: full-canvas solid fill first (v3.2)', () => {
    const { hub, calls } = setup();
    const rec = recordingContext();
    hub.open();
    hub.render(rec.ctx, 1000);
    expect(calls).toEqual([]);
    // The first fillRect of the frame covers the whole canvas, and
    // the fill in effect for it is the solid town background — no
    // dimmed overlay, nothing showing through from behind.
    const firstFill = rec.calls.find((c) => c.method === 'fillRect');
    expect(firstFill).toBeDefined();
    expect(firstFill?.args).toEqual([0, 0, 960, 540]);
    expect(rec.fillStyles[0]).toBe(TOWN_BACKGROUND);
    expect(TOWN_BACKGROUND).not.toContain('rgba');
    // The shop screen paints the same opaque backdrop.
    hub.handlePointer(600, 306);
    expect(hub.currentScreen).toBe('shop');
    rec.calls.length = 0;
    rec.fillStyles.length = 0;
    hub.render(rec.ctx, 1000);
    const shopFirstFill = rec.calls.find((c) => c.method === 'fillRect');
    expect(shopFirstFill?.args).toEqual([0, 0, 960, 540]);
    expect(rec.fillStyles[0]).toBe(TOWN_BACKGROUND);
  });

  it('no "Pause" / "Resume" wording anywhere in the town UI strings (v3.2)', () => {
    const { hub } = setup();
    const rec = recordingContext();
    hub.open();
    hub.render(rec.ctx, 1000);
    hub.handlePointer(600, 306);
    hub.render(rec.ctx, 1000);
    for (const text of rec.texts) {
      expect(text).not.toMatch(/pause/i);
      expect(text).not.toMatch(/resume/i);
    }
  });

  it('the Back button returns to the last activity, and Space does the same', () => {
    const { hub, ctx, calls } = setup();
    // Default: the mine.
    expect(hub.returnActivityLabel).toBe('⛏ Back to the mine');
    hub.open();
    hub.render(ctx, 1000);
    // Back button: bottom-left, x 24..344, y 476..524.
    expect(hub.handlePointer(180, 500)).toBe(true);
    expect(calls).toEqual(['leave-town']);
    expect(hub.isOpen).toBe(false);
    // From the refiner the label (set by main.ts) names refining.
    hub.setReturnLabel('🔥 Back to refining');
    expect(hub.returnActivityLabel).toBe('🔥 Back to refining');
    hub.open();
    expect(hub.handleKey(' ')).toBe(true);
    expect(calls).toEqual(['leave-town', 'leave-town']);
  });
});
