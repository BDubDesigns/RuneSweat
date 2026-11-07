import { describe, expect, it } from 'vitest';
import { DOOR_INTERACTION, TRANSITION, WALK, WORLD } from './config';
import { DoorInteractionController } from './doorController';
import { createDefaultGestureRegistry } from './gestures/registry';
import type { DoorInputMethod } from './interaction';
import { LateralMover } from './lateralMover';
import { RoomTransition } from './roomTransition';
import { doorInRange, findDoor, getRoom, ROOMS } from './rooms';
import { armsDown, makeBody, tPose } from './testBodies';

describe('rooms (data-configured doors)', () => {
  it('every door points at a real room and arrives inside its bounds', () => {
    for (const room of Object.values(ROOMS)) {
      for (const door of room.doors) {
        const dest = getRoom(door.destinationRoomId);
        expect(dest.id).not.toBe(room.id);
        expect(door.arrivalX).toBeGreaterThanOrEqual(0);
        expect(door.arrivalX).toBeLessThanOrEqual(WORLD.width);
        if (dest.walk !== null) {
          expect(door.arrivalX).toBeGreaterThanOrEqual(dest.walk.minX);
          expect(door.arrivalX).toBeLessThanOrEqual(dest.walk.maxX);
        }
      }
    }
  });

  it('the bedroom closet door is reachable inside the walking range', () => {
    const bedroom = getRoom('bedroom');
    const door = findDoor(bedroom, 'closet-door');
    expect(door).not.toBeNull();
    if (door === null || bedroom.walk === null) throw new Error('unreachable');
    expect(door.x).toBeLessThanOrEqual(bedroom.walk.maxX);
    expect(door.x - door.reach).toBeGreaterThan(bedroom.spawnX);
  });

  it('doorInRange honours the reach and ignores UI doors', () => {
    const bedroom = getRoom('bedroom');
    expect(doorInRange(bedroom, 820)?.id).toBe('closet-door');
    expect(doorInRange(bedroom, 820 + 90)?.id).toBe('closet-door');
    expect(doorInRange(bedroom, 820 + 91)).toBeNull();
    expect(doorInRange(bedroom, 100)).toBeNull();
    expect(doorInRange(getRoom('closet'), 70)).toBeNull();
  });
});

describe('RoomTransition', () => {
  const plan = { toRoom: 'closet', spawnX: 222 } as const;

  it('runs out -> hold -> in, switching exactly once while fully covered', () => {
    const t = new RoomTransition();
    expect(t.busy).toBe(false);
    expect(t.alpha).toBe(0);
    expect(t.begin(plan)).toBe(true);
    expect(t.phase).toBe('fadingOut');

    let switched = 0;
    let finished = 0;
    let sawSwitchAlpha = -1;
    const alphas: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const u = t.update(16);
      if (u.switchTo !== null) {
        switched += 1;
        sawSwitchAlpha = t.alpha;
        expect(u.switchTo).toEqual(plan);
      }
      if (u.finished) finished += 1;
      alphas.push(t.alpha);
    }
    expect(switched).toBe(1);
    expect(finished).toBe(1);
    expect(sawSwitchAlpha).toBe(1);
    expect(t.busy).toBe(false);
    expect(t.alpha).toBe(0);
    // Monotone up then monotone down: no flash.
    const peak = alphas.indexOf(1);
    for (let i = 1; i <= peak; i += 1) expect(alphas[i]).toBeGreaterThanOrEqual(alphas[i - 1] ?? 0);
    const lastOne = alphas.lastIndexOf(1);
    for (let i = lastOne + 1; i < alphas.length; i += 1) {
      expect(alphas[i]).toBeLessThanOrEqual(alphas[i - 1] ?? 1);
    }
    const total = TRANSITION.fadeOutMs + TRANSITION.holdMs + TRANSITION.fadeInMs;
    expect(total).toBeLessThan(1000);
  });

  it('rejects rapid / interrupted begins while busy (exactly one transition)', () => {
    const t = new RoomTransition();
    expect(t.begin(plan)).toBe(true);
    t.update(100);
    expect(t.begin({ toRoom: 'bedroom', spawnX: 5 })).toBe(false);
    let switchedTo: string | null = null;
    for (let i = 0; i < 100; i += 1) {
      const u = t.update(16);
      if (u.switchTo !== null) switchedTo = u.switchTo.toRoom;
    }
    expect(switchedTo).toBe('closet');
    expect(t.begin({ toRoom: 'bedroom', spawnX: 5 })).toBe(true);
  });

  it('ignores non-positive time steps', () => {
    const t = new RoomTransition();
    t.begin(plan);
    expect(t.update(0)).toEqual({ switchTo: null, finished: false });
    expect(t.update(-5)).toEqual({ switchTo: null, finished: false });
    expect(t.alpha).toBe(0);
  });
});

