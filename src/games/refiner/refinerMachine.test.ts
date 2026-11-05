import { describe, expect, it } from 'vitest';
import { REFINER } from '../../core/config';
import type { InventoryItemId } from '../../core/inventory';
import { hopperZoneForStage, pileZoneForStage } from './refiner';
import {
  RefinerMachine,
  type RefinerHandInput,
  type RefinerStock,
} from './refinerMachine';

/** Map-backed stock, like the inventory store but in-memory for tests. */
class FakeStock implements RefinerStock {
  public readonly map = new Map<InventoryItemId, number>();
  public owned(itemId: InventoryItemId): number {
    return this.map.get(itemId) ?? 0;
  }
  public take(itemId: InventoryItemId, n: number): boolean {
    const owned = this.owned(itemId);
    if (owned < n) return false;
    this.map.set(itemId, owned - n);
    return true;
  }
  public give(itemId: InventoryItemId, n: number): void {
    this.map.set(itemId, this.owned(itemId) + n);
  }
}

const PILE = pileZoneForStage(960, 540);
const HOPPER = hopperZoneForStage(960, 540);

function overPile(): RefinerHandInput {
  return {
    present: true,
    handsTogether: true,
    handX: PILE.x + PILE.w / 2,
    handY: PILE.y + PILE.h / 2,
    press: false,
  };
}

function overHopper(): RefinerHandInput {
  return {
    present: true,
    handsTogether: true,
    handX: HOPPER.x + HOPPER.w / 2,
    handY: HOPPER.y + HOPPER.h / 2,
    press: false,
  };
}

function press(): RefinerHandInput {
  return { present: true, handsTogether: false, handX: 480, handY: 270, press: true };
}

function rest(): RefinerHandInput {
  return { present: true, handsTogether: false, handX: 480, handY: 270, press: false };
}

/** Grab one ore: hold both hands over the pile past the dwell. */
function grab(machine: RefinerMachine, t: number): number {
  machine.update(overPile(), PILE, HOPPER, t);
  const event = machine.update(overPile(), PILE, HOPPER, t + REFINER.grabDwellMs + 50);
  expect(event?.kind).toBe('grabbed');
  return t + REFINER.grabDwellMs + 50;
}

/** Carry the held ore to the hopper. */
function drop(machine: RefinerMachine, t: number): number {
  const event = machine.update(overHopper(), PILE, HOPPER, t + 16);
  expect(event?.kind).toBe('dropped');
  return t + 16;
}

function setup(shale = 20): { machine: RefinerMachine; stock: FakeStock } {
  const stock = new FakeStock();
  stock.map.set('ferrite-shale', shale);
  const machine = new RefinerMachine(stock);
  machine.setRefiningLevel(1);
  expect(machine.selectRecipe('refined-ferrite')).toBe(true);
  return { machine, stock };
}

describe('RefinerMachine recipe gating', () => {
  it('refuses a recipe above the Refining level', () => {
    const stock = new FakeStock();
    stock.map.set('galvanite', 10);
    const machine = new RefinerMachine(stock);
    machine.setRefiningLevel(1);
    expect(machine.selectRecipe('galvanic-stock')).toBe(false);
    expect(machine.snapshot().phase).toBe('pick');
  });

  it('refuses a recipe without enough ore', () => {
    const stock = new FakeStock();
    stock.map.set('ferrite-shale', 1);
    const machine = new RefinerMachine(stock);
    machine.setRefiningLevel(1);
    expect(machine.selectRecipe('refined-ferrite')).toBe(false);
  });

  it('refuses an unknown recipe', () => {
    const { machine } = setup();
    expect(machine.selectRecipe('galvaferrite')).toBe(false);
  });
});

describe('RefinerMachine pile', () => {
  it('shows at most 10, refilling from stock as ore is taken', () => {
    const { machine, stock } = setup(25);
    expect(machine.snapshot().pileVisible).toBe(10);
    let t = 0;
    t = grab(machine, t);
    expect(stock.owned('ferrite-shale')).toBe(24);
    expect(machine.snapshot().pileVisible).toBe(10);
    drop(machine, t);
    expect(machine.snapshot().hopperFill).toBe(1);
  });

  it('shows exactly the owned count when under 10', () => {
    const { machine } = setup(7);
    expect(machine.snapshot().pileVisible).toBe(7);
    expect(machine.snapshot().ownedInput).toBe(7);
  });

  it('shows an empty pile when the player owns none', () => {
    const stock = new FakeStock();
    const machine = new RefinerMachine(stock);
    machine.setRefiningLevel(1);
    expect(machine.selectRecipe('refined-ferrite')).toBe(false);
    expect(machine.snapshot().pileVisible).toBe(0);
  });
});

