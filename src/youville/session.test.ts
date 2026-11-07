/**
 * End-to-end session tests: bedroom -> move to door -> open -> fade ->
 * closet -> preview -> lever confirm -> Done -> fade -> bedroom, with
 * each door gesture, and touch-only. Camera paths drive the REAL
 * BodyStateTracker with synthetic landmarks. These prove the logic,
 * NOT physical playability: the real-camera Pixel playtest is a
 * separate release gate.
 */
import { describe, expect, it } from 'vitest';
import { STARTER_APPEARANCE } from '../creator/avatarAppearance';
import { WORLD } from './config';
import { getRoom } from './rooms';
import { YouVilleSession, type PoseInput } from './session';
import { PoseDriver, makeBody } from './testBodies';
import type { SyntheticPoseOptions } from '../core/poseFixture';
import { closetLayout } from './closetLayout';

const STEP_MS = 1000 / 60;

class Harness {
  public readonly session = new YouVilleSession();
  public readonly driver = new PoseDriver();
  public now = 1000;
  private lastFeed = Number.NEGATIVE_INFINITY;

  /** `poseHz` models the camera's inference rate (Pixel ~9 Hz, desktop ~30). */
  public constructor(private readonly poseHz = 30) {}

  /** Advance `ms` with the player holding `pose` (null = no camera pose fed). */
  public hold(ms: number, pose: SyntheticPoseOptions | null): void {
    const end = this.now + ms;
    while (this.now < end) {
      if (pose !== null && this.now - this.lastFeed >= 1000 / this.poseHz) {
        this.driver.feed(this.now, pose);
        this.lastFeed = this.now;
      }
      this.session.update(STEP_MS, this.now, pose === null ? null : this.driver.pose());
      this.now += STEP_MS;
    }
  }

  /** Walk with touch controls until the avatar is within `px` of x. */
  public touchWalkTo(x: number, px = 20): void {
    for (let i = 0; i < 2000; i += 1) {
      const d = x - this.session.mover.x;
      if (Math.abs(d) <= px) break;
      this.session.touchDir = d > 0 ? 1 : -1;
      this.hold(STEP_MS, null);
    }
    this.session.touchDir = 0;
  }

  public finishTransition(): void {
    for (let i = 0; i < 200 && this.session.transition.busy; i += 1) this.hold(STEP_MS, null);
  }
}

const STAND: SyntheticPoseOptions = { torsoX: 0.5 };
const T: SyntheticPoseOptions = { torsoX: 0.5, leftArmDeg: -90, rightArmDeg: 90 };
const T_MID: SyntheticPoseOptions = { torsoX: 0.5, leftArmDeg: -125, rightArmDeg: 125 };
const DOWN: SyntheticPoseOptions = { torsoX: 0.5, leftArmDeg: 170, rightArmDeg: 170 };

/** Left hand up-and-out, and swung down across the body (see travolta.ts). */
const UP: SyntheticPoseOptions = { torsoX: 0.5, leftArmDeg: -40, rightArmDeg: 170 };
const ACROSS: SyntheticPoseOptions = { torsoX: 0.5, leftArmDeg: 145, rightArmDeg: 170 };

function doTDrop(h: Harness): void {
  h.hold(700, T);
  h.hold(150, T_MID);
  h.hold(500, DOWN);
}

function doTravolta(h: Harness): void {
  h.hold(500, UP);
  h.hold(450, ACROSS);
  h.hold(450, UP);
  h.hold(300, STAND);
}

/** A PoseInput with the LEFT wrist on a closet cell and the right arm as the lever. */
function leverPose(cell: string, leverAngle: number, nowMs: number): PoseInput {
  const c = closetLayout().all.find((x) => x.id === cell);
  if (c === undefined) throw new Error(cell);
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const body = makeBody({
    leftWrist: { x: (1 - cx / WORLD.width - 0.5) / 0.3, y: (cy / WORLD.height - 0.3) / 0.3 },
    leftAngle: 170,
    rightAngle: leverAngle,
    timestampMs: nowMs,
  });
  return { body, receivedAtMs: nowMs };
}

describe('YouVilleSession: first frame', () => {
  it('starts in the bedroom with the plain starter avatar, before any camera', () => {
    const s = new YouVilleSession();
    expect(s.roomId).toBe('bedroom');
    expect(s.appearance).toEqual(STARTER_APPEARANCE);
    expect(s.mover.x).toBe(getRoom('bedroom').spawnX);
    expect(s.transition.busy).toBe(false);
    expect(s.hint).toContain('closet');
  });
});