describe('LateralMover', () => {
  const bounds = { minX: 70, maxX: 890 };

  function settle(m: LateralMover, torsoX: number | null, ms: number): void {
    for (let t = 0; t < ms; t += 16) m.step(16, torsoX, 0, bounds);
  }

  it('moves relative to the anchor, mirrored once: stepping right (video x shrinks) moves right', () => {
    const m = new LateralMover(400);
    settle(m, 0.5, 200); // anchor
    expect(m.x).toBeCloseTo(400, 0);
    settle(m, 0.45, 1500);
    expect(m.x).toBeGreaterThan(450);
    expect(m.facing).toBe(1);
    settle(m, 0.55, 3000);
    expect(m.x).toBeLessThan(400);
  });

  it('never leaves the room bounds, and reverses instantly off a wall', () => {
    const m = new LateralMover(800);
    settle(m, 0.9, 100);
    settle(m, 0.1, 6000);
    expect(m.x).toBeLessThanOrEqual(bounds.maxX);
    expect(m.x).toBeGreaterThan(bounds.maxX - 2);
    // Step back a little: should move left right away, not after
    // "unwinding" the overshoot.
    settle(m, 0.13, 600);
    expect(m.x).toBeLessThan(bounds.maxX - 20);
  });

  it('does not teleport when tracking is lost and returns elsewhere', () => {
    const m = new LateralMover(400);
    settle(m, 0.5, 300);
    settle(m, 0.4, 1200);
    const before = m.x;
    settle(m, null, 2000); // lost: holds still
    expect(m.x).toBe(before);
    // Player reappears at a very different torso position: no jump.
    m.step(16, 0.8, 0, bounds);
    expect(Math.abs(m.x - before)).toBeLessThan(1);
    settle(m, 0.8, 500);
    expect(Math.abs(m.x - before)).toBeLessThan(5);
  });

  it('limits camera speed', () => {
    const m = new LateralMover(400);
    m.step(16, 0.5, 0, bounds);
    const before = m.x;
    m.step(16, 0.0, 0, bounds);
    expect(Math.abs(m.x - before)).toBeLessThanOrEqual(
      (WALK.maxCameraSpeedPxPerSec * 16) / 1000 + 1e-9,
    );
  });

  it('touch walking works without any pose and stays bounded', () => {
    const m = new LateralMover(400);
    for (let i = 0; i < 400; i += 1) m.step(16, null, 1, bounds);
    expect(m.x).toBe(bounds.maxX);
    for (let i = 0; i < 400; i += 1) m.step(16, null, -1, bounds);
    expect(m.x).toBe(bounds.minX);
    expect(m.facing).toBe(-1);
  });

  it('stands still in a room with no walking range', () => {
    const m = new LateralMover(222);
    m.step(16, 0.2, 1, null);
    expect(m.x).toBe(222);
    expect(m.moving).toBe(false);
  });
});

