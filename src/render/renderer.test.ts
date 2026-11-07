import { describe, expect, it } from 'vitest';
import { RENDER } from '../core/config';
import {
  GATE_BANNER,
  drawActionButton,
  drawBlockingOverlay,
  drawGateBanner,
  drawHoverRing,
  drawPointerCursor,
  gateBannerRect,
} from './renderer';

/** Minimal recording stub: records fills, text and arcs. */
function recordingContext(width = 960, height = 540): {
  ctx: CanvasRenderingContext2D;
  fills: { x: number; y: number; w: number; h: number; style: string }[];
  texts: { text: string; x: number; y: number }[];
  arcs: { x: number; y: number; r: number }[];
} {
  const fills: {
    x: number;
    y: number;
    w: number;
    h: number;
    style: string;
  }[] = [];
  const texts: { text: string; x: number; y: number }[] = [];
  const arcs: { x: number; y: number; r: number }[] = [];
  let fillStyle = '';
  const target: Record<string, unknown> = {};
  const stub = new Proxy(target, {
    get: (_t, prop) => {
      if (prop === 'canvas') return { width, height };
      if (prop === 'fillRect') {
        return (x: number, y: number, w: number, h: number) => {
          fills.push({ x, y, w, h, style: fillStyle });
        };
      }
      if (prop === 'fillText' || prop === 'strokeText') {
        return (text: string, x: number, y: number) => {
          texts.push({ text, x, y });
        };
      }
      if (prop === 'arc') {
        return (x: number, y: number, r: number) => {
          arcs.push({ x, y, r });
        };
      }
      if (prop === 'measureText') {
        return (text: string) => ({ width: text.length * 11 });
      }
      return () => undefined;
    },
    set: (t, prop, value) => {
      if (prop === 'fillStyle') fillStyle = String(value);
      t[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx: stub, fills, texts, arcs };
}

/**
 * Stub that records the font in effect at measure time and the order
 * of font-set vs measure calls — the v3.3 regression: drawGateBanner
 * measured the text before setting its 20px bold font, so the pill
 * was sized for the leftover font and the text overflowed it.
 */
function fontRecordingContext(): {
  ctx: CanvasRenderingContext2D;
  /** e.g. 'font:700 20px ...' / 'measure:<text>' in call order. */
  events: string[];
  fills: { x: number; y: number; w: number; h: number }[];
  measured: { text: string; fontAtMeasure: string; width: number }[];
  drawnFont: string;
} {
  const events: string[] = [];
  const fills: { x: number; y: number; w: number; h: number }[] = [];
  const measured: { text: string; fontAtMeasure: string; width: number }[] =
    [];
  // Whatever the previous draw left behind: a small default font.
  let font = '10px sans-serif';
  const drawnFont = `700 ${GATE_BANNER.fontPx}px ${RENDER.gameFont}`;
  const stub = {
    get font(): string {
      return font;
    },
    set font(value: string) {
      font = value;
      events.push(`font:${value}`);
    },
    save(): void {},
    restore(): void {},
    fillRect(x: number, y: number, w: number, h: number): void {
      fills.push({ x, y, w, h });
    },
    strokeRect(): void {},
    fillText(): void {},
    measureText(text: string): { width: number } {
      events.push(`measure:${text}`);
      // Width scales with the font size in effect, like a real
      // canvas: measuring at the 10px leftover font returns about
      // half the width of the 20px drawn font.
      const px = Number(/(\d+)px/.exec(font)?.[1] ?? 10);
      const widthPx = text.length * px * 0.55;
      measured.push({ text, fontAtMeasure: font, width: widthPx });
      return { width: widthPx };
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx: stub, events, fills, measured, drawnFont };
}

describe('drawGateBanner measures at the drawn font (v3.3)', () => {
  it('a long message never clips: the pill is sized at the 20px bold font', () => {
    const message =
      "I can't see your shoulders — step back so I can see your whole body";
    const rec = fontRecordingContext();
    drawGateBanner(rec.ctx, 960, 540, message);
    // The font was set before measureText ran.
    const fontIdx = rec.events.findIndex(
      (e) => e === `font:${rec.drawnFont}`,
    );
    const measureIdx = rec.events.findIndex((e) =>
      e.startsWith('measure:'),
    );
    expect(fontIdx).toBeGreaterThanOrEqual(0);
    expect(measureIdx).toBeGreaterThan(fontIdx);
    // The width the pill was sized from was measured at the drawn font.
    expect(rec.measured).toHaveLength(1);
    expect(rec.measured[0]?.fontAtMeasure).toBe(rec.drawnFont);
    const textWidth = rec.measured[0]?.width ?? 0;
    // Pill fits the text at the drawn font, plus padding each side.
    expect(rec.fills).toHaveLength(1);
    expect(rec.fills[0]?.w).toBe(textWidth + GATE_BANNER.paddingX * 2);
    expect(rec.fills[0]?.w).toBeGreaterThanOrEqual(textWidth);
  });

  it('the real gate message fits, and gateBannerRect caps/minimums still hold', () => {
    const rec = fontRecordingContext();
    drawGateBanner(rec.ctx, 960, 540, "I can't see your shoulders — step back");
    const textWidth = rec.measured[0]?.width ?? 0;
    expect(rec.fills[0]?.w).toBe(textWidth + GATE_BANNER.paddingX * 2);
    // A long message caps at the stage width (12 px margin each side).
    expect(gateBannerRect(960, 2000).w).toBe(960 - 24);
    expect(gateBannerRect(960, 2000).x).toBe(12);
    // A short message keeps the minimum width.
    expect(gateBannerRect(960, 50).w).toBe(GATE_BANNER.minWidth);
  });
});

describe('drawGateBanner (v3.2)', () => {
  it('draws a small top pill, never a full-stage dim or a ghost', () => {
    const rec = recordingContext();
    drawGateBanner(rec.ctx, 960, 540, "Step back — I can't see your body");
    // No rect covers the stage: the biggest fill is the pill.
    for (const f of rec.fills) {
      expect(f.w).toBeLessThan(960);
      expect(f.h).toBe(GATE_BANNER.height);
    }
    expect(rec.fills).toHaveLength(1);
    // The pill fill is solid (opaque), never a translucent dim.
    expect(rec.fills[0]?.style).toMatch(/^#[0-9a-f]{6}$/);
    // No ghost outline: the banner draws no arcs at all.
    expect(rec.arcs).toHaveLength(0);
    // The message draws once, inside the pill.
    expect(rec.texts).toHaveLength(1);
    expect(rec.texts[0]?.text).toBe("Step back — I can't see your body");
    expect(rec.texts[0]?.y).toBeGreaterThanOrEqual(GATE_BANNER.top);
    expect(rec.texts[0]?.y).toBeLessThanOrEqual(
      GATE_BANNER.top + GATE_BANNER.height,
    );
  });

  it('gateBannerRect stays inside the stage and clears the game title zone', () => {
    // A long message caps at the stage width, never off-stage.
    const long = gateBannerRect(960, 2000);
    expect(long.x).toBe(12);
    expect(long.x + long.w).toBe(948);
    expect(long.h).toBe(GATE_BANNER.height);
    // Bottom edge (40) sits above the game title / phase banner
    // (drawn at y 58, glyph tops ~y 41).
    const short = gateBannerRect(960, 200);
    expect(short.y + short.h).toBeLessThanOrEqual(41);
    expect(short.w).toBeGreaterThanOrEqual(GATE_BANNER.minWidth);
  });

  it('drawBlockingOverlay still dims the whole stage (for model failures)', () => {
    const rec = recordingContext();
    drawBlockingOverlay(rec.ctx, 960, 540, {
      title: 'Pose model failed to load',
      subtitle: '',
      showGhost: false,
    });
    // The full-stage dim is still there for the cases that need it.
    expect(
      rec.fills.some((f) => f.w === 960 && f.h === 540),
    ).toBe(true);
  });
});

describe('drawActionButton + drawPointerCursor (v3.6)', () => {
  /** Records arcs with the stroke/fill style in force + texts + rects. */
  function actionRecordingContext(): {
    ctx: CanvasRenderingContext2D;
    arcs: {
      x: number;
      y: number;
      r: number;
      start: number;
      end: number;
      strokeStyle: string;
    }[];
    texts: { text: string; x: number; y: number }[];
    rects: { x: number; y: number; w: number; h: number }[];
  } {
    const arcs: {
      x: number;
      y: number;
      r: number;
      start: number;
      end: number;
      strokeStyle: string;
    }[] = [];
    const texts: { text: string; x: number; y: number }[] = [];
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    let strokeStyle = '';
    let fillStyle = '';
    const target: Record<string, unknown> = {};
    const stub = new Proxy(target, {
      get: (_t, prop) => {
        if (prop === 'canvas') return { width: 960, height: 540 };
        if (prop === 'arc') {
          return (
            x: number,
            y: number,
            r: number,
            start: number,
            end: number,
          ) => {
            arcs.push({ x, y, r, start, end, strokeStyle });
          };
        }
        if (prop === 'fillText') {
          return (text: string, x: number, y: number) => {
            texts.push({ text, x, y });
          };
        }
        if (prop === 'fillRect') {
          return (x: number, y: number, w: number, h: number) => {
            rects.push({ x, y, w, h });
          };
        }
        if (prop === 'strokeRect') {
          return (x: number, y: number, w: number, h: number) => {
            rects.push({ x, y, w, h });
          };
        }
        if (prop === 'measureText') {
          return (text: string) => ({ width: text.length * 11 });
        }
        return () => undefined;
      },
      set: (t, prop, value) => {
        if (prop === 'strokeStyle') strokeStyle = String(value);
        if (prop === 'fillStyle') fillStyle = String(value);
        void fillStyle;
        t[prop as string] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx: stub, arcs, texts, rects };
  }

  it('town mode: circle top-right, houses icon, "Town" label', () => {
    const rec = actionRecordingContext();
    drawActionButton(rec.ctx, 960, 540, 'town', 0);
    // Body circle at (888, 84), r 36.
    expect(
      rec.arcs.some((a) => a.x === 888 && a.y === 84 && a.r === 36),
    ).toBe(true);
    // Dwell track ring just outside the body (r 42), full circle.
    const track = rec.arcs.find((a) => a.r === 42);
    expect(track).toBeDefined();
    expect(track?.start).toBe(0);
    expect(track?.end).toBeCloseTo(Math.PI * 2, 5);
    // No fill arc at progress 0 (only the track + border + body).
    expect(
      rec.arcs.filter((a) => a.r === 42 && a.end < Math.PI * 2),
    ).toHaveLength(0);
    // Houses icon: two 20x14 bodies.
    expect(
      rec.rects.filter((r) => r.w === 20 && r.h === 14),
    ).toHaveLength(2);
    // Label under the circle, centred.
    const label = rec.texts.find((t) => t.text === 'Town');
    expect(label).toBeDefined();
    expect(label?.x).toBe(888);
    expect(label?.y).toBe(84 + 36 + 18);
  });

  it('ok mode: checkmark icon, "OK" label, brighter border', () => {
    const rec = actionRecordingContext();
    drawActionButton(rec.ctx, 960, 540, 'ok', 0);
    // No house bodies in ok mode.
    expect(
      rec.rects.filter((r) => r.w === 20 && r.h === 14),
    ).toHaveLength(0);
    const label = rec.texts.find((t) => t.text === 'OK');
    expect(label).toBeDefined();
    expect(label?.x).toBe(888);
    // The border arc is the brighter gold in ok mode.
    const border = rec.arcs.find(
      (a) => a.r === 36 && a.strokeStyle === '#ffe08a',
    );
    expect(border).toBeDefined();
  });

  it('dwell fill: the progress arc sweeps from the top as the hold grows', () => {
    const rec = actionRecordingContext();
    drawActionButton(rec.ctx, 960, 540, 'town', 0.5);
    const fill = rec.arcs.find(
      (a) => a.r === 42 && a.start === -Math.PI / 2 && a.end > 0,
    );
    expect(fill).toBeDefined();
    // Half a hold = half the circle, starting at the top.
    expect(fill?.end).toBeCloseTo(-Math.PI / 2 + Math.PI, 5);
    const recFull = actionRecordingContext();
    drawActionButton(recFull.ctx, 960, 540, 'town', 1);
    const full = recFull.arcs.find(
      (a) => a.r === 42 && a.start === -Math.PI / 2 && a.end > Math.PI,
    );
    expect(full?.end).toBeCloseTo(-Math.PI / 2 + Math.PI * 2, 5);
  });

  it('drawPointerCursor: gold ring + dot at the pointer, bigger + brighter while hovering', () => {
    const rec = actionRecordingContext();
    // Sim torso (0.3 video x 540 px = 162 px) -> hand circle r 20.25.
    drawPointerCursor(rec.ctx, 500, 200, 20, false);
    expect(
      rec.arcs.some((a) => a.x === 500 && a.y === 200 && a.r === 26),
    ).toBe(true);
    expect(
      rec.arcs.some((a) => a.x === 500 && a.y === 200 && a.r === 4),
    ).toBe(true);
    const recHover = actionRecordingContext();
    drawPointerCursor(recHover.ctx, 500, 200, 20, true);
    expect(
      recHover.arcs.some(
        (a) =>
          a.x === 500 &&
          a.y === 200 &&
          a.r === 30 &&
          a.strokeStyle === '#ffe08a',
      ),
    ).toBe(true);
    // The ring follows the hand-circle radius: a closer body (bigger
    // hand circle) gets a bigger ring, never a ring buried inside it.
    const recBig = actionRecordingContext();
    drawPointerCursor(recBig.ctx, 500, 200, 40, false);
    expect(
      recBig.arcs.some((a) => a.x === 500 && a.y === 200 && a.r === 46),
    ).toBe(true);
  });

  it('drawPointerCursor: showDot=false draws the ring without the centre dot (v3.7 menu cursor)', () => {
    const rec = actionRecordingContext();
    // Ring only: the L circle carries its 'L' label at the centre on
    // the menu, and the dot would sit on top of the letter.
    drawPointerCursor(rec.ctx, 500, 200, 20, false, false);
    expect(
      rec.arcs.some((a) => a.x === 500 && a.y === 200 && a.r === 26),
    ).toBe(true);
    expect(
      rec.arcs.some((a) => a.x === 500 && a.y === 200 && a.r === 4),
    ).toBe(false);
    // Default (and explicit true) still draws the dot — activities
    // keep exactly the v3.6 cursor.
    const recDot = actionRecordingContext();
    drawPointerCursor(recDot.ctx, 500, 200, 20, false);
    expect(
      recDot.arcs.some((a) => a.x === 500 && a.y === 200 && a.r === 4),
    ).toBe(true);
  });

  it('drawHoverRing: bright gold stroke just outside the rect', () => {
    const rec = actionRecordingContext();
    drawHoverRing(rec.ctx, { x: 160, y: 140, w: 640, h: 96 });
    const ring = rec.rects.find(
      (r) => r.x === 157 && r.y === 137 && r.w === 646 && r.h === 102,
    );
    expect(ring).toBeDefined();
  });
});
