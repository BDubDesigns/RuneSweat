import { describe, expect, it } from 'vitest';
import {
  HAIRSTYLES,
  SHIRT_COLORS,
  SKIN_TONES,
  STARTER_APPEARANCE,
} from '../creator/avatarAppearance';
import { CharacterCreator, type CreatorResult } from './characterCreator';
import {
  closetLayout,
  hitTestCell,
  moveFocus,
  parseCellId,
} from './closetLayout';
import { WORLD } from './config';
import { makeBody, type BodyOptions } from './testBodies';

const layout = closetLayout();
const cellById = (id: string) => {
  const cell = layout.all.find((c) => c.id === id);
  if (cell === undefined) throw new Error(`no cell ${id}`);
  return cell;
};
const center = (id: string) => {
  const c = cellById(id);
  return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
};

/** Body whose LEFT (pointer) wrist is at a world point; right arm = lever angle. */
function pointing(
  at: { x: number; y: number } | null,
  leverAngle: number,
  extra: BodyOptions = {},
): BodyOptions {
  const wrist =
    at === null
      ? undefined
      : {
          // Inverse of toCanvas: video x = 1 - cx/W, then offset from the shoulder mid.
          x: (1 - at.x / WORLD.width - 0.5) / 0.3,
          y: (at.y / WORLD.height - 0.3) / 0.3,
        };
  return {
    ...(wrist === undefined ? {} : { leftWrist: wrist }),
    leftAngle: 170,
    rightAngle: leverAngle,
    ...extra,
  };
}

/** Run a clock of 16ms ticks; returns results seen. */
class Clock {
  public t = 0;
  public results: CreatorResult[] = [];
  public constructor(public readonly creator: CharacterCreator) {}
  public run(ms: number, options: BodyOptions | null): void {
    for (let i = 0; i < ms; i += 16) {
      this.t += 16;
      const r = this.creator.update(
        this.t,
        options === null ? null : makeBody({ ...options, timestampMs: this.t }),
      );
      if (r !== null) this.results.push(r);
    }
  }
}

describe('closet layout (fixed in scene coordinates)', () => {
  it('has the three categories with every curated option, plus Done', () => {
    expect(layout.rows.map((r) => r.category)).toEqual(['skinTone', 'hairstyle', 'shirtColor']);
    expect(layout.rows[0]?.cells).toHaveLength(SKIN_TONES.length);
    expect(layout.rows[1]?.cells).toHaveLength(HAIRSTYLES.length);
    expect(layout.rows[2]?.cells).toHaveLength(SHIRT_COLORS.length);
    expect(layout.done.id).toBe('done');
  });

  it('every cell is on screen, big enough to point at, and none overlap', () => {
    for (const a of layout.all) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(WORLD.width);
      expect(a.y + a.h).toBeLessThanOrEqual(WORLD.height);
      expect(Math.min(a.w, a.h)).toBeGreaterThanOrEqual(48);
      for (const b of layout.all) {
        if (a === b) continue;
        const apart =
          a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart).toBe(true);
      }
    }
  });

  it('layout is a pure constant: identical on every call (not body-anchored)', () => {
    expect(closetLayout()).toEqual(layout);
  });

  it('hit-tests cell centres and misses the gaps', () => {
    for (const cell of layout.all) {
      const c = center(cell.id);
      expect(hitTestCell(layout, c.x, c.y)?.id).toBe(cell.id);
    }
    expect(hitTestCell(layout, 5, 5)).toBeNull();
    expect(hitTestCell(layout, 600, 300)).toBeNull();
  });

  it('parses ids and rejects forged ones', () => {
    expect(parseCellId('done')).toEqual({ kind: 'done' });
    expect(parseCellId('hairstyle:coils')).toEqual({
      kind: 'choice',
      category: 'hairstyle',
      value: 'coils',
    });
    expect(parseCellId('hairstyle:mullet')).toBeNull();
    expect(parseCellId('skinTone:#ffffff')).toBeNull();
    expect(parseCellId('nonsense')).toBeNull();
    expect(parseCellId('body:x')).toBeNull();
  });

  it('keyboard focus walks the grid and clamps at the edges', () => {
    const first = moveFocus(layout, null, 0, 0);
    expect(first).toBe(layout.all[0]?.id);
    expect(moveFocus(layout, first, -1, 0)).toBe(first);
    expect(moveFocus(layout, first, 1, 0)).toBe(layout.rows[0]?.cells[1]?.id);
    expect(moveFocus(layout, first, 0, 1)).toBe(layout.rows[1]?.cells[0]?.id);
    let id = first;
    for (let i = 0; i < 10; i += 1) id = moveFocus(layout, id, 0, 1);
    expect(id).toBe('done');
  });
});