describe('DoorInteractionController', () => {
  const bedroom = getRoom('bedroom');
  const closet = getRoom('closet');
  const doorX = 820;

  function setup(): DoorInteractionController {
    return new DoorInteractionController(createDefaultGestureRegistry());
  }

  /** Run a T-drop through the controller; returns intents seen. */
  function tDrop(
    c: DoorInteractionController,
    startMs: number,
    opts: { avatarX?: number; method?: DoorInputMethod; fresh?: boolean; locked?: boolean } = {},
  ): { intents: number; endMs: number } {
    let intents = 0;
    let t = startMs;
    const send = (body: ReturnType<typeof makeBody>, ms: number): void => {
      for (let i = 0; i < ms; i += 16) {
        t += 16;
        const intent = c.update({
          room: bedroom,
          avatarX: opts.avatarX ?? doorX,
          body,
          poseFresh: opts.fresh ?? true,
          nowMs: t,
          method: opts.method ?? 't-drop',
          locked: opts.locked ?? false,
        });
        if (intent !== null) intents += 1;
      }
    };
    send(makeBody(tPose()), 500);
    send(makeBody({ leftAngle: 120, rightAngle: -120 }), 100);
    send(makeBody(armsDown()), 300);
    return { intents, endMs: t };
  }

  it('emits one enter intent for the closet door with the gesture as its source', () => {
    const c = setup();
    let seen: { action: string; targetId: string; source: string } | null = null;
    let t = 0;
    const feed = (b: ReturnType<typeof makeBody>, ms: number): void => {
      for (let i = 0; i < ms; i += 16) {
        t += 16;
        const intent = c.update({
          room: bedroom, avatarX: doorX, body: b, poseFresh: true, nowMs: t,
          method: 't-drop', locked: false,
        });
        if (intent !== null) seen = intent;
      }
    };
    feed(makeBody(tPose()), 500);
    feed(makeBody({ leftAngle: 120, rightAngle: -120 }), 100);
    feed(makeBody(armsDown()), 300);
    expect(seen).toEqual({ action: 'enter', targetId: 'closet-door', source: 't-drop' });
  });

  it('never emits outside the door interaction range', () => {
    const c = setup();
    expect(tDrop(c, 0, { avatarX: 500 }).intents).toBe(0);
  });

  it('building a gesture then walking out of range drops the progress', () => {
    const c = setup();
    let t = 0;
    const step = (x: number, b: ReturnType<typeof makeBody>, ms: number): number => {
      let n = 0;
      for (let i = 0; i < ms; i += 16) {
        t += 16;
        if (
          c.update({
            room: bedroom, avatarX: x, body: b, poseFresh: true, nowMs: t,
            method: 't-drop', locked: false,
          }) !== null
        ) n += 1;
      }
      return n;
    };
    step(doorX, makeBody(tPose()), 500); // armed at the door
    step(300, makeBody(tPose()), 100); // walked away: progress reset
    // Back in range and arms drop without a fresh T hold: nothing.
    expect(step(doorX, makeBody(armsDown()), 600)).toBe(0);
  });

  it('stale pose never feeds a recognizer', () => {
    const c = setup();
    expect(tDrop(c, 0, { fresh: false }).intents).toBe(0);
  });

  it('is locked while a transition runs', () => {
    const c = setup();
    expect(tDrop(c, 0, { locked: true }).intents).toBe(0);
  });

  it('only the selected recognizer runs; touch selection has no motion recognizer', () => {
    const c = setup();
    expect(tDrop(c, 0, { method: 'travolta' }).intents).toBe(0);
    const c2 = setup();
    expect(tDrop(c2, 0, { method: 'touch' }).intents).toBe(0);
  });

  it('cooldown blocks a second intent; it passes after the cooldown', () => {
    const c = setup();
    const first = tDrop(c, 0);
    expect(first.intents).toBe(1);
    // Immediately repeat inside the cooldown: blocked.
    expect(tDrop(c, first.endMs).intents).toBe(0);
    // Long after: allowed again.
    const later = tDrop(c, first.endMs + 5000);
    expect(later.intents).toBe(1);
    expect(DOOR_INTERACTION.cooldownMs).toBeGreaterThan(0);
  });

  it('manual (Enter / touch) always works near the door whatever gesture is selected', () => {
    for (const _method of ['travolta', 't-drop', 'touch'] as const) {
      const c = setup();
      const intent = c.requestManual(bedroom, doorX, 100, false);
      expect(intent).toEqual({ action: 'enter', targetId: 'closet-door', source: 'touch' });
    }
  });

  it('manual is bound to proximity, the transition lock and the cooldown', () => {
    const c = setup();
    expect(c.requestManual(bedroom, 300, 100, false)).toBeNull();
    expect(c.requestManual(bedroom, doorX, 100, true)).toBeNull();
    expect(c.requestManual(bedroom, doorX, 100, false)).not.toBeNull();
    expect(c.requestManual(bedroom, doorX, 200, false)).toBeNull(); // once
    expect(c.requestManual(bedroom, doorX, 100 + DOOR_INTERACTION.cooldownMs + 1, false)).not.toBeNull();
  });

  it('the same controller serves the exit direction (UI door in the closet)', () => {
    const c = setup();
    expect(c.requestUiDoor(closet, 'closet-exit', 'lever', 100, false)).toEqual({
      action: 'exit',
      targetId: 'closet-exit',
      source: 'lever',
    });
    // Proximity doors cannot be triggered through the UI path, nor vice versa.
    expect(c.requestUiDoor(bedroom, 'closet-door', 'touch', 5000, false)).toBeNull();
    expect(c.requestManual(closet, 70, 9000, false)).toBeNull();
  });
});
