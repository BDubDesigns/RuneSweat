import { describe, expect, it } from 'vitest';
import {
  clamp,
  letterboxRect,
  syncCanvasBackingStore,
  toCanvas,
  toNormalized,
} from './stage';

describe('toCanvas', () => {
  it('mirrors x exactly once and leaves y alone', () => {
    const p = toCanvas({ x: 0.25, y: 0.4 }, 640, 480);
    expect(p.x).toBeCloseTo(480, 9);
    expect(p.y).toBeCloseTo(192, 9);
  });

  it('maps the video corners to the opposite canvas corners', () => {
    expect(toCanvas({ x: 0, y: 0 }, 640, 480)).toEqual({ x: 640, y: 0 });
    expect(toCanvas({ x: 1, y: 1 }, 640, 480)).toEqual({ x: 0, y: 480 });
  });
});

describe('toNormalized', () => {
  it('round-trips through toCanvas', () => {
    const original = { x: 0.33, y: 0.71 };
    const canvas = toCanvas(original, 640, 480);
    const back = toNormalized(canvas, 640, 480);
    expect(back.x).toBeCloseTo(original.x, 9);
    expect(back.y).toBeCloseTo(original.y, 9);
  });
});

describe('syncCanvasBackingStore', () => {
  it('resizes when dimensions differ and reports true', () => {
    const canvas = { width: 640, height: 480 };
    expect(syncCanvasBackingStore(canvas, 1280, 720)).toBe(true);
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(720);
  });

  it('reports false when already the right size', () => {
    const canvas = { width: 640, height: 480 };
    expect(syncCanvasBackingStore(canvas, 640, 480)).toBe(false);
  });

  it('rejects non-positive dimensions', () => {
    expect(() => syncCanvasBackingStore({ width: 1, height: 1 }, 0, 480)).toThrow(
      RangeError,
    );
  });
});

describe('letterboxRect', () => {
  it('landscape video into the landscape stage is full-bleed', () => {
    expect(letterboxRect(1280, 720, 960, 540)).toEqual({
      x: 0,
      y: 0,
      width: 960,
      height: 540,
    });
    expect(letterboxRect(640, 480, 960, 540)).toEqual({
      x: 120,
      y: 0,
      width: 720,
      height: 540,
    });
  });

  it('portrait phone video into the landscape stage is a centred pillarbox', () => {
    // 720x1280 portrait capture into 960x540: height fills, width shrinks.
    const rect = letterboxRect(720, 1280, 960, 540);
    expect(rect.height).toBeCloseTo(540, 9);
    expect(rect.width).toBeCloseTo(540 * (720 / 1280), 9);
    expect(rect.x).toBeCloseTo((960 - rect.width) / 2, 9);
    expect(rect.y).toBe(0);
  });

  it('square video is centred with equal bars', () => {
    const rect = letterboxRect(480, 480, 960, 540);
    expect(rect).toEqual({ x: 210, y: 0, width: 540, height: 540 });
  });

  it('a taller-than-stage video letterboxes top and bottom', () => {
    const rect = letterboxRect(960, 1080, 960, 540);
    expect(rect.width).toBeCloseTo(480, 9);
    expect(rect.height).toBeCloseTo(540, 9);
    expect(rect.x).toBeCloseTo(240, 9);
    expect(rect.y).toBe(0);
  });

  it('a wider-than-stage video is full-width with bars top and bottom', () => {
    const rect = letterboxRect(1920, 720, 960, 540);
    expect(rect.width).toBeCloseTo(960, 9);
    expect(rect.height).toBeCloseTo(360, 9);
    expect(rect.x).toBe(0);
    expect(rect.y).toBeCloseTo(90, 9);
  });

  it('never stretches: the rect keeps the source aspect', () => {
    for (const [sw, sh] of [
      [720, 1280],
      [640, 480],
      [1920, 1080],
      [480, 480],
    ] as const) {
      const rect = letterboxRect(sw, sh, 960, 540);
      expect(rect.width / rect.height).toBeCloseTo(sw / sh, 9);
    }
  });

  it('degenerate source dims fall back to the full destination', () => {
    expect(letterboxRect(0, 720, 960, 540)).toEqual({
      x: 0,
      y: 0,
      width: 960,
      height: 540,
    });
  });
});

describe('clamp', () => {
  it('clamps both ends and passes values through', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(4, 0, 10)).toBe(4);
  });
});