describe('touch-only loop (no camera at all)', () => {
  it('bedroom -> door -> Enter -> fade -> closet -> pick -> Done -> fade -> bedroom', () => {
    const h = new Harness();
    const s = h.session;
    expect(s.doorMethod).toBe('travolta'); // gesture selected, but touch must still work

    // Enter is a no-op away from the door.
    expect(s.pressEnter(h.now)).toBe(false);
    h.touchWalkTo(820);
    expect(s.nearbyDoor?.id).toBe('closet-door');
    expect(s.hint).toContain('Enter');

    expect(s.pressEnter(h.now)).toBe(true);
    expect(s.transition.busy).toBe(true);
    // Input is disabled during the fade; Enter again is ignored.
    expect(s.pressEnter(h.now)).toBe(false);
    s.touchDir = -1;
    const xBefore = s.mover.x;
    h.hold(100, null);
    expect(s.mover.x).toBe(xBefore);
    s.touchDir = 0;

    // The room switches only once the screen is fully covered.
    let switchedAtAlpha = -1;
    const roomNow = (): string => s.roomId;
    for (let i = 0; i < 200 && roomNow() === 'bedroom'; i += 1) {
      h.hold(STEP_MS, null);
      if (roomNow() === 'closet') switchedAtAlpha = s.transition.alpha;
    }
    expect(roomNow()).toBe('closet');
    expect(switchedAtAlpha).toBe(1);
    h.finishTransition();
    expect(s.transition.busy).toBe(false);
    expect(s.transitionCount).toBe(1);
    expect(s.visitedCloset).toBe(true);

    // Tap options: appearance really changes.
    const layout = closetLayout();
    const tapCell = (id: string): void => {
      const c = layout.all.find((x) => x.id === id);
      if (c === undefined) throw new Error(id);
      const r = s.creator.tap({ x: c.x + c.w / 2, y: c.y + c.h / 2 }, h.now);
      s.handleCreatorResult(r, h.now);
    };
    tapCell('skinTone:#f6dec5');
    tapCell('hairstyle:braids');
    tapCell('shirtColor:#b56c87');
    expect(s.appearance).toEqual({
      skinTone: '#f6dec5',
      hairstyle: 'braids',
      shirtColor: '#b56c87',
    });
    expect(s.displayAppearance).toEqual(s.appearance);

    // Done -> same controller, same fade, other direction.
    h.hold(1600, null); // let the arrival cooldown pass
    tapCell('done');
    expect(s.transition.busy).toBe(true);
    expect(s.lastIntent).toEqual({ action: 'exit', targetId: 'closet-exit', source: 'touch' });
    h.hold(1000, null);
    expect(s.roomId).toBe('bedroom');
    expect(s.transitionCount).toBe(2);
    // Appearance survives the round trip; avatar arrives at the door, not at the spawn.
    expect(s.appearance.hairstyle).toBe('braids');
    expect(s.mover.x).toBe(770);
    expect(s.nearbyDoor?.id).toBe('closet-door');

    // And the customized avatar still walks.
    const x0 = s.mover.x;
    s.touchDir = -1;
    h.hold(500, null);
    s.touchDir = 0;
    expect(s.mover.x).toBeLessThan(x0);
  });

  it('re-entering the closet allows further changes', () => {
    const h = new Harness();
    h.touchWalkTo(820);
    h.session.pressEnter(h.now);
    h.hold(2000, null);
    expect(h.session.roomId).toBe('closet');
    h.hold(1500, null); // arrival cooldown
    h.session.creator.confirm('hairstyle:locs', h.now);
    h.session.handleCreatorResult({ kind: 'done' }, h.now);
    h.hold(2500, null);
    expect(h.session.roomId).toBe('bedroom');
    h.session.pressEnter(h.now);
    h.hold(2000, null);
    expect(h.session.roomId).toBe('closet');
    expect(h.session.appearance.hairstyle).toBe('locs');
    h.session.creator.confirm('hairstyle:curls', h.now);
    expect(h.session.appearance.hairstyle).toBe('curls');
  });
});

