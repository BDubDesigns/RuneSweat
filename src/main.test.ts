import { beforeAll, describe, expect, it } from 'vitest';
import { inventory } from './core/inventory';
import { VERSION } from './core/version';

/**
 * Fullscreen toggle (Swing Lab v3), tested against `main.ts` with a stub
 * DOM — the Fullscreen API itself is browser-only, so the test drives
 * the wiring: button click -> request/exitFullscreen, F key -> same,
 * `fullscreenchange` -> label. No jsdom here (node env): the stubs below
 * are the smallest surface `main()` touches at import.
 */

class StubElement {
  public textContent = '';
  public innerHTML = '';
  public hidden = false;
  public disabled = false;
  public className = '';
  public width = 960;
  public height = 540;
  public classList = { add: () => {}, remove: () => {} };
  private readonly handlers = new Map<string, ((event: never) => void)[]>();
  public requestFullscreenCalls = 0;
  /**
   * Canvas calls recorded by the stub 2D context (v3.2): method name
   * + args, in order, plus every `fillStyle` set. Tests use these to
   * prove what a frame actually drew — e.g. that town paints its
   * opaque background first and the game draws nothing behind it.
   */
  public drawCalls: { method: string; args: unknown[] }[] = [];
  public fillStyles: string[] = [];

  public addEventListener(type: string, fn: (event: never) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }

  public handlersFor(type: string): ((event: never) => void)[] {
    return this.handlers.get(type) ?? [];
  }

  public click(): void {
    for (const fn of this.handlersFor('click')) fn(undefined as never);
  }

  public append(..._args: unknown[]): void {}

  public focus(): void {}

  public requestFullscreen(): Promise<void> {
    this.requestFullscreenCalls += 1;
    return Promise.resolve();
  }

  public getContext(): unknown {
    // The render path reads ctx.canvas (games + hub size from it) and
    // ctx.measureText (debug HUD layout) — a bare no-op proxy would
    // hand back undefined for both and throw. The proxy's target IS
    // this element, so `canvas` comes back as the element itself
    // (with a working addEventListener for the games' tap listeners).
    // Everything else is a no-op that records the call: drawing is
    // unobservable in node, only the wiring is — but WHICH calls a
    // frame made is observable, and the town tests rely on it.
    return new Proxy(this, {
      get: (target, prop) => {
        if (prop === 'canvas') return target;
        if (prop === 'measureText') return () => ({ width: 0 });
        return (...args: unknown[]) => {
          target.drawCalls.push({ method: String(prop), args });
        };
      },
      set: (target, prop, value) => {
        if (prop === 'fillStyle' && typeof value === 'string') {
          target.fillStyles.push(value);
        }
        (target as unknown as Record<string | symbol, unknown>)[prop] =
          value;
        return true;
      },
    });
  }

  public getBoundingClientRect(): {
    width: number;
    height: number;
    left: number;
    top: number;
  } {
    return { width: 960, height: 540, left: 0, top: 0 };
  }
}

class StubHTMLCanvasElement extends StubElement {}
class StubHTMLElement extends StubElement {}
class StubHTMLParagraphElement extends StubHTMLElement {}
class StubHTMLDivElement extends StubHTMLElement {}
class StubHTMLButtonElement extends StubHTMLElement {}

