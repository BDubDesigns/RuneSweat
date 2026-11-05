import { beforeAll, describe, expect, it } from 'vitest';

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
    // Everything else is a no-op: drawing is unobservable in node,
    // only the wiring is.
    return new Proxy(this, {
      get: (target, prop) => {
        if (prop === 'canvas') return target;
        if (prop === 'measureText') return () => ({ width: 0 });
        return () => undefined;
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
    const event = { clientX: x, clientY: y, button: 0, buttons: 0 };
    for (const fn of stage.handlersFor('pointerdown')) {
      fn(event as never);
    }
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

    // Play without a camera, then pick Swing Lab (1st game card:
    // Swing Lab; Lumberjack is the disabled 2nd card).
    const btnSim = elements.get('btn-sim');
    if (btnSim === undefined) throw new Error('btn-sim missing');
    btnSim.click();
    const cards = createdElements.filter((el) =>
      el.className.startsWith('game-card'),
    );
    expect(cards).toHaveLength(2);
    cards[0]?.click();

    // ~1.5 s of frames: the gate opens on the sim body and the game
    // starts; the HUD shows Swing Lab.
    driveFrames(90);
    expect(hudText()).toContain('Mining Lv');

    // Space: manual pause, hub opens.
    dispatchDocumentEvent('keydown', {
      key: ' ',
      repeat: false,
      preventDefault: () => {},
    });
    expect(pauseLabel()).toBe('▶ Play');
    // A frame renders the hub, computing its button rects. The
    // Refiner button is right-column, first activity: x 492..936,
    // y 156..208.
    driveFrames(2);
    dispatchCanvasPointerDown(714, 182);

    // The refiner starts on the next update; the HUD shows it.
    driveFrames(3);
    expect(hudText()).toContain('Refining Lv');
    expect(pauseLabel()).toBe('⏸ Pause');

    // "Leave to town" chip: bottom-left, x 12..232, y 488..528.
    dispatchCanvasPointerDown(122, 508);
    driveFrames(2);
    // Swing Lab is restored and the hub is open again (manual pause).
    expect(hudText()).toContain('Mining Lv');
    expect(pauseLabel()).toBe('▶ Play');
  });
});
});
