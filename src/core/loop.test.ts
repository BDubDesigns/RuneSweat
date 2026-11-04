import { describe, expect, it, vi } from 'vitest';
import { createFixedStepLoop, type Scheduler } from './loop';

/** A manual scheduler: the test drives frames by calling `tick()`. */
function manualScheduler(): Scheduler & { tick: (timeMs: number) => void } {
  let callback: ((timeMs: number) => void) | null = null;
  let handle = 0;
  const handles = new Set<number>();
  return {
    request: (cb) => {
      callback = cb;
      handle += 1;
      handles.add(handle);
      return handle;
    },
    cancel: (h) => {
      handles.delete(h);
      if (handles.size === 0) callback = null;
    },
    now: () => 0,
    tick: (timeMs: number) => {
      callback?.(timeMs);
    },
  };
}

describe('createFixedStepLoop', () => {
  it('runs fixed steps independent of frame rate', () => {
    const scheduler = manualScheduler();
    const update = vi.fn();
    const render = vi.fn();
    const loop = createFixedStepLoop({
      fixedDtMs: 1000 / 60,
      maxFrameMs: 250,
      // Lift the per-frame cap for this test so the step count reflects
      // the elapsed time, not the catch-up cap (the cap has its own test).
      maxUpdatesPerFrame: 10,
      update,
      render,
      scheduler,
    });
    loop.start();
    scheduler.tick(0);
    // 120ms of elapsed time = 7 full fixed steps of 1000/60 ms (7.2 steps).
    scheduler.tick(120);
    expect(update).toHaveBeenCalledTimes(7);
    expect(update).toHaveBeenCalledWith(1000 / 60, 120, 0);
    expect(render).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  it('clamps a stalled frame instead of spiralling', () => {
    const scheduler = manualScheduler();
    const update = vi.fn();
    const loop = createFixedStepLoop({
      fixedDtMs: 1000 / 60,
      maxFrameMs: 250,
      maxUpdatesPerFrame: 5,
      update,
      render: () => undefined,
      scheduler,
    });
    loop.start();
    scheduler.tick(0);
    scheduler.tick(10_000); // tab was backgrounded for 10s
    // Clamped to 250ms = 15 steps max, capped at 5 per frame.
    expect(update).toHaveBeenCalledTimes(5);
    expect(loop.stats.droppedMs).toBeGreaterThan(0);
    loop.stop();
  });

  it('is idempotent on start/stop', () => {
    const scheduler = manualScheduler();
    const loop = createFixedStepLoop({
      fixedDtMs: 1000 / 60,
      maxFrameMs: 250,
      maxUpdatesPerFrame: 5,
      update: () => undefined,
      render: () => undefined,
      scheduler,
    });
    loop.start();
    loop.start();
    expect(loop.running).toBe(true);
    loop.stop();
    loop.stop();
    expect(loop.running).toBe(false);
  });

  it('rejects a non-positive timestep', () => {
    expect(() =>
      createFixedStepLoop({
        fixedDtMs: 0,
        maxFrameMs: 250,
        maxUpdatesPerFrame: 5,
        update: () => undefined,
        render: () => undefined,
      }),
    ).toThrow(RangeError);
  });
});
