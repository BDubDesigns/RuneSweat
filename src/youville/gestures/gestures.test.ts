import { describe, expect, it } from 'vitest';
import type { GestureRecognizer } from '../interaction';
import {
  REST_LEFT,
  REST_RIGHT,
  TRAVOLTA_LOW_LEFT,
  TRAVOLTA_UP_LEFT,
  armsDown,
  makeBody,
  tPose,
  travoltaZonesAreReachable,
  type BodyOptions,
  type Offset,
} from '../testBodies';
import { TDropRecognizer } from './tDrop';
import { TravoltaRecognizer } from './travolta';

type Frame = readonly [number, BodyOptions | null];

/** Feed frames at their timestamps; returns how many times it fired. */
function run(rec: GestureRecognizer, frames: readonly Frame[]): number {
  let fired = 0;
  for (const [t, options] of frames) {
    const body = options === null ? null : makeBody({ ...options, timestampMs: t });
    if (rec.update(body, t)) fired += 1;
  }
  return fired;
}

/** Hold options for `durationMs` at 60 Hz starting at `startMs`. */
function hold(startMs: number, durationMs: number, options: BodyOptions | null): Frame[] {
  const frames: Frame[] = [];
  for (let t = startMs; t <= startMs + durationMs; t += 16) frames.push([t, options]);
  return frames;
}

const up = (o: Offset = TRAVOLTA_UP_LEFT): BodyOptions => ({ leftWrist: o });
const low = (o: Offset = TRAVOLTA_LOW_LEFT): BodyOptions => ({ leftWrist: o });

