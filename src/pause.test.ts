/**
 * Pause state machine tests (Swing Lab v3.1).
 *
 * The machine is pure — no DOM, no game — so it is unit-tested here
 * directly from `main.ts`. Importing `main.ts` in node does not boot
 * the hub: the top-level `main()` call is guarded on `document`
 * existing (see the bottom of `main.ts`).
 *
 * This lives in its own file (not `main.test.ts`) on purpose: a static
 * import of `./main` here would load the module before `main.test.ts`'s
 * stub-DOM `beforeAll` runs, and the fullscreen wiring tests there
 * would never boot. Test files run in isolation, so this file's import
 * cannot affect them.
 *
 * Transition table under test (see `PauseController` for the full
 * table): town stays open when the body returns; auto resumes when
 * the body returns; Spacebar / Town button toggle town; auto never
 * opens town; town survives a gate cycle.
 */

import { describe, expect, it } from 'vitest';
import { PauseController, type PauseEvents } from './main';

function setup(): {
  controller: PauseController;
  events: string[];
} {
  const events: string[] = [];
  const controller = new PauseController({
    onManualPause: () => {
      events.push('manual-pause');
    },
    onManualResume: () => {
      events.push('manual-resume');
    },
    onAutoPause: () => {
      events.push('auto-pause');
    },
    onAutoResume: () => {
      events.push('auto-resume');
    },
  } satisfies PauseEvents);
  return { controller, events };
}

describe('PauseController', () => {
  it('starts unpaused', () => {
    const { controller } = setup();
    expect(controller.kind).toBe('none');
  });

  it('Spacebar / Pause button toggles a manual pause, and toggles it back', () => {
    const { controller, events } = setup();
    controller.toggleManual();
    expect(controller.kind).toBe('manual');
    expect(events).toEqual(['manual-pause']);
    controller.toggleManual();
    expect(controller.kind).toBe('none');
    expect(events).toEqual(['manual-pause', 'manual-resume']);
  });

  it('a manual pause stays paused when the body returns (gate cycle)', () => {
    const { controller, events } = setup();
    controller.toggleManual();
    // Body leaves frame while manually paused: the gate must not touch it.
    controller.gateClosed();
    expect(controller.kind).toBe('manual');
    expect(events).toEqual(['manual-pause']);
    // Body comes back: still manual, still paused, hub still open.
    controller.gateOpened();
    expect(controller.kind).toBe('manual');
    expect(events).toEqual(['manual-pause']);
    // Only Space / Pause resumes it.
    controller.toggleManual();
    expect(controller.kind).toBe('none');
    expect(events).toEqual(['manual-pause', 'manual-resume']);
  });

  it('an auto pause resumes when the body returns', () => {
    const { controller, events } = setup();
    controller.gateClosed();
    expect(controller.kind).toBe('auto');
    expect(events).toEqual(['auto-pause']);
    controller.gateOpened();
    expect(controller.kind).toBe('none');
    expect(events).toEqual(['auto-pause', 'auto-resume']);
  });

  it('an auto pause never opens the hub', () => {
    const { controller, events } = setup();
    controller.gateClosed();
    controller.gateOpened();
    // Only the auto events fired — no manual-pause (hub open) anywhere.
    expect(events).toEqual(['auto-pause', 'auto-resume']);
  });

  it('a gate close while already auto-paused fires nothing twice', () => {
    const { controller, events } = setup();
    controller.gateClosed();
    controller.gateClosed();
    expect(controller.kind).toBe('auto');
    expect(events).toEqual(['auto-pause']);
  });

  it('a gate open while playing fires nothing', () => {
    const { controller, events } = setup();
    controller.gateOpened();
    expect(controller.kind).toBe('none');
    expect(events).toEqual([]);
  });

  it('Spacebar during an auto pause converts to manual (it does not resume into a closed gate)', () => {
    const { controller, events } = setup();
    controller.gateClosed();
    expect(controller.kind).toBe('auto');
    controller.toggleManual();
    expect(controller.kind).toBe('manual');
    expect(events).toEqual(['auto-pause', 'manual-pause']);
    // Stepping back into frame now does NOT resume: the manual pause holds.
    controller.gateOpened();
    expect(controller.kind).toBe('manual');
    expect(events).toEqual(['auto-pause', 'manual-pause']);
    // A second press resumes.
    controller.toggleManual();
    expect(controller.kind).toBe('none');
    expect(events).toEqual([
      'auto-pause',
      'manual-pause',
      'manual-resume',
    ]);
  });

  it('a manual pause survives a full gate cycle (closed then opened)', () => {
    const { controller, events } = setup();
    controller.toggleManual();
    controller.gateClosed();
    controller.gateOpened();
    controller.gateClosed();
    controller.gateOpened();
    expect(controller.kind).toBe('manual');
    expect(events).toEqual(['manual-pause']);
  });

  it('reset closes a manual pause (hub) and resumes an auto pause', () => {
    const manual = setup();
    manual.controller.toggleManual();
    manual.controller.reset();
    expect(manual.controller.kind).toBe('none');
    expect(manual.events).toEqual(['manual-pause', 'manual-resume']);

    const auto = setup();
    auto.controller.gateClosed();
    auto.controller.reset();
    expect(auto.controller.kind).toBe('none');
    expect(auto.events).toEqual(['auto-pause', 'auto-resume']);

    const playing = setup();
    playing.controller.reset();
    expect(playing.controller.kind).toBe('none');
    expect(playing.events).toEqual([]);
  });
});