describe('fullscreen toggle wiring', () => {
  const elements = new Map<string, StubElement>();
  /** Every element main() creates (game cards included), in order. */
  const createdElements: StubElement[] = [];
  const docHandlers = new Map<string, ((event: never) => void)[]>();
  const doc = {
    fullscreenElement: null as unknown,
    exitFullscreenCalls: 0,
    getElementById: (id: string): StubElement => {
      if (!elements.has(id)) {
        const el =
          id === 'stage'
            ? new StubHTMLCanvasElement()
            : id === 'camera-status' || id === 'out-of-frame'
              ? new StubHTMLParagraphElement()
              : id === 'game-cards' || id === 'game-hud'
                ? new StubHTMLDivElement()
                : id.startsWith('btn-')
                  ? new StubHTMLButtonElement()
                  : new StubHTMLElement();
        elements.set(id, el);
      }
      return elements.get(id) as StubElement;
    },
    createElement: (_tag: string): StubElement => {
      const el = new StubHTMLButtonElement();
      createdElements.push(el);
      return el;
    },
    addEventListener: (type: string, fn: (event: never) => void): void => {
      const list = docHandlers.get(type) ?? [];
      list.push(fn);
      docHandlers.set(type, list);
    },
    exitFullscreen: (): Promise<void> => {
      doc.exitFullscreenCalls += 1;
      doc.fullscreenElement = null;
      return Promise.resolve();
    },
  };

  function dispatchDocumentEvent(type: string, event: unknown): void {
    for (const fn of docHandlers.get(type) ?? []) {
      fn(event as never);
    }
  }

  function flush(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  beforeAll(async () => {
    (globalThis as unknown as Record<string, unknown>).HTMLCanvasElement =
      StubHTMLCanvasElement;
    (globalThis as unknown as Record<string, unknown>).HTMLElement =
      StubHTMLElement;
    (globalThis as unknown as Record<string, unknown>).HTMLParagraphElement =
      StubHTMLParagraphElement;
    (globalThis as unknown as Record<string, unknown>).HTMLDivElement =
      StubHTMLDivElement;
    (globalThis as unknown as Record<string, unknown>).HTMLButtonElement =
      StubHTMLButtonElement;
    (globalThis as unknown as Record<string, unknown>).document = doc;
    (globalThis as unknown as Record<string, unknown>).location = {
      search: '',
    };
    await import('./main');
  });

  it('starts windowed with a Fullscreen label', () => {
    const btn = elements.get('btn-fullscreen');
    expect(btn).toBeDefined();
    expect(btn?.textContent).toBe('⛶ Fullscreen');
  });

  it('the Town button says Town, not Pause (v3.2)', () => {
    const btn = elements.get('btn-pause');
    expect(btn).toBeDefined();
    expect(btn?.textContent).toBe('🏠 Town');
  });

  it('shows the build version on the select screen, matching package.json (v3.4)', () => {
    const el = elements.get('app-version');
    expect(el).toBeDefined();
    expect(el?.textContent).toBe(`RuneSweat v${VERSION}`);
  });

  it('clicking requests fullscreen on the stage section', async () => {
    const btn = elements.get('btn-fullscreen');
    const stage = elements.get('stage-section');
    if (btn === undefined || stage === undefined) {
      throw new Error('fullscreen fixtures missing');
    }
    btn.click();
    await flush();
    expect(stage.requestFullscreenCalls).toBe(1);
    // The browser reports the new state: label flips to Exit.
    doc.fullscreenElement = stage;
    dispatchDocumentEvent('fullscreenchange', {});
    expect(btn.textContent).toBe('⛶ Exit Fullscreen');
  });

  it('clicking again (or F) exits fullscreen and the label flips back', async () => {
    const btn = elements.get('btn-fullscreen');
    if (btn === undefined) throw new Error('fullscreen button missing');
    // Still fullscreen from the previous test.
    btn.click();
    await flush();
    expect(doc.exitFullscreenCalls).toBe(1);
    dispatchDocumentEvent('fullscreenchange', {});
    expect(btn.textContent).toBe('⛶ Fullscreen');
    // F key requests it again.
    const stage = elements.get('stage-section');
    if (stage === undefined) throw new Error('stage section missing');
    const before = stage.requestFullscreenCalls;
    dispatchDocumentEvent('keydown', { key: 'f', repeat: false });
    await flush();
    expect(stage.requestFullscreenCalls).toBe(before + 1);
  });

  describe('town hub <-> refiner swap wiring', () => {
  /**
   * End-to-end wiring of the v3.1 integration in `main.ts`, against
   * the same stub DOM: sim source -> Swing Lab -> Space (manual
   * pause, hub opens) -> tap Refiner -> refiner runs -> tap Leave to
   * town -> Swing Lab back, hub open. The loop's rAF is stubbed and
   * driven by hand; the canvas ctx is the no-op proxy above (drawing
   * is unobservable, only the wiring is).
   */
  const rafQueue: ((timeMs: number) => void)[] = [];
  let nowMs = 0;

  function driveFrames(n: number): void {
    for (let i = 0; i < n; i++) {
      nowMs += 1000 / 60;
      const cbs = rafQueue.splice(0, rafQueue.length);
      for (const cb of cbs) cb(nowMs);
    }
  }

  function dispatchCanvasPointerDown(x: number, y: number): void {
    const stage = elements.get('stage');
    if (stage === undefined) throw new Error('stage missing');
    const event = { clientX: x, clientY: y, button: 0, buttons: 1 };
    for (const fn of stage.handlersFor('pointerdown')) {
      fn(event as never);
    }
  }

  function dispatchCanvasPointerUp(x: number, y: number): void {
    const stage = elements.get('stage');
    if (stage === undefined) throw new Error('stage missing');
    const event = { clientX: x, clientY: y, button: 0, buttons: 0 };
    for (const fn of stage.handlersFor('pointerup')) {
      fn(event as never);
    }
  }

  function dispatchCanvasPointerMove(x: number, y: number): void {
    const stage = elements.get('stage');
    if (stage === undefined) throw new Error('stage missing');
    const event = { clientX: x, clientY: y, button: 0, buttons: 0 };
    for (const fn of stage.handlersFor('pointermove')) {
      fn(event as never);
    }
  }

  /**
   * A real tap: down arms the press, up over the same button
   * activates it (v3.3). Down alone never activates.
   */
  function dispatchCanvasTap(x: number, y: number): void {
    dispatchCanvasPointerDown(x, y);
    dispatchCanvasPointerUp(x, y);
  }

  function hudText(): string {
    return elements.get('game-hud')?.innerHTML ?? '';
  }

  function pauseLabel(): string {
    return elements.get('btn-pause')?.textContent ?? '';
  }

  it('swaps Swing Lab -> hub -> refiner -> hub -> Swing Lab', () => {
    (globalThis as unknown as Record<string, unknown>).requestAnimationFrame = (
      cb: (timeMs: number) => void,
    ): number => {
      rafQueue.push(cb);
      return rafQueue.length;
    };
    (globalThis as unknown as Record<string, unknown>).cancelAnimationFrame =
      (): void => {};

    // Play without a camera, then pick Swing Lab (the only game card:
    // Lumberjack was removed from the registry in v3.4).
    const btnSim = elements.get('btn-sim');
    if (btnSim === undefined) throw new Error('btn-sim missing');
    btnSim.click();
    const cards = createdElements.filter((el) =>
      el.className.startsWith('game-card'),
    );
    expect(cards).toHaveLength(1);
    cards[0]?.click();

    // ~1.5 s of frames: the gate opens on the sim body and the game
    // starts; the HUD shows Swing Lab.
    driveFrames(90);
    expect(hudText()).toContain('Mining Lv');

    // Space: go to town. The Town button now names the way back.
    dispatchDocumentEvent('keydown', {
      key: ' ',
      repeat: false,
      preventDefault: () => {},
    });
    expect(pauseLabel()).toBe('⛏ Back to the mine');
    // A frame renders town, computing its button rects. Mine is the
    // first activity button now, Refiner the second: right column,
    // x 492..936, y 218..270.
    driveFrames(2);
    dispatchCanvasTap(714, 244);

    // The refiner starts on the next update; the HUD shows it.
    driveFrames(3);
    expect(hudText()).toContain('Refining Lv');
    expect(pauseLabel()).toBe('🏠 Town');

    // "Leave to town" chip: bottom-left, x 12..232, y 488..528.
    dispatchCanvasTap(122, 508);
    driveFrames(2);
    // Swing Lab is restored and town is open again.
    expect(hudText()).toContain('Mining Lv');
    expect(pauseLabel()).toBe('⛏ Back to the mine');
  });

  it('town is a place: while it is open the game is not drawn behind it (v3.2)', () => {
    // State carried from the previous test: Swing Lab active, town
    // open (manual pause), Town button says '⛏ Back to the mine'.
    const stage = elements.get('stage');
    if (stage === undefined) throw new Error('stage missing');
    expect(pauseLabel()).toBe('⛏ Back to the mine');
    stage.drawCalls.length = 0;
    stage.fillStyles.length = 0;

    driveFrames(2);
    const methods = stage.drawCalls.map((c) => c.method);
    // No avatar (feet are ellipses) and no node (also ellipses):
    // the game draws nothing while town is open.
    expect(methods).not.toContain('ellipse');
    // No stage background either (RENDER.stageColor '#14141f').
    expect(stage.fillStyles).not.toContain('#14141f');
    // The first thing each frame paints is the town screen: a
    // full-canvas fill in the solid, opaque town background.
    const fillRects = stage.drawCalls.filter((c) => c.method === 'fillRect');
    expect(fillRects[0]?.args).toEqual([0, 0, 960, 540]);
    expect(stage.fillStyles[0]).toBe('#0d0d18');

    // Space leaves town and returns to the mine.
    dispatchDocumentEvent('keydown', {
      key: ' ',
      repeat: false,
      preventDefault: () => {},
    });
    expect(pauseLabel()).toBe('🏠 Town');
    // The game draws again once back in the mine.
    stage.drawCalls.length = 0;
    driveFrames(2);
    expect(stage.drawCalls.map((c) => c.method)).toContain('ellipse');
    // And Space goes to town again.
    dispatchDocumentEvent('keydown', {
      key: ' ',
      repeat: false,
      preventDefault: () => {},
    });
    expect(pauseLabel()).toBe('⛏ Back to the mine');
  });

  it('the Mine spot in town returns to the mine (v3.2)', () => {
    // State carried from the previous test: town open from mining.
    const stage = elements.get('stage');
    if (stage === undefined) throw new Error('stage missing');
    expect(pauseLabel()).toBe('⛏ Back to the mine');
    driveFrames(2);
    // Mine is the first activity button: x 492..936, y 156..208.
    dispatchCanvasTap(714, 182);
    expect(pauseLabel()).toBe('🏠 Town');
    driveFrames(2);
    expect(hudText()).toContain('Mining Lv');
  });

  it('hub buttons get hover + press states from pointer events (v3.3)', () => {
    // State carried from the previous test: back in the mine, town
    // closed. Space opens town again.
    const stage = elements.get('stage');
    if (stage === undefined) throw new Error('stage missing');
    dispatchDocumentEvent('keydown', {
      key: ' ',
      repeat: false,
      preventDefault: () => {},
    });
    expect(pauseLabel()).toBe('⛏ Back to the mine');
    driveFrames(2);

    // Hover: moving over the Refiner button (x 492..936, y 218..270)
    // brightens it — the next frame paints the hover top colour.
    stage.fillStyles.length = 0;
    dispatchCanvasPointerMove(714, 244);
    driveFrames(1);
    expect(stage.fillStyles).toContain('#ffe08a');
    // Moving away clears the hover; the idle gold is back.
    stage.fillStyles.length = 0;
    dispatchCanvasPointerMove(10, 10);
    driveFrames(1);
    expect(stage.fillStyles).toContain('#ffcf5c');
    expect(stage.fillStyles).not.toContain('#ffe08a');

    // Down alone never activates: the press is only armed.
    dispatchCanvasPointerDown(714, 244);
    expect(pauseLabel()).toBe('⛏ Back to the mine');
    // Releasing off the button cancels the press.
    dispatchCanvasPointerUp(10, 10);
    expect(pauseLabel()).toBe('⛏ Back to the mine');
    // A real tap (down + up over the button) activates it.
    dispatchCanvasTap(714, 244);
    driveFrames(3);
    expect(hudText()).toContain('Refining Lv');
    expect(pauseLabel()).toBe('🏠 Town');
  });

  it('refiner press phase: sim grab x2, drop x2, 3 P presses complete a batch (v3.4)', () => {
    // State carried from the previous test: the refiner is active,
    // town closed, picker showing. The full batch through the real
    // wiring: DOM taps + keys + pointer moves, no direct game calls.
    inventory.reset();
    inventory.add('ferrite-shale', 20);
    const stage = elements.get('stage');
    if (stage === undefined) throw new Error('stage missing');

    // Picker: tap the Refined Ferrite card twice (select, then start).
    dispatchCanvasTap(480, 188);
    dispatchCanvasTap(480, 188);
    driveFrames(2);
    expect(hudText()).toContain('Recipe: Refined Ferrite');

    // Grab: A+D clasp, release, move over the pile, dwell; drop:
    // move over the hopper. Twice.
    const grabAndDrop = (): void => {
      dispatchDocumentEvent('keydown', { key: 'a', repeat: false });
      dispatchDocumentEvent('keydown', { key: 'd', repeat: false });
      driveFrames(10);
      dispatchDocumentEvent('keyup', { key: 'a' });
      dispatchDocumentEvent('keyup', { key: 'd' });
      dispatchCanvasPointerMove(288, 319);
      driveFrames(40);
      dispatchCanvasPointerMove(672, 319);
      driveFrames(25);
    };
    grabAndDrop();
    expect(hudText()).toContain('Hopper 1/2');
    grabAndDrop();
    expect(hudText()).toContain('Hopper 2/2');
    // Pedestals slide in over 400 ms before the detector runs.
    driveFrames(30);

    // Three P presses, hands back to the centre (A+D clasp) between
    // them so the detector re-arms (see refiner.test.ts).
    for (let i = 0; i < 3; i++) {
      dispatchDocumentEvent('keydown', { key: 'p', repeat: false });
      driveFrames(90);
      dispatchDocumentEvent('keyup', { key: 'p' });
      if (i < 2) {
        expect(hudText()).toContain(`🔨 ${i + 1}/3`);
      }
      dispatchDocumentEvent('keydown', { key: 'a', repeat: false });
      dispatchDocumentEvent('keydown', { key: 'd', repeat: false });
      driveFrames(18);
      dispatchDocumentEvent('keyup', { key: 'a' });
      dispatchDocumentEvent('keyup', { key: 'd' });
      driveFrames(42);
    }
    expect(inventory.count('refined-ferrite')).toBe(1);
    expect(inventory.xp('refining')).toBe(15);
    expect(hudText()).toContain('🔨 0/3');
  });
});
});
