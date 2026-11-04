import { describe, expect, it } from 'vitest';
import { parseReplayClip, ReplaySource } from './replaySource';
import { makePose } from '../core/poseFixture';

function clipJson(frames: number): unknown {
  return {
    fps: 10,
    frames: Array.from({ length: frames }, () => ({
      landmarks: makePose({}),
    })),
  };
}

describe('parseReplayClip', () => {
  it('parses a valid clip', () => {
    const clip = parseReplayClip(clipJson(3));
    expect(clip.frames).toHaveLength(3);
    expect(clip.fps).toBe(10);
  });

  it('rejects a clip with no frames', () => {
    expect(() => parseReplayClip({ fps: 10, frames: [] })).toThrow(
      /at least one frame/,
    );
  });

  it('rejects a frame with the wrong landmark count', () => {
    expect(() =>
      parseReplayClip({ frames: [{ landmarks: [{ x: 0, y: 0 }] }] }),
    ).toThrow(/exactly 33 landmarks/);
  });

  it('rejects a non-object clip', () => {
    expect(() => parseReplayClip(null)).toThrow(/must be an object/);
  });
});

describe('ReplaySource', () => {
  it('returns null before start and after stop', () => {
    const source = new ReplaySource(parseReplayClip(clipJson(2)));
    expect(source.frameAt(0)).toBeNull();
    source.start(1000);
    expect(source.frameAt(1000)).not.toBeNull();
    source.stop();
    expect(source.frameAt(2000)).toBeNull();
  });

  it('advances frames with elapsed time and loops', () => {
    const source = new ReplaySource(parseReplayClip(clipJson(2)));
    source.start(0);
    // fps 10 -> 100ms per frame. Frame 0 at t=0, frame 1 at t=100, frame 0 again at t=200.
    const f0 = source.frameAt(0);
    const f1 = source.frameAt(100);
    const f2 = source.frameAt(200);
    expect(f0?.landmarks).toBeDefined();
    expect(f1?.landmarks).toBeDefined();
    expect(f2?.landmarks).toBeDefined();
    // Looping means the t=200 frame is the same object as the t=0 frame.
    expect(f2?.landmarks).toBe(f0?.landmarks);
    expect(f1?.landmarks).not.toBe(f0?.landmarks);
  });

  it('is deterministic for the same timestamp', () => {
    const source = new ReplaySource(parseReplayClip(clipJson(4)));
    source.start(500);
    const first = source.frameAt(650);
    const second = source.frameAt(650);
    expect(first?.timestampMs).toBe(second?.timestampMs);
    // Same clip frame both times — the landmarks array is shared.
    expect(first?.landmarks).toBe(second?.landmarks);
  });
});