describe('camera: door gestures through the real tracker', () => {
  for (const hz of [30, 9]) {
    it(`T-drop opens the door and brings the player to the closet (${String(hz)} Hz pose)`, () => {
      const h = new Harness(hz);
      h.session.setDoorMethod('t-drop');
      h.hold(300, STAND);
      h.touchWalkTo(820);
      h.hold(300, STAND);
      expect(h.session.roomId).toBe('bedroom');
      doTDrop(h);
      expect(h.session.transitionCount).toBe(1);
      expect(h.session.lastIntent).toEqual({
        action: 'enter',
        targetId: 'closet-door',
        source: 't-drop',
      });
      h.hold(1200, STAND);
      expect(h.session.roomId).toBe('closet');
      expect(h.session.transitionCount).toBe(1);
    });

    it(`Travolta opens the door (${String(hz)} Hz pose)`, () => {
      const h = new Harness(hz);
      h.session.setDoorMethod('travolta');
      h.hold(300, STAND);
      h.touchWalkTo(820);
      h.hold(300, STAND);
      doTravolta(h);
      expect(h.session.transitionCount).toBe(1);
      expect(h.session.lastIntent?.source).toBe('travolta');
      h.hold(1200, STAND);
      expect(h.session.roomId).toBe('closet');
    });
  }

  it('the unselected gesture does nothing (preference is respected)', () => {
    const h = new Harness();
    h.session.setDoorMethod('travolta');
    h.hold(300, STAND);
    h.touchWalkTo(820);
    doTDrop(h);
    expect(h.session.transitionCount).toBe(0);
    h.session.setDoorMethod('t-drop');
    h.hold(1600, STAND); // cooldown irrelevant: no intent happened
    doTDrop(h);
    expect(h.session.transitionCount).toBe(1);
  });

  it('switching preference mid-session needs no scene rebuild', () => {
    const h = new Harness();
    h.touchWalkTo(820);
    h.hold(500, STAND);
    const room = h.session.room;
    h.session.setDoorMethod('t-drop');
    h.session.setDoorMethod('touch');
    expect(h.session.room).toBe(room);
    expect(h.session.hint).toContain('Enter');
  });

  it('no gesture works away from the door', () => {
    const h = new Harness();
    h.session.setDoorMethod('t-drop');
    h.hold(300, STAND);
    h.touchWalkTo(300);
    doTDrop(h);
    expect(h.session.transitionCount).toBe(0);
  });

  it('a stale pose (camera feed stopped) never opens the door', () => {
    const h = new Harness();
    h.session.setDoorMethod('t-drop');
    h.touchWalkTo(820);
    h.hold(700, T);
    // Camera freezes on the last frame mid-gesture: nothing is fed any more.
    const stalePose = h.driver.pose();
    for (let i = 0; i < 180; i += 1) {
      h.session.update(STEP_MS, h.now, stalePose);
      h.now += STEP_MS;
    }
    expect(h.session.poseFresh).toBe(false);
    expect(h.session.transitionCount).toBe(0);
  });

  it('Enter still works when the camera is on and a gesture is selected', () => {
    const h = new Harness();
    h.session.setDoorMethod('t-drop');
    h.hold(300, STAND);
    h.touchWalkTo(820);
    h.hold(300, STAND);
    expect(h.session.pressEnter(h.now)).toBe(true);
  });

  it('camera walking moves the avatar and pauses (no teleport) when the pose is lost', () => {
    const h = new Harness();
    h.hold(400, { torsoX: 0.5 });
    const x0 = h.session.mover.x;
    h.hold(1500, { torsoX: 0.42 }); // steps right (video x shrinks)
    const x1 = h.session.mover.x;
    expect(x1).toBeGreaterThan(x0 + 40);
    // Lost for a long time.
    h.hold(3000, null);
    expect(h.session.mover.x).toBe(x1);
    // Reappears far away: avatar stays put, then follows relatively.
    h.hold(600, { torsoX: 0.75 });
    expect(Math.abs(h.session.mover.x - x1)).toBeLessThan(10);
  });
});

describe('camera: closet lever through the session', () => {
  it('pointing + lever commits the option; pointing at Done + lever returns to the bedroom', () => {
    const h = new Harness();
    h.touchWalkTo(820);
    h.session.pressEnter(h.now);
    h.hold(2400, null);
    expect(h.session.roomId).toBe('closet');
    expect(h.session.transition.busy).toBe(false);

    const pull = (cell: string): void => {
      for (const [ms, angle] of [[300, 90], [100, 130], [300, 170]] as const) {
        const end = h.now + ms;
        while (h.now < end) {
          h.session.update(STEP_MS, h.now, leverPose(cell, angle, h.now));
          h.now += STEP_MS;
        }
      }
    };

    // Hover shows a live preview before anything is committed.
    const hoverEnd = h.now + 100;
    while (h.now < hoverEnd) {
      h.session.update(STEP_MS, h.now, leverPose('hairstyle:locs', 170, h.now));
      h.now += STEP_MS;
    }
    expect(h.session.displayAppearance.hairstyle).toBe('locs');
    expect(h.session.appearance.hairstyle).toBe(STARTER_APPEARANCE.hairstyle);

    pull('hairstyle:locs');
    expect(h.session.appearance.hairstyle).toBe('locs');
    expect(h.session.creator.isComplete('hairstyle')).toBe(true);

    pull('skinTone:#dca77c');
    expect(h.session.appearance.skinTone).toBe('#dca77c');

    pull('done');
    expect(h.session.transition.busy).toBe(true);
    expect(h.session.lastIntent).toEqual({ action: 'exit', targetId: 'closet-exit', source: 'lever' });
    h.hold(1200, null);
    expect(h.session.roomId).toBe('bedroom');
    expect(h.session.transitionCount).toBe(2);
    expect(h.session.appearance.hairstyle).toBe('locs');
    expect(h.session.appearance.skinTone).toBe('#dca77c');
  });

  it('a lost pose in the closet confirms nothing and clears the cursor', () => {
    const h = new Harness();
    h.touchWalkTo(820);
    h.session.pressEnter(h.now);
    h.hold(2400, null);
    const end = h.now + 700;
    while (h.now < end) {
      // Pose is stale: receivedAt is far in the past.
      h.session.update(STEP_MS, h.now, { ...leverPose('hairstyle:locs', 170, h.now), receivedAtMs: 0 });
      h.now += STEP_MS;
    }
    expect(h.session.creator.cursor).toBeNull();
    expect(h.session.appearance).toEqual(STARTER_APPEARANCE);
  });
});