describe('CharacterCreator state', () => {
  it('starts from the plain deep-brown starter avatar', () => {
    const c = new CharacterCreator();
    expect(c.committed).toEqual(STARTER_APPEARANCE);
    expect(STARTER_APPEARANCE.skinTone).toBe('#5e3829');
  });

  it('mouse hover previews without committing; click commits and completes the category', () => {
    const c = new CharacterCreator();
    const target = cellById('hairstyle:locs');
    const p = { x: target.x + 5, y: target.y + 5 };
    c.setMouseHover(p);
    expect(c.hoveredId).toBe('hairstyle:locs');
    expect(c.previewAppearance().hairstyle).toBe('locs');
    expect(c.committed.hairstyle).toBe(STARTER_APPEARANCE.hairstyle);
    expect(c.isComplete('hairstyle')).toBe(false);
    expect(c.tap(p, 1000)).toEqual({ kind: 'choice', category: 'hairstyle', value: 'locs' });
    expect(c.committed.hairstyle).toBe('locs');
    expect(c.isComplete('hairstyle')).toBe(true);
    expect(c.isComplete('skinTone')).toBe(false);
    c.setMouseHover(null);
    expect(c.previewAppearance()).toEqual(c.committed);
  });

  it('each category changes independently and previous state is not mutated', () => {
    const c = new CharacterCreator();
    const before = c.committed;
    c.confirm('skinTone:#f6dec5', 0);
    c.confirm('shirtColor:#e0aa56', 0);
    expect(before).toEqual(STARTER_APPEARANCE);
    expect(c.committed).toEqual({
      skinTone: '#f6dec5',
      hairstyle: STARTER_APPEARANCE.hairstyle,
      shirtColor: '#e0aa56',
    });
  });

  it('forged ids never change the avatar', () => {
    const c = new CharacterCreator();
    expect(c.confirm('hairstyle:rainbow', 0)).toBeNull();
    expect(c.confirm('skinTone:red', 0)).toBeNull();
    expect(c.committed).toEqual(STARTER_APPEARANCE);
  });

  it('Done returns a done result and leaves the appearance intact', () => {
    const c = new CharacterCreator();
    c.confirm('hairstyle:braids', 0);
    expect(c.confirm('done', 10)).toEqual({ kind: 'done' });
    expect(c.committed.hairstyle).toBe('braids');
  });

  it('keyboard: arrows move focus, Enter confirms', () => {
    const c = new CharacterCreator();
    c.moveKeyboardFocus(0, 0);
    c.moveKeyboardFocus(0, 1);
    c.moveKeyboardFocus(1, 0);
    expect(c.hoveredId).toBe('hairstyle:short');
    expect(c.confirmKeyboardFocus(0)).toEqual({
      kind: 'choice',
      category: 'hairstyle',
      value: 'short',
    });
  });

  it('entering the closet clears stale hover and lever state', () => {
    const c = new CharacterCreator();
    c.setMouseHover(center('skinTone:#f6dec5'));
    c.moveKeyboardFocus(1, 1);
    c.enter();
    expect(c.hoveredId).toBeNull();
    expect(c.leverPhase).toBe('idle');
  });
});

