import { describe, expect, it } from 'vitest';
import { clamp, syncCanvasBackingStore, toCanvas, toNormalized } from './stage';

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

describe('clamp', () => {
  it('clamps both ends and passes values through', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(4, 0, 10)).toBe(4);
  });
});
