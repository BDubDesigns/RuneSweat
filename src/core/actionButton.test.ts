import { describe, expect, it } from 'vitest';
import { ACTION_BUTTON, POINTER } from './config';
import {
  ActionButtonDwell,
  actionButtonGeometry,
  actionButtonLabel,
  pointInActionCircle,
} from './actionButton';
import {
  hopperZoneForStage,
  pedestalRectsForStage,
  pickerCardLayout,
  pileZoneForStage,
  rectsIntersect,
  simTorsoBox,
} from '../games/refiner/refiner';
import { gateBannerRect, GATE_BANNER } from '../render/renderer';

/** Circle bounds as a rect, for the overlap checks. */
function circleRect(geometry: {
  cx: number;
  cy: number;
  r: number;
}): { x: number; y: number; w: number; h: number } {
  return {
    x: geometry.cx - geometry.r,
    y: geometry.cy - geometry.r,
    w: geometry.r * 2,
    h: geometry.r * 2,
  };
}

describe('actionButtonGeometry (v3.6)', () => {
  it('sits top-right at 960x540: centre (888, 84), radius 36', () => {
    const geometry = actionButtonGeometry(960, 540);
    expect(geometry).toEqual({ cx: 888, cy: 84, r: 36 });
    expect(geometry.r).toBe(ACTION_BUTTON.radiusPx);
  });

  it('never overlaps the press pads, pile, hopper, resting torso, picker cards, or gate banner', () => {
    const W = 960;
    const H = 540;
    const circle = circleRect(actionButtonGeometry(W, H));
    // Press pads: live geometry, so this follows Worker A's v3.6
    // zones (top hip − 0.06, 0.32 tall) as well as v3.5's — the
    // test reads the zones, never hard-codes them.
    const pedestals = pedestalRectsForStage(W, H, 0.5, 0.55, 0.3);
    for (const side of [pedestals.left, pedestals.right]) {
      expect(rectsIntersect(circle, side.button)).toBe(false);
      expect(rectsIntersect(circle, side.post)).toBe(false);
    }
    expect(rectsIntersect(circle, pileZoneForStage(W, H))).toBe(false);
    expect(rectsIntersect(circle, hopperZoneForStage(W, H))).toBe(false);
    expect(rectsIntersect(circle, simTorsoBox(W, H))).toBe(false);
    for (const card of pickerCardLayout(W, H).cards) {
      expect(rectsIntersect(circle, card)).toBe(false);
    }
    // Gate banner (bottom y 40): the circle top (48) clears it, so
    // the banner can never cover the circle while the body is lost.
    const banner = gateBannerRect(W, 30 * 11);
    expect(banner.y + banner.h).toBe(GATE_BANNER.top + GATE_BANNER.height);
    expect(circle.y).toBeGreaterThanOrEqual(banner.y + banner.h);
  });

  it('pointInActionCircle: centre + edge inside, outside outside', () => {
    const geometry = actionButtonGeometry(960, 540);
    expect(pointInActionCircle(888, 84, geometry)).toBe(true);
    expect(pointInActionCircle(888 + 36, 84, geometry)).toBe(true);
    expect(pointInActionCircle(888 + 37, 84, geometry)).toBe(false);
    expect(pointInActionCircle(480, 300, geometry)).toBe(false);
  });

  it('labels change with the mode: Town vs OK', () => {
    expect(actionButtonLabel('town')).toBe('Town');
    expect(actionButtonLabel('ok')).toBe('OK');
  });
});

describe('ActionButtonDwell (v3.6)', () => {
  it('fills over 2 s and fires only on a full hold', () => {
    const dwell = new ActionButtonDwell(2000);
    expect(dwell.update(true, 0)).toBe(false);
    expect(dwell.progress(1000)).toBeCloseTo(0.5, 2);
    expect(dwell.update(true, 1000)).toBe(false);
    expect(dwell.update(true, 1999)).toBe(false);
    expect(dwell.progress(1999)).toBeCloseTo(1, 2);
    expect(dwell.update(true, 2000)).toBe(true);
    expect(dwell.progress(2000)).toBe(0);
  });

  it('leaving early resets to zero: no partial credit', () => {
    const dwell = new ActionButtonDwell(2000);
    expect(dwell.update(true, 0)).toBe(false);
    expect(dwell.progress(1500)).toBeCloseTo(0.75, 2);
    expect(dwell.update(false, 1500)).toBe(false);
    expect(dwell.progress(1500)).toBe(0);
    // Re-entering starts from zero, not from 1500 ms.
    expect(dwell.update(true, 1600)).toBe(false);
    expect(dwell.progress(2600)).toBeCloseTo(0.5, 2);
    expect(dwell.update(true, 3600)).toBe(true);
  });

  it('a partial dwell never fires', () => {
    const dwell = new ActionButtonDwell(2000);
    for (let t = 0; t < 2000; t += 16) {
      expect(dwell.update(true, t)).toBe(false);
    }
    expect(dwell.update(false, 2000)).toBe(false);
  });

  it('holding through a fire does not fire twice: re-arm needs leaving', () => {
    const dwell = new ActionButtonDwell(2000);
    expect(dwell.update(true, 0)).toBe(false);
    expect(dwell.update(true, 2000)).toBe(true);
    // Still inside, still holding: no second fire, no fill.
    expect(dwell.update(true, 4000)).toBe(false);
    expect(dwell.progress(4000)).toBe(0);
    // Leave and re-enter: a fresh hold fires again.
    expect(dwell.update(false, 4100)).toBe(false);
    expect(dwell.update(true, 4200)).toBe(false);
    expect(dwell.update(true, 6200)).toBe(true);
  });

  it('reset() forgets an in-progress hold', () => {
    const dwell = new ActionButtonDwell(2000);
    expect(dwell.update(true, 0)).toBe(false);
    dwell.reset();
    expect(dwell.progress(1000)).toBe(0);
    expect(dwell.update(true, 1000)).toBe(false);
    expect(dwell.update(true, 3000)).toBe(true);
  });

  it('the dwell time comes from config: 2 s', () => {
    expect(ACTION_BUTTON.dwellMs).toBe(2000);
    const dwell = new ActionButtonDwell();
    expect(dwell.update(true, 0)).toBe(false);
    expect(dwell.update(true, 2000)).toBe(true);
  });
});

describe('POINTER hand split is config-driven (v3.6)', () => {
  it('left hand points, right hand confirms', () => {
    expect(POINTER.pointerHand).toBe('left');
    expect(POINTER.confirmHand).toBe('right');
    expect(POINTER.pointerHand).not.toBe(POINTER.confirmHand);
  });
});