describe('CharacterCreator point + lever (camera path)', () => {
  const target = 'hairstyle:curls';
  const at = center(target);

  /** Hold lever horizontal, pull down through the diagonal, hold down. */
  function pull(clock: Clock, pointAt: { x: number; y: number } | null): void {
    clock.run(300, pointing(pointAt, 90)); // arm
    clock.run(100, pointing(pointAt, 130)); // pulling
    clock.run(300, pointing(pointAt, 170)); // down
  }

  it('hovering previews live; pulling the lever commits exactly that option', () => {
    const clock = new Clock(new CharacterCreator());
    clock.run(100, pointing(at, 170));
    expect(clock.creator.hoveredId).toBe(target);
    expect(clock.creator.previewAppearance().hairstyle).toBe('curls');
    expect(clock.creator.committed.hairstyle).toBe(STARTER_APPEARANCE.hairstyle);
    pull(clock, at);
    expect(clock.results).toEqual([{ kind: 'choice', category: 'hairstyle', value: 'curls' }]);
    expect(clock.creator.committed.hairstyle).toBe('curls');
    expect(clock.creator.isComplete('hairstyle')).toBe(true);
  });

  it('shows the lever phases: idle -> armed -> pulling -> latched', () => {
    const clock = new Clock(new CharacterCreator());
    clock.run(100, pointing(at, 170));
    expect(clock.creator.leverPhase).toBe('idle');
    clock.run(400, pointing(at, 90));
    expect(clock.creator.leverPhase).toBe('armed');
    clock.run(48, pointing(at, 130));
    expect(clock.creator.leverPhase).toBe('pulling');
    clock.run(300, pointing(at, 170));
    expect(clock.creator.leverPhase).toBe('latched');
  });

  it('hover changing mid-pull does not change the captured option', () => {
    const clock = new Clock(new CharacterCreator());
    const other = center('hairstyle:buzz');
    clock.run(300, pointing(at, 90));
    clock.run(48, pointing(at, 130)); // pull starts while hovering "curls"
    clock.run(100, pointing(other, 140)); // cursor drifts over "buzz"
    clock.run(300, pointing(other, 170));
    expect(clock.results).toEqual([{ kind: 'choice', category: 'hairstyle', value: 'curls' }]);
  });

  it('pulling with nothing hovered confirms nothing', () => {
    const clock = new Clock(new CharacterCreator());
    pull(clock, { x: 600, y: 300 });
    expect(clock.results).toEqual([]);
  });

  it('requires a re-arm: holding the lever down does not confirm a second time', () => {
    const clock = new Clock(new CharacterCreator());
    pull(clock, at);
    clock.run(2000, pointing(at, 170));
    expect(clock.results).toHaveLength(1);
    // A fresh raise + pull confirms a second time.
    pull(clock, center('hairstyle:buzz'));
    expect(clock.results).toHaveLength(2);
  });

  it('losing tracking mid-pull resets and confirms nothing', () => {
    const clock = new Clock(new CharacterCreator());
    clock.run(300, pointing(at, 90));
    clock.run(48, pointing(at, 130));
    clock.run(200, null);
    clock.run(300, pointing(at, 170));
    expect(clock.results).toEqual([]);
    expect(clock.creator.cursor).not.toBeNull();
    clock.run(32, null);
    expect(clock.creator.cursor).toBeNull();
    expect(clock.creator.hoveredId).toBeNull();
  });

  it('a jump straight to "down" without an intermediate pose is rejected', () => {
    const clock = new Clock(new CharacterCreator());
    clock.run(300, pointing(at, 90));
    clock.run(300, pointing(at, 170));
    expect(clock.results).toEqual([]);
  });

  it('wrong arm: the pointing arm raised sideways is not the lever', () => {
    const clock = new Clock(new CharacterCreator());
    // Pointer (left) arm goes through a lever motion; lever (right) arm stays down.
    clock.run(300, pointing(at, 170, { leftAngle: 90 }));
    clock.run(100, pointing(at, 170, { leftAngle: 130 }));
    clock.run(300, pointing(at, 170, { leftAngle: 170 }));
    expect(clock.results).toEqual([]);
  });

  it('wrist/handedness flip mid-pull (lever arm sign flips) does not confirm', () => {
    const clock = new Clock(new CharacterCreator());
    clock.run(300, pointing(at, 90));
    clock.run(48, pointing(at, 130));
    clock.run(100, pointing(at, -130)); // identity flip
    clock.run(300, pointing(at, -170));
    expect(clock.results).toEqual([]);
  });

  it('stale timestamps (time going backwards) are ignored', () => {
    const creator = new CharacterCreator();
    const body = (t: number, angle: number) =>
      makeBody({ ...pointing(at, angle), timestampMs: t });
    let results = 0;
    for (const [t, angle] of [
      [1000, 90], [1200, 90], [1300, 90], [1100, 170], [1000, 170], [900, 170],
    ] as const) {
      if (creator.update(t, body(t, angle)) !== null) results += 1;
    }
    expect(results).toBe(0);
  });

  it('swapping hand roles makes the right hand the pointer and the left arm the lever', () => {
    const creator = new CharacterCreator();
    creator.swapHands();
    expect(creator.pointerHand).toBe('right');
    const rightWrist = {
      x: (1 - at.x / WORLD.width - 0.5) / 0.3,
      y: (at.y / WORLD.height - 0.3) / 0.3,
    };
    const results: CreatorResult[] = [];
    let t = 0;
    const run = (ms: number, leverAngle: number): void => {
      for (let i = 0; i < ms; i += 16) {
        t += 16;
        const r = creator.update(
          t,
          makeBody({ rightWrist, rightAngle: -170, leftAngle: leverAngle, timestampMs: t }),
        );
        if (r !== null) results.push(r);
      }
    };
    run(300, 90);
    run(100, 130);
    run(300, 170);
    expect(results).toEqual([{ kind: 'choice', category: 'hairstyle', value: 'curls' }]);
  });

  it('the pose cursor is mirrored exactly once into world coordinates', () => {
    const creator = new CharacterCreator();
    creator.update(16, makeBody({ leftWrist: { x: -1.0, y: 0.0 }, timestampMs: 16 }));
    // Video x = 0.5 - 0.3 = 0.2 -> canvas x = (1 - 0.2) * 960 = 768.
    expect(creator.cursor?.x).toBeCloseTo(768, 3);
    expect(creator.cursor?.y).toBeCloseTo(0.3 * WORLD.height, 3);
  });
});