describe('TravoltaRecognizer', () => {
  it('test zones are inside the configured zones', () => {
    expect(travoltaZonesAreReachable()).toBe(true);
  });

  it('fires once on up -> low -> up within the windows', () => {
    const rec = new TravoltaRecognizer();
    const frames: Frame[] = [
      ...hold(0, 100, up()),
      [200, { leftWrist: { x: -0.4, y: 0.2 } }], // in transit
      ...hold(400, 60, low()),
      [560, { leftWrist: { x: -0.4, y: 0.2 } }],
      ...hold(760, 60, up()),
    ];
    expect(run(rec, frames)).toBe(1);
  });

  it('works for the other hand mirrored (side-agnostic)', () => {
    const rec = new TravoltaRecognizer();
    const mirror = (o: Offset): BodyOptions => ({
      rightWrist: { x: -o.x, y: o.y },
      leftWrist: REST_LEFT,
    });
    const frames: Frame[] = [
      ...hold(0, 100, mirror(TRAVOLTA_UP_LEFT)),
      [250, mirror({ x: 0.4, y: 0.2 })],
      ...hold(400, 60, mirror(TRAVOLTA_LOW_LEFT)),
      [560, mirror({ x: 0.4, y: 0.2 })],
      ...hold(760, 60, mirror(TRAVOLTA_UP_LEFT)),
    ];
    expect(run(rec, frames)).toBe(1);
  });

  it('does not fire on a single pass', () => {
    const rec = new TravoltaRecognizer();
    expect(
      run(rec, [...hold(0, 100, up()), [250, low()], ...hold(400, 100, low())]),
    ).toBe(0);
  });

  it('does not fire when the hand never leaves the rest position (jitter)', () => {
    const rec = new TravoltaRecognizer();
    const frames: Frame[] = [];
    for (let t = 0; t < 4000; t += 16) {
      const wobble = Math.sin(t / 40) * 0.05;
      frames.push([
        t,
        {
          leftWrist: { x: REST_LEFT.x + wobble, y: REST_LEFT.y + wobble },
          rightWrist: { x: REST_RIGHT.x - wobble, y: REST_RIGHT.y },
        },
      ]);
    }
    expect(run(rec, frames)).toBe(0);
  });

  it('rejects a one-frame tracking glitch (legMinMs)', () => {
    const rec = new TravoltaRecognizer();
    expect(
      run(rec, [
        [0, up()],
        [16, low()], // teleport: too fast to be a real leg
        [32, up()],
      ]),
    ).toBe(0);
  });

  it('rejects when the legs are too slow (timing window)', () => {
    const rec = new TravoltaRecognizer();
    const frames: Frame[] = [
      ...hold(0, 100, up()),
      [600, { leftWrist: { x: -0.4, y: 0.2 } }],
      ...hold(1500, 100, low()), // > legMaxMs after leaving UP
      ...hold(2500, 100, up()),
    ];
    expect(run(rec, frames)).toBe(0);
  });

  it('rejects crossed hands (both wrists together above the hip)', () => {
    const rec = new TravoltaRecognizer();
    const frames: Frame[] = [
      ...hold(0, 100, up()),
      // Hands clasp at chest height mid-swing.
      [250, { leftWrist: { x: -0.2, y: 0.25 }, rightWrist: { x: -0.05, y: 0.3 } }],
      ...hold(400, 60, low()),
      ...hold(600, 60, up()),
    ];
    expect(run(rec, frames)).toBe(0);
  });

  it('a hand hanging at the hip does not count as crossed while the other swings past it', () => {
    const rec = new TravoltaRecognizer();
    const frames: Frame[] = [
      ...hold(0, 100, up()),
      [250, { leftWrist: { x: -0.4, y: 0.2 } }],
      ...hold(400, 60, { leftWrist: TRAVOLTA_LOW_LEFT, rightWrist: REST_RIGHT }),
      [560, { leftWrist: { x: -0.4, y: 0.2 } }],
      ...hold(760, 60, up()),
    ];
    expect(run(rec, frames)).toBe(1);
  });

  it('rejects both arms flailing the same way (jumping jacks)', () => {
    const rec = new TravoltaRecognizer();
    const frames: Frame[] = [];
    for (let k = 0; k < 4; k += 1) {
      const t = k * 300;
      frames.push([t, { leftWrist: TRAVOLTA_UP_LEFT, rightWrist: { x: 1.05, y: -0.82 } }]);
      frames.push([t + 150, { leftWrist: REST_LEFT, rightWrist: REST_RIGHT }]);
    }
    expect(run(rec, frames)).toBe(0);
  });

  it('resets on tracking loss mid-gesture', () => {
    const rec = new TravoltaRecognizer();
    const frames: Frame[] = [
      ...hold(0, 100, up()),
      [250, low()],
      [300, null], // body lost
      ...hold(400, 100, up()),
    ];
    expect(run(rec, frames)).toBe(0);
  });

  it('ignores an unusable (gated) body', () => {
    const rec = new TravoltaRecognizer();
    const frames: Frame[] = [
      ...hold(0, 100, { ...up(), usable: false }),
      [250, { ...low(), usable: false }],
      ...hold(400, 100, { ...up(), usable: false }),
    ];
    expect(run(rec, frames)).toBe(0);
  });

  it('waving on your own side (up -> rest -> up) is not the gesture', () => {
    const rec = new TravoltaRecognizer();
    const frames: Frame[] = [
      ...hold(0, 100, up()),
      ...hold(300, 100, { leftWrist: REST_LEFT }),
      ...hold(600, 100, up()),
    ];
    expect(run(rec, frames)).toBe(0);
  });

  it('latches after firing and re-arms only once the raised hand comes down', () => {
    const rec = new TravoltaRecognizer();
    const once: Frame[] = [
      ...hold(0, 100, up()),
      [250, { leftWrist: { x: -0.4, y: 0.2 } }],
      ...hold(400, 60, low()),
      [560, { leftWrist: { x: -0.4, y: 0.2 } }],
      ...hold(760, 60, up()),
    ];
    expect(run(rec, once)).toBe(1);
    // Holding the final pose does not fire again.
    expect(run(rec, hold(900, 1500, up()))).toBe(0);
    // Hand comes down out of the UP zone, then a full second sequence fires.
    const mid: BodyOptions = { leftWrist: { x: -0.3, y: 0.1 } };
    const again: Frame[] = [
      ...hold(2500, 50, mid),
      ...hold(2600, 100, up()),
      [2800, mid],
      ...hold(2950, 60, low()),
      [3100, mid],
      ...hold(3300, 60, up()),
    ];
    expect(run(rec, again)).toBe(1);
  });
});

