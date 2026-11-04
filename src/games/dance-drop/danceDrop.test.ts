/**
 * Dance Pose Drop tests.
 *
 * Pose tests assert the templates against `poseMatchScore()` — the same
 * matcher the game uses, so a passing suite means the poses are
 * distinguishable in live play, not just on paper. Game tests drive
 * `DanceDropGame` with synthetic landmarks (a pose's own template scores
 * 1.0 against its target, so feeding the current pose's template is the
 * stand-in for Lara holding the pose) and a stub `SoundEffects` that
 * records calls.
 *
 * Canvas geometry in the game tests assumes the 640x480 playfield:
 * zone top 324 / bottom 464, middle 50% 359–429, target box 216 tall,
 * round-1 fall speed 90 px/s. `zoneGeometry()` / `targetBox()` pin those
 * numbers in their own tests, so a geometry change fails loudly here.
 */

import { describe, expect, it } from 'vitest';
import { BODY, DANCE } from '../../core/config';
import { jointAngles, poseMatchScore } from '../../core/bodyState';
import type { SoundEffects } from '../../core/audio';
import { PoseLandmark } from '../../tracking/poseTypes';
import {
  DanceDropGame,
  fallSpeedForRound,
  gradeHold,
  PoseHoldTracker,
  targetBox,
  zoneGeometry,
} from './danceDrop';
import {
  buildDancePose,
  buildPoseTemplate,
  POSE_DEFINITIONS,
  POSES,
  pickNextPose,
  targetAnglesFor,
  type DancePose,
} from './poses';

/** A recording stand-in for SoundEffects (no AudioContext in tests). */
function makeSfx(): { sfx: SoundEffects; calls: string[] } {
  const calls: string[] = [];
  const sfx = {
    feedback: (kind: 'perfect' | 'good' | 'miss'): void => {
      calls.push(`feedback:${kind}`);
    },
    win: (): void => {
      calls.push('win');
    },
  } as unknown as SoundEffects;
  return { sfx, calls };
}

/**
 * Minimal 2D context: every method is a no-op, every set property sticks.
 * The game only reads `canvas.width` / `canvas.height` back, so a Proxy
 * is enough — no DOM, no canvas implementation.
 */