describe('RefinerMachine grab', () => {
  it('needs BOTH hands together over the pile', () => {
    const { machine } = setup();
    const apart = { ...overPile(), handsTogether: false };
    expect(machine.update(apart, PILE, HOPPER, 0)).toBeNull();
    expect(machine.update(apart, PILE, HOPPER, 500)).toBeNull();
    expect(machine.snapshot().carrying).toBe(false);
  });

  it('needs the dwell — a pass-through does not grab', () => {
    const { machine } = setup();
    expect(machine.update(overPile(), PILE, HOPPER, 0)).toBeNull();
    expect(machine.update(overPile(), PILE, HOPPER, REFINER.grabDwellMs - 50)).toBeNull();
    expect(machine.snapshot().carrying).toBe(false);
  });

  it('does not grab when the hands are over the pile but apart in space', () => {
    const { machine } = setup();
    const elsewhere: RefinerHandInput = {
      present: true,
      handsTogether: true,
      handX: 480,
      handY: 270,
      press: false,
    };
    expect(machine.update(elsewhere, PILE, HOPPER, 0)).toBeNull();
    expect(machine.update(elsewhere, PILE, HOPPER, 500)).toBeNull();
    expect(machine.snapshot().carrying).toBe(false);
  });

  it('does nothing with no body present', () => {
    const { machine } = setup();
    const absent: RefinerHandInput = { ...overPile(), present: false };
    expect(machine.update(absent, PILE, HOPPER, 0)).toBeNull();
    expect(machine.update(absent, PILE, HOPPER, 500)).toBeNull();
    expect(machine.snapshot().carrying).toBe(false);
  });
});

describe('RefinerMachine carry + hopper + pedestal presses', () => {
  it('carry to the hopper drops the ore and fills 1/2, then 2/2', () => {
    const { machine } = setup();
    let t = 0;
    t = grab(machine, t);
    expect(machine.snapshot().carrying).toBe(true);
    t = drop(machine, t);
    expect(machine.snapshot().hopperFill).toBe(1);
    expect(machine.snapshot().carrying).toBe(false);
    t = grab(machine, t);
    drop(machine, t);
    expect(machine.snapshot().hopperFill).toBe(2);
    expect(machine.snapshot().phase).toBe('pressing');
  });

  it('3 pedestal presses complete the batch: +1 output, hopper resets', () => {
    const { machine, stock } = setup(20);
    let t = 0;
    t = grab(machine, t);
    t = drop(machine, t);
    t = grab(machine, t);
    t = drop(machine, t);
    expect(machine.snapshot().phase).toBe('pressing');
    // 18 ore left (20 - 2 carried in); none refined yet.
    expect(stock.owned('ferrite-shale')).toBe(18);
    expect(stock.owned('refined-ferrite')).toBe(0);

    const first = machine.update(press(), PILE, HOPPER, t + 16);
    expect(first?.kind).toBe('press');
    expect(machine.snapshot().pressesDone).toBe(1);
    machine.update(press(), PILE, HOPPER, t + 32);
    expect(machine.snapshot().pressesDone).toBe(2);
    const done = machine.update(press(), PILE, HOPPER, t + 48);
    expect(done?.kind).toBe('batch-complete');
    expect(machine.snapshot().batchesDone).toBe(1);
    expect(machine.snapshot().hopperFill).toBe(0);
    expect(stock.owned('refined-ferrite')).toBe(1);
    expect(stock.owned('ferrite-shale')).toBe(18);
  });

  it('pedestal presses before the hopper is full do nothing', () => {
    const { machine } = setup();
    expect(machine.update(press(), PILE, HOPPER, 100)).toBeNull();
    expect(machine.snapshot().pressesDone).toBe(0);
  });

  it('leaving mid-batch returns carried + hopper ore to inventory', () => {
    const { machine, stock } = setup(10);
    let t = 0;
    t = grab(machine, t);
    t = drop(machine, t);
    expect(stock.owned('ferrite-shale')).toBe(9);
    grab(machine, t);
    expect(stock.owned('ferrite-shale')).toBe(8);
    machine.leave();
    expect(stock.owned('ferrite-shale')).toBe(10);
    expect(machine.snapshot().phase).toBe('pick');
    expect(machine.snapshot().hopperFill).toBe(0);
    expect(machine.snapshot().carrying).toBe(false);
  });

  it('back to the picker also returns the hopper ore', () => {
    const { machine, stock } = setup(10);
    let t = 0;
    t = grab(machine, t);
    drop(machine, t);
    machine.backToPicker();
    expect(stock.owned('ferrite-shale')).toBe(10);
    expect(machine.snapshot().phase).toBe('pick');
  });

  it('rest does not advance the press count', () => {
    const { machine } = setup();
    let t = 0;
    t = grab(machine, t);
    t = drop(machine, t);
    t = grab(machine, t);
    t = drop(machine, t);
    expect(machine.update(rest(), PILE, HOPPER, t + 16)).toBeNull();
    expect(machine.snapshot().pressesDone).toBe(0);
  });
});
