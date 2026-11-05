import { describe, expect, it } from 'vitest';
import { POINTER } from './config';
import {
  PointerController,
  confirmHandPoint,
  handPoint,
  pointInSelectable,
  pointerHandPoint,
  type Selectable,
} from './pointer';
import type { BodyState } from './bodyState';

const SELECTABLES: readonly Selectable[] = [
  { id: 'mine', x: 492, y: 156, w: 444, h: 52 },
  { id: 'refiner', x: 492, y: 218, w: 444, h: 52 },
  { id: 'recipe:refined-ferrite', x: 160, y: 140, w: 640, h: 96 },
];

/** Minimal BodyState: only the wrist fields the helpers read. */
function makeBody(left: { x: number; y: number }, right: { x: number; y: number }): BodyState {
  return {
    leftWristX: left.x,
    leftWristY: left.y,
    rightWristX: right.x,
    rightWristY: right.y,
  } as unknown as BodyState;
}

describe('pointInSelectable', () => {
  it('inside + edge counts, outside does not', () => {
    const s = SELECTABLES[0] as Selectable;
    expect(pointInSelectable(500, 160, s)).toBe(true);
    expect(pointInSelectable(492, 156, s)).toBe(true);
    expect(pointInSelectable(936, 208, s)).toBe(true);
    expect(pointInSelectable(491, 160, s)).toBe(false);
    expect(pointInSelectable(500, 209, s)).toBe(false);
  });
});

describe('hand split is config-driven', () => {
  it('the pointer hand is the config pointer hand, the confirm hand the config confirm hand', () => {
    const body = makeBody({ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.1 });
    expect(pointerHandPoint(body)).toEqual({ x: 0.2, y: 0.3 });
    expect(confirmHandPoint(body)).toEqual({ x: 0.8, y: 0.1 });
    // The helpers read POINTER, not a hardcoded side: swapping the
    // assignment would swap the points, and the logic follows.
    expect(POINTER.pointerHand).toBe('left');
    expect(POINTER.confirmHand).toBe('right');
    expect(handPoint(body, 'left')).toEqual({ x: 0.2, y: 0.3 });
    expect(handPoint(body, 'right')).toEqual({ x: 0.8, y: 0.1 });
  });
});

describe('PointerController (v3.6)', () => {
  it('hover highlights the thing under the pointer', () => {
    const pointer = new PointerController();
    expect(pointer.update({ x: 500, y: 180 }, SELECTABLES)).toBe(true);
    expect(pointer.hoveredId).toBe('mine');
    expect(pointer.hoveredSelectable?.id).toBe('mine');
    // Same thing again: no change.
    expect(pointer.update({ x: 510, y: 180 }, SELECTABLES)).toBe(false);
    expect(pointer.hoveredId).toBe('mine');
  });

  it('moving to another thing switches the highlight', () => {
    const pointer = new PointerController();
    pointer.update({ x: 500, y: 180 }, SELECTABLES);
    expect(pointer.update({ x: 500, y: 240 }, SELECTABLES)).toBe(true);
    expect(pointer.hoveredId).toBe('refiner');
  });

  it('leaving before the confirm clears the highlight', () => {
    const pointer = new PointerController();
    pointer.update({ x: 500, y: 180 }, SELECTABLES);
    expect(pointer.hoveredId).toBe('mine');
    expect(pointer.update({ x: 100, y: 500 }, SELECTABLES)).toBe(true);
    expect(pointer.hoveredId).toBeNull();
    expect(pointer.hoveredSelectable).toBeNull();
  });

  it('no body (null point) clears the highlight', () => {
    const pointer = new PointerController();
    pointer.update({ x: 500, y: 180 }, SELECTABLES);
    expect(pointer.update(null, SELECTABLES)).toBe(true);
    expect(pointer.hoveredId).toBeNull();
  });

  it('clear() drops the hover', () => {
    const pointer = new PointerController();
    pointer.update({ x: 500, y: 180 }, SELECTABLES);
    pointer.clear();
    expect(pointer.hoveredId).toBeNull();
  });

  it('a hover over nothing is not a hover: dwelling with nothing highlighted does nothing', () => {
    const pointer = new PointerController();
    expect(pointer.update({ x: 100, y: 500 }, SELECTABLES)).toBe(false);
    expect(pointer.hoveredId).toBeNull();
  });

  it('the first selectable containing the point wins', () => {
    const pointer = new PointerController();
    const overlapping: readonly Selectable[] = [
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 50, y: 50, w: 100, h: 100 },
    ];
    pointer.update({ x: 75, y: 75 }, overlapping);
    expect(pointer.hoveredId).toBe('a');
  });
});