function makeCtx(
  width = 640,
  height = 480,
): CanvasRenderingContext2D {
  const target: Record<string | symbol, unknown> = {
    canvas: { width, height },
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      return () => undefined;
    },
    set(t, prop, value) {
      t[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function poseById(id: string): DancePose {
  const found = POSES.find((pose) => pose.id === id);
  if (found === undefined) throw new Error(`no pose with id ${id}`);
  return found;
}

/** Miss one round, then clear the feedback breather. Returns the clock. */
function driveMiss(game: DanceDropGame, nowMs: number): number {
  game.update(20000, nowMs, null, null);
  game.update(100, nowMs + 2000, null, null);
  return nowMs + 2000;
}

/**
 * Score a Perfect in round 1 (fall speed 90 px/s): fast-forward the
 * target until its centre is inside the zone's middle 50%, then hold the
 * matching pose for the 0.6s hold. Returns the clock after the round.
 */
function drivePerfect(game: DanceDropGame, nowMs: number): number {
  game.update(5200, nowMs + 5200, null, null);
  const template = game.currentPose.template;
  for (let i = 1; i <= 6; i += 1) {
    game.update(100, nowMs + 5200 + i * 100, null, template);
  }
  game.update(100, nowMs + 6900, null, null);
  return nowMs + 6900;
}

describe('poses', () => {
  it('has the five poses, in order', () => {
    expect(POSES.map((pose) => pose.id)).toEqual([
      'arms-up',
      't-pose',
      'hands-on-hips',
      'one-arm-up',
      'star-jump',
    ]);
    expect(POSES.map((pose) => pose.name)).toEqual([
      'Arms Up',
      'T-pose',
      'Hands on Hips',
      'One Arm Up',
      'Star Jump',
    ]);
    expect(POSES.map((pose) => pose.emoji)).toEqual([
      '🙌',
      '✈️',
      '💪',
      '☝️',
      '⭐',
    ]);
  });

  it('builds complete 33-landmark templates inside normalized space', () => {
    for (const pose of POSES) {
      expect(pose.template).toHaveLength(33);
      for (const lm of pose.template) {
        expect(Number.isFinite(lm.x)).toBe(true);
        expect(Number.isFinite(lm.y)).toBe(true);
        expect(lm.x).toBeGreaterThanOrEqual(0);
        expect(lm.x).toBeLessThanOrEqual(1);
        expect(lm.y).toBeGreaterThanOrEqual(0);
        expect(lm.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('each template scores 1.0 against its own target angles', () => {
    for (const pose of POSES) {
      expect(poseMatchScore(pose.template, pose.targetAngles)).toBeCloseTo(
        1,
        9,
      );
    }
  });

  it('every pose scores below the match threshold against every other pose', () => {
    let worst = 0;
    let worstPair = '';
    for (const row of POSES) {
      for (const col of POSES) {
        if (row.id === col.id) continue;
        const score = poseMatchScore(row.template, col.targetAngles);
        if (score > worst) {
          worst = score;
          worstPair = `${row.id} vs ${col.id}`;
        }
        expect(
          score,
          `${row.id} template vs ${col.id} target`,
        ).toBeLessThan(DANCE.matchThreshold);
      }
    }
    expect(worst, `worst pair ${worstPair}`).toBeLessThan(
      DANCE.matchThreshold,
    );
  });

  it('T-pose vs Arms Up is far apart in both directions', () => {
    const armsUp = poseById('arms-up');
    const tPose = poseById('t-pose');
    expect(poseMatchScore(tPose.template, armsUp.targetAngles)).toBeLessThan(
      0.7,
    );
    expect(poseMatchScore(armsUp.template, tPose.targetAngles)).toBeLessThan(
      0.7,
    );
  });

  it('Star Jump is distinguishable from Arms Up and T-pose', () => {
    const armsUp = poseById('arms-up');
    const tPose = poseById('t-pose');
    const star = poseById('star-jump');
    for (const other of [armsUp, tPose]) {
      expect(
        poseMatchScore(star.template, other.targetAngles),
        `star vs ${other.id}`,
      ).toBeLessThan(DANCE.matchThreshold);
      expect(
        poseMatchScore(other.template, star.targetAngles),
        `${other.id} vs star`,
      ).toBeLessThan(DANCE.matchThreshold);
    }
  });

  it('targetAnglesFor lists only the defining joints', () => {
    expect(Object.keys(targetAnglesFor(POSE_DEFINITIONS[0])).sort()).toEqual([
      'leftHip',
      'leftShoulder',
      'rightShoulder',
    ]);
    expect(Object.keys(targetAnglesFor(POSE_DEFINITIONS[2])).sort()).toEqual([
      'leftElbow',
      'leftShoulder',
      'rightElbow',
      'rightShoulder',
    ]);
    // Star Jump: shoulders + hips, but NOT knees — knees are straight in
    // every pose, so they carry no signal (see poses.ts header).
    expect(Object.keys(targetAnglesFor(POSE_DEFINITIONS[4])).sort()).toEqual([
      'leftHip',
      'leftShoulder',
      'rightHip',
      'rightShoulder',
    ]);
  });

  it('targetAnglesFor agrees with jointAngles() on the scored joints', () => {
    for (const def of POSE_DEFINITIONS) {
      const template = buildPoseTemplate(def);
      const all = jointAngles(template);
      const target = targetAnglesFor(def);
      for (const joint of def.scoredJoints) {
        expect(target[joint]).toBeCloseTo(all[joint], 9);
      }
    }
  });

  it('Hands on Hips wrists land on the hips', () => {
    const pose = poseById('hands-on-hips');
    const t = pose.template;
    for (const [wristIdx, hipIdx] of [
      [PoseLandmark.LEFT_WRIST, PoseLandmark.LEFT_HIP],
      [PoseLandmark.RIGHT_WRIST, PoseLandmark.RIGHT_HIP],
    ] as const) {
      const wrist = t[wristIdx];
      const hip = t[hipIdx];
      expect(wrist).toBeDefined();
      expect(hip).toBeDefined();
      if (wrist === undefined || hip === undefined) continue;
      expect(Math.hypot(wrist.x - hip.x, wrist.y - hip.y)).toBeLessThan(0.09);
    }
  });

  it('buildPoseTemplate is deterministic', () => {
    const a = buildDancePose(POSE_DEFINITIONS[1]);
    const b = buildDancePose(POSE_DEFINITIONS[1]);
    expect(a).toEqual(b);
    expect(buildPoseTemplate(POSE_DEFINITIONS[3])).toEqual(
      buildPoseTemplate(POSE_DEFINITIONS[3]),
    );
  });

  it('pickNextPose never repeats the previous pose', () => {
    for (const previous of POSES) {
      for (let i = 0; i < 20; i += 1) {
        expect(pickNextPose(previous).id).not.toBe(previous.id);
      }
    }
    // Deterministic with a stub random: 0 picks the first candidate.
    expect(pickNextPose(null, () => 0).id).toBe('arms-up');
    expect(pickNextPose(poseById('arms-up'), () => 0).id).toBe('t-pose');
    expect(pickNextPose(null, () => 0.999).id).toBe('star-jump');
  });
});

describe('helpers', () => {
  it('fallSpeedForRound rises by the per-round bump', () => {
    expect(fallSpeedForRound(0)).toBe(DANCE.fallSpeedPxPerSec);
    expect(fallSpeedForRound(1)).toBe(
      DANCE.fallSpeedPxPerSec + DANCE.fallSpeedAddPerRound,
    );
    expect(fallSpeedForRound(DANCE.roundsPerGame - 1)).toBe(
      DANCE.fallSpeedPxPerSec +
        DANCE.fallSpeedAddPerRound * (DANCE.roundsPerGame - 1),
    );
  });

  it('gradeHold needs a strong match AND a centred target for Perfect', () => {
    const zone = zoneGeometry(480);
    expect(gradeHold(0.9, 400, zone.top, zone.bottom)).toBe('perfect');
    expect(gradeHold(0.88, 400, zone.top, zone.bottom)).toBe('perfect');
    expect(gradeHold(0.9, 359, zone.top, zone.bottom)).toBe('perfect');
    expect(gradeHold(0.9, 429, zone.top, zone.bottom)).toBe('perfect');
    expect(gradeHold(0.9, 358, zone.top, zone.bottom)).toBe('good');
    expect(gradeHold(0.9, 430, zone.top, zone.bottom)).toBe('good');
    expect(gradeHold(0.87, 400, zone.top, zone.bottom)).toBe('good');
    expect(gradeHold(0.72, 400, zone.top, zone.bottom)).toBe('good');
  });

  it('zoneGeometry is the configured band near the canvas bottom', () => {
    const zone = zoneGeometry(480);
    expect(zone.height).toBe(DANCE.zoneHeightPx);
    expect(zone.bottom).toBe(464);
    expect(zone.top).toBe(464 - DANCE.zoneHeightPx);
  });

  it('targetBox is centred and ~45% of canvas height tall', () => {
    const box = targetBox(640, 480, 100);
    expect(box.height).toBeCloseTo(480 * 0.45, 9);
    expect(box.width).toBeCloseTo(box.height * 0.6, 9);
    expect(box.x).toBeCloseTo((640 - box.width) / 2, 9);
    expect(box.y).toBe(100);
  });

  it('PoseHoldTracker completes after the hold time above threshold', () => {
    const tracker = new PoseHoldTracker();
    expect(tracker.update(0.5, 10000)).toBe(false);
    expect(tracker.holdSeconds).toBe(0);
    expect(tracker.update(0.8, 300)).toBe(false);
    expect(tracker.update(0.8, 300)).toBe(true);
    expect(tracker.holdSeconds).toBeCloseTo(BODY.poseHoldSeconds, 9);
  });

  it('PoseHoldTracker resets when the score dips below threshold', () => {
    const tracker = new PoseHoldTracker();
    expect(tracker.update(0.8, 300)).toBe(false);
    expect(tracker.update(0.0, 100)).toBe(false);
    expect(tracker.holdSeconds).toBe(0);
    // Only 0.3s since the reset: not yet a hold.
    expect(tracker.update(0.8, 300)).toBe(false);
    expect(tracker.update(0.8, 300)).toBe(true);
  });
});

describe('DanceDropGame', () => {
  function startedGame(): { game: DanceDropGame; calls: string[] } {
    const { sfx, calls } = makeSfx();
    const game = new DanceDropGame(sfx);
    game.start();
    game.render(makeCtx(), 0, null, null);
    return { game, calls };
  }

  it('starts at round 1 with zero score', () => {
    const { game } = startedGame();
    expect(game.id).toBe('dance-drop');
    expect(game.title).toBe('Dance Pose Drop');
    expect(game.paused).toBe(false);
    expect(game.hudHtml()).toContain('⭐ Score 0');
    expect(game.hudHtml()).toContain('🎵 Round 1/8');
    expect(game.hudHtml()).toContain('✨ Perfect x0');
  });

  it('pause blocks updates and resume unblocks them', () => {
    const { game, calls } = startedGame();
    game.pause();
    expect(game.paused).toBe(true);
    game.update(20000, 1000, null, null);
    expect(calls).toEqual([]);
    expect(game.hudHtml()).toContain('Round 1/8');
    game.resume();
    expect(game.paused).toBe(false);
    game.update(20000, 2000, null, null);
    expect(calls).toEqual(['feedback:miss']);
  });

  it('restart resets score and round after a miss', () => {
    const { game } = startedGame();
    driveMiss(game, 1000);
    expect(game.hudHtml()).toContain('Round 2/8');
    game.restart();
    expect(game.hudHtml()).toContain('Round 1/8');
    expect(game.hudHtml()).toContain('Score 0');
    expect(game.hudHtml()).toContain('Perfect x0');
  });

  it('scores Perfect for a held matching pose in the zone centre', () => {
    const { game, calls } = startedGame();
    drivePerfect(game, 0);
    expect(calls).toContain('feedback:perfect');
    expect(game.hudHtml()).toContain(`Score ${DANCE.pointsPerfect}`);
    expect(game.hudHtml()).toContain('Perfect x1');
    expect(game.hudHtml()).toContain('Round 2/8');
  });

  it('does not score a wrong pose, then misses', () => {
    const { game, calls } = startedGame();
    game.update(5200, 5200, null, null);
    const wrong = POSES.find((pose) => pose.id !== game.currentPose.id);
    if (wrong === undefined) throw new Error('expected a wrong pose');
    for (let i = 1; i <= 10; i += 1) {
      game.update(100, 5200 + i * 100, null, wrong.template);
    }
    expect(calls).toEqual([]);
    expect(game.hudHtml()).toContain('Score 0');
    game.update(20000, 7000, null, null);
    expect(calls).toEqual(['feedback:miss']);
  });

  it('misses when the target falls through unscored', () => {
    const { game, calls } = startedGame();
    game.update(20000, 1000, null, null);
    expect(calls).toEqual(['feedback:miss']);
    expect(game.hudHtml()).toContain('Score 0');
    game.update(100, 3000, null, null);
    expect(game.hudHtml()).toContain('Round 2/8');
  });

  it('plays 8 rounds then shows results, with no win without a Perfect', () => {
    const { game, calls } = startedGame();
    let nowMs = 0;
    for (let i = 0; i < DANCE.roundsPerGame; i += 1) {
      nowMs = driveMiss(game, nowMs);
    }
    expect(calls.filter((call) => call === 'feedback:miss')).toHaveLength(8);
    expect(calls).not.toContain('win');
    expect(game.hudHtml()).toContain('Round 8/8');
    expect(game.hudHtml()).toContain('Score 0');
    // Updates after results change nothing.
    const before = calls.length;
    game.update(20000, nowMs + 5000, null, null);
    expect(calls).toHaveLength(before);
  });

  it('plays a Perfect then misses to results and calls win once', () => {
    const { game, calls } = startedGame();
    let nowMs = drivePerfect(game, 0);
    for (let i = 1; i < DANCE.roundsPerGame; i += 1) {
      nowMs = driveMiss(game, nowMs);
    }
    expect(calls).toContain('feedback:perfect');
    expect(calls.filter((call) => call === 'feedback:miss')).toHaveLength(7);
    expect(calls.filter((call) => call === 'win')).toHaveLength(1);
    expect(game.hudHtml()).toContain('Round 8/8');
    expect(game.hudHtml()).toContain(`Score ${DANCE.pointsPerfect}`);
    expect(game.hudHtml()).toContain('Perfect x1');
  });

  it('render does not throw while playing or on the results screen', () => {
    const { game } = startedGame();
    const ctx = makeCtx();
    expect(() => game.render(ctx, 0, null, null)).not.toThrow();
    expect(() =>
      game.render(ctx, 0, null, game.currentPose.template),
    ).not.toThrow();
    let nowMs = 0;
    for (let i = 0; i < DANCE.roundsPerGame; i += 1) {
      nowMs = driveMiss(game, nowMs);
    }
    expect(() => game.render(ctx, nowMs, null, null)).not.toThrow();
  });
});