describe('TDropRecognizer', () => {
  const T_HOLD_MS = 500;

  it('fires once: hold a T, then drop both arms', () => {
    const rec = new TDropRecognizer();
    const frames: Frame[] = [
      ...hold(0, T_HOLD_MS, tPose()),
      ...hold(516, 200, { leftAngle: 120, rightAngle: -120 }),
      ...hold(732, 200, armsDown()),
    ];
    expect(run(rec, frames)).toBe(1);
  });

  it('standing with arms down never opens', () => {
    const rec = new TDropRecognizer();
    expect(run(rec, hold(0, 5000, armsDown()))).toBe(0);
  });

  it('an incomplete T (arms ~45 degrees) never arms', () => {
    const rec = new TDropRecognizer();
    const frames: Frame[] = [
      ...hold(0, 800, { leftAngle: 45, rightAngle: -45 }),
      ...hold(816, 300, armsDown()),
    ];
    expect(run(rec, frames)).toBe(0);
  });

  it('a T that is not held long enough is not a deliberate start', () => {
    const rec = new TDropRecognizer();
    const frames: Frame[] = [...hold(0, 150, tPose()), ...hold(166, 300, armsDown())];
    expect(run(rec, frames)).toBe(0);
  });

  it('an accidental one-armed drop does not fire', () => {
    const rec = new TDropRecognizer();
    const frames: Frame[] = [
      ...hold(0, T_HOLD_MS, tPose()),
      ...hold(516, 800, { leftAngle: 170, rightAngle: -90 }),
    ];
    expect(run(rec, frames)).toBe(0);
  });

  it('both arms on the same side is not a T', () => {
    const rec = new TDropRecognizer();
    const frames: Frame[] = [
      ...hold(0, T_HOLD_MS, { leftAngle: 90, rightAngle: 90 }),
      ...hold(516, 300, { leftAngle: 170, rightAngle: 170 }),
    ];
    expect(run(rec, frames)).toBe(0);
  });

  it('a drop that takes too long times out', () => {
    const rec = new TDropRecognizer();
    const frames: Frame[] = [
      ...hold(0, T_HOLD_MS, tPose()),
      ...hold(516, 1500, { leftAngle: 125, rightAngle: -125 }),
      ...hold(2032, 300, armsDown()),
    ];
    expect(run(rec, frames)).toBe(0);
  });

  it('resets on tracking loss between the T and the drop', () => {
    const rec = new TDropRecognizer();
    const frames: Frame[] = [
      ...hold(0, T_HOLD_MS, tPose()),
      [520, null],
      ...hold(540, 300, armsDown()),
    ];
    expect(run(rec, frames)).toBe(0);
  });

  it('crossed arms (both on one side, low) do not fire', () => {
    const rec = new TDropRecognizer();
    const frames: Frame[] = [
      ...hold(0, 600, { leftAngle: 120, rightAngle: 120 }),
      ...hold(616, 300, armsDown()),
    ];
    expect(run(rec, frames)).toBe(0);
  });

  it('latches after firing; a fresh held T is needed to fire again', () => {
    const rec = new TDropRecognizer();
    const first: Frame[] = [
      ...hold(0, T_HOLD_MS, tPose()),
      ...hold(516, 100, { leftAngle: 120, rightAngle: -120 }),
      ...hold(632, 300, armsDown()),
    ];
    expect(run(rec, first)).toBe(1);
    expect(run(rec, hold(950, 3000, armsDown()))).toBe(0);
    const second: Frame[] = [
      ...hold(4000, T_HOLD_MS, tPose()),
      ...hold(4516, 100, { leftAngle: 120, rightAngle: -120 }),
      ...hold(4632, 300, armsDown()),
    ];
    expect(run(rec, second)).toBe(1);
  });

  it('ignores a gated body', () => {
    const rec = new TDropRecognizer();
    const frames: Frame[] = [
      ...hold(0, T_HOLD_MS, { ...tPose(), usable: false }),
      ...hold(516, 300, { ...armsDown(), usable: false }),
    ];
    expect(run(rec, frames)).toBe(0);
  });
});
