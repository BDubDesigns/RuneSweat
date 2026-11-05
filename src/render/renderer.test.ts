import { describe, expect, it } from 'vitest';
// @ts-expect-error — @types/node is not installed in this repo, so
// node:fs has no type declarations; the import works at runtime
// because vitest runs in node. Only used to read the real CSS/HTML.
import { readFileSync as readFileSyncUntyped } from 'node:fs';
/**
 * Typed alias for the import above: the unresolved import is
 * `error`-typed, so calling it directly trips the no-unsafe-* lint
 * rules. The cast pins the one signature this test uses.
 */
const readFileSync: (path: string, encoding: 'utf8') => string =
  readFileSyncUntyped as (path: string, encoding: 'utf8') => string;
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

/**
 * Page fit at the Nov 4 playtest size (v3.2): the page (stage + HUD +
 * buttons + status) must fit the viewport with no scroll and no
 * clipping. Node cannot lay out a real browser, so this test does the
 * arithmetic from the actual CSS + DOM: it reads the stage reserves
 * out of `styles.css` and the button labels out of `index.html`, and
 * asserts stage height + measured chrome <= viewport height for the
 * viewports that matter. What it cannot prove — the real window on
 * Brandon's laptop, real font metrics, real camera feel — is stated
 * in the report, not here.
 */
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

  it('drawHoverRing: bright gold stroke just outside the rect', () => {
    const rec = actionRecordingContext();
    drawHoverRing(rec.ctx, { x: 160, y: 140, w: 640, h: 96 });
    const ring = rec.rects.find(
      (r) => r.x === 157 && r.y === 137 && r.w === 646 && r.h === 102,
    );
    expect(ring).toBeDefined();
  });
});

describe('page fit at 1728x1080 (v3.2)', () => {
  // Read from the repo root (vitest runs with cwd = the package
  // root), so the numbers below always come from the real files.
  const css = readFileSync('src/styles.css', 'utf8');
  const html = readFileSync('index.html', 'utf8');

  /** Stage reserves (px) from the stage-wrap width formulas. */
  function stageReserves(): { normal: number; fullscreen: number } {
    const matches = [...css.matchAll(/100dvh - (\d+)px/g)].map((m) =>
      Number(m[1]),
    );
    expect(matches).toHaveLength(2);
    return { normal: matches[0] ?? 0, fullscreen: matches[1] ?? 0 };
  }

  /** Chrome heights (px), measured from styles.css + the HUD spans. */
  function chromeFor(vh: number, controlsRows: number): number {
    // #app padding 16 top + 16 bottom.
    const padding = 32;
    // Header: h1 2.6rem (~50px line) + tagline (~21px) + 4px margin
    // = ~75; under 1000px viewport height the tagline hides and the
    // h1 shrinks to 1.8rem (~35px line) = ~50... the media query
    // keeps the h1 at 1.8rem, so 35px + no tagline = 35.
    const header = vh < 1000 ? 35 : 75;
    // #app gaps during play: header -> stage-section, stage-section
    // -> legend (2 x 12). The stage-section's own children stack
    // flush (no gap, no margins).
    const gaps = 24;
    // HUD: 1.15rem font, ~22px/line, 3 lines worst case (stats +
    // phase + instruction wrap).
    const hud = 3 * 22;
    // Controls: one row ~44px (10px padding x2 + ~22px line).
    const controls = controlsRows * 44 + (controlsRows - 1) * 8;
    // Body-status line (#out-of-frame): 1.1rem, one line.
    const status = 24;
    // Legend: 0.9rem (0.85rem under 1000px), 2 lines.
    const legend = vh < 1000 ? 34 : 40;
    return padding + header + gaps + hud + controls + status + legend;
  }

  /** Estimated button-row width from the real labels in index.html. */
  function controlsRowWidth(): number {
    const controlsBlock = html.split('<div class="controls">')[1];
    if (controlsBlock === undefined) throw new Error('no .controls in index.html');
    const labels = [...controlsBlock.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(
      (m) => (m[1] ?? '').trim(),
    );
    expect(labels).toHaveLength(8);
    // Conservative estimate at 1rem: 10px per UTF-16 unit (emoji count
    // double) + 28px horizontal padding per button + 8px gaps. Real
    // rendering is narrower (average glyph ~7-8px), so a pass here
    // has margin.
    return (
      labels.reduce((sum, label) => sum + label.length * 10 + 28, 0) +
      (labels.length - 1) * 8
    );
  }

  function totalPageHeight(vw: number, vh: number, reserve: number): number {
    const contentW = Math.min(vw, 1280) - 32;
    const stageW = Math.min(contentW, ((vh - reserve) * 16) / 9);
    const stageH = (stageW * 9) / 16;
    const rows = controlsRowWidth() <= contentW ? 1 : 2;
    return stageH + chromeFor(vh, rows);
  }

  it('the stage reserve covers the measured chrome', () => {
    const { normal, fullscreen } = stageReserves();
    // 3-line HUD chrome with the tagline shown.
    expect(normal).toBeGreaterThanOrEqual(chromeFor(1080, 1));
    expect(normal).toBe(440);
    // Fullscreen chrome is smaller (no header, padding 12): 24 +
    // 48 gaps + 66 HUD + 44 controls + 24 status + 40 legend = 246.
    expect(fullscreen).toBeGreaterThanOrEqual(246);
    expect(fullscreen).toBe(380);
  });

  it('the whole page fits at 1728x1080 and at 1728x980 (browser chrome)', () => {
    const { normal } = stageReserves();
    for (const [vw, vh] of [
      [1728, 1080],
      [1728, 980],
      [1280, 800],
      [1024, 768],
    ] as const) {
      expect(totalPageHeight(vw, vh, normal)).toBeLessThanOrEqual(vh);
    }
  });

  it('the button row fits on one line at desktop widths and wraps (never overflows)', () => {
    expect(controlsRowWidth()).toBeLessThanOrEqual(1248);
    expect(css).toContain('.controls {');
    expect(css).toMatch(/\.controls \{[^}]*flex-wrap: wrap/s);
    expect(css).toMatch(/\.game-hud \{[^}]*flex-wrap: wrap/s);
  });

  it('the page cannot scroll horizontally', () => {
    expect(css).toMatch(/overflow-x: (hidden|clip)/);
  });
});
