import { describe, expect, it, vi } from 'vitest';
import { POSE } from '../core/config';
import {
  defaultMediaPipeOptions,
  MediaPipePoseSource,
  type MediaPipePoseSourceOptions,
} from './mediapipeSource';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';

/**
 * The Nov 4, 2026 live-site failure: model + WASM were loaded from
 * absolute paths (`/models/...`, `/wasm`), which 404 under the
 * `/lara-pose-games/` subpath on GitHub Pages while working on localhost
 * at the root — so PoseLandmarker never loaded and no pose frames ever
 * arrived. These tests pin the fix: base-relative paths, never a leading
 * slash.
 */
describe('defaultMediaPipeOptions paths', () => {
  it('builds base-relative model + WASM paths, never absolute ones', () => {
    const video = {} as unknown as HTMLVideoElement;
    const options = defaultMediaPipeOptions(video);
    expect(options.modelAssetPath.startsWith('/')).toBe(false);
    expect(options.wasmPath.startsWith('/')).toBe(false);
    // Vite base is './' in this repo.
    expect(options.modelAssetPath).toBe(
      './models/pose_landmarker_lite.task',
    );
    expect(options.wasmPath).toBe('./wasm');
  });

  it('points at the lite model by default', () => {
    const video = {} as unknown as HTMLVideoElement;
    const options = defaultMediaPipeOptions(video);
    expect(options.modelAssetPath).toContain('pose_landmarker_lite.task');
  });
});

// ------------------------------------------------------------------ fakes ---

/**
 * Fake video element: the source only reads readyState / videoWidth /
 * currentTime / paused and calls play(), so a plain object is enough —
 * no DOM needed.
 */
function fakeVideo(
  overrides: Partial<
    Pick<HTMLVideoElement, 'readyState' | 'videoWidth' | 'currentTime' | 'paused'>
  > = {},
): { video: HTMLVideoElement; play: ReturnType<typeof vi.fn> } {
  const play = vi.fn(() => Promise.resolve());
  const video = {
    readyState: 2,
    videoWidth: 640,
    currentTime: 0,
    paused: false,
    play,
    ...overrides,
  } as unknown as HTMLVideoElement;
  return { video, play };
}

type FakeLandmarker = {
  detectForVideo: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function landmarksResult(): {
  landmarks: { x: number; y: number; z: number; visibility: number }[][];
} {
  return {
    landmarks: [
      Array.from({ length: 33 }, () => ({
        x: 0.5,
        y: 0.5,
        z: 0,
        visibility: 0.99,
      })),
    ],
  };
}

function workingLandmarker(): FakeLandmarker {
  return {
    detectForVideo: vi.fn(() => landmarksResult()),
    close: vi.fn(),
  };
}

function throwingLandmarker(message = 'boom'): FakeLandmarker {
  return {
    detectForVideo: vi.fn(() => {
      throw new Error(message);
    }),
    close: vi.fn(),
  };
}

function makeSource(
  video: HTMLVideoElement,
  createLandmarker: NonNullable<
    MediaPipePoseSourceOptions['createLandmarker']
  >,
): MediaPipePoseSource {
  return new MediaPipePoseSource({
    video,
    modelAssetPath: './models/pose_landmarker_lite.task',
    wasmPath: './wasm',
    delegate: 'GPU',
    numPoses: 1,
    inferenceMinIntervalMs: 0,
    createLandmarker,
  });
}

async function startReady(
  source: MediaPipePoseSource,
  nowMs = 0,
): Promise<void> {
  source.start(nowMs);
  await vi.waitFor(() => {
    expect(source.ready).toBe(true);
  });
}

/**
 * Fix 1 — the Nov 4, 2026 Pixel playtest: model LOADED, inference 0.0 Hz,
 * frame age 142.2 s. The fixed-step loop calls frameAt() several times per
 * rAF frame with the same nowMs on catch-up steps, and MediaPipe VIDEO
 * mode requires strictly increasing timestamps — so every inference after
 * the first was silently rejected and the game ran off one stale frame.
 */
describe('duplicate timestamps (Fix 1)', () => {
  it('calls detectForVideo exactly once for repeated frameAt calls with the same timestamp', async () => {
    const { video } = fakeVideo();
    const landmarker = workingLandmarker();
    const source = makeSource(
      video,
      () => Promise.resolve(landmarker as unknown as PoseLandmarker),
    );
    await startReady(source);

    source.frameAt(1000);
    source.frameAt(1000);
    source.frameAt(1000);
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(1);

    // A strictly later timestamp is a new attempt.
    source.frameAt(1001);
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(2);

    // A step backwards never reaches the landmarker either.
    source.frameAt(1000);
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(2);
  });

  it('passes the frameAt timestamp through as the detectForVideo timestamp', async () => {
    const { video } = fakeVideo();
    const landmarker = workingLandmarker();
    const source = makeSource(
      video,
      () => Promise.resolve(landmarker as unknown as PoseLandmarker),
    );
    await startReady(source);

    source.frameAt(1000);
    expect(landmarker.detectForVideo).toHaveBeenCalledWith(video, 1000);
  });
});

/**
 * Fix 2 — inference errors used to be swallowed: frameAt() caught every
 * detectForVideo throw and returned the last frame with no record, so a
 * dead model looked identical to a healthy one in the HUD.
 */
describe('inference failure tracking + delegate retry (Fix 2)', () => {
  it('counts consecutive failures and surfaces the last error', async () => {
    const { video } = fakeVideo();
    const landmarker = throwingLandmarker('torn frame');
    const source = makeSource(
      video,
      () => Promise.resolve(landmarker as unknown as PoseLandmarker),
    );
    await startReady(source);

    expect(source.frameAt(1000)).toBeNull();
    expect(source.consecutiveFailures).toBe(1);
    expect(source.lastError?.message).toBe('torn frame');
    expect(source.inferenceStopped).toBe(false);

    source.frameAt(1016);
    source.frameAt(1032);
    expect(source.consecutiveFailures).toBe(3);
    expect(source.lastError?.message).toBe('torn frame');
    expect(source.inferenceStopped).toBe(false);
  });

  it('a successful inference resets the failure counter and clears lastError', async () => {
    const { video } = fakeVideo();
    let failuresLeft = 3;
    const landmarker: FakeLandmarker = {
      detectForVideo: vi.fn(() => {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          throw new Error('flaky');
        }
        return landmarksResult();
      }),
      close: vi.fn(),
    };
    const source = makeSource(
      video,
      () => Promise.resolve(landmarker as unknown as PoseLandmarker),
    );
    await startReady(source);

    source.frameAt(1000);
    source.frameAt(1016);
    source.frameAt(1032);
    expect(source.consecutiveFailures).toBe(3);
    expect(source.lastError?.message).toBe('flaky');

    const frame = source.frameAt(1048);
    expect(frame).not.toBeNull();
    expect(frame?.landmarks).toHaveLength(33);
    expect(source.consecutiveFailures).toBe(0);
    expect(source.lastError).toBeNull();
  });

  it('retries on the CPU delegate after maxConsecutiveFailures GPU failures', async () => {
    const { video } = fakeVideo();
    const gpu = throwingLandmarker('gpu boom');
    const cpu = workingLandmarker();
    const factoryCalls: Array<'GPU' | 'CPU'> = [];
    const source = makeSource(video, (delegate) => {
      factoryCalls.push(delegate);
      return Promise.resolve(
        (delegate === 'GPU' ? gpu : cpu) as unknown as PoseLandmarker,
      );
    });
    await startReady(source);
    expect(source.delegateInUse).toBe('GPU');

    for (let i = 0; i < POSE.maxConsecutiveFailures; i++) {
      source.frameAt(1000 + i * 16);
    }
    // Failures against the fresh CPU landmarker count from zero.
    expect(source.consecutiveFailures).toBe(0);
    expect(gpu.detectForVideo).toHaveBeenCalledTimes(
      POSE.maxConsecutiveFailures,
    );

    await vi.waitFor(() => {
      expect(source.delegateInUse).toBe('CPU');
    });
    expect(factoryCalls).toEqual(['GPU', 'CPU']);
    expect(gpu.close).toHaveBeenCalledTimes(1);

    // A success on the CPU landmarker clears the error.
    const frame = source.frameAt(2000);
    expect(frame).not.toBeNull();
    expect(frame?.landmarks).toHaveLength(33);
    expect(source.lastError).toBeNull();
    expect(source.consecutiveFailures).toBe(0);
    expect(source.inferenceStopped).toBe(false);
  });

  it('stops inferring when the CPU landmarker also fails maxConsecutiveFailures times', async () => {
    const { video } = fakeVideo();
    const gpu = throwingLandmarker('gpu boom');
    const cpu = throwingLandmarker('cpu boom');
    const source = makeSource(video, (delegate) =>
      Promise.resolve(
        (delegate === 'GPU' ? gpu : cpu) as unknown as PoseLandmarker,
      ),
    );
    await startReady(source);

    for (let i = 0; i < POSE.maxConsecutiveFailures; i++) {
      source.frameAt(1000 + i * 16);
    }
    await vi.waitFor(() => {
      expect(source.delegateInUse).toBe('CPU');
    });
    for (let i = 0; i < POSE.maxConsecutiveFailures; i++) {
      source.frameAt(2000 + i * 16);
    }

    expect(source.inferenceStopped).toBe(true);
    expect(source.lastError?.message).toBe('cpu boom');
    expect(source.consecutiveFailures).toBe(POSE.maxConsecutiveFailures);

    // No further attempts once stopped.
    const cpuCalls = cpu.detectForVideo.mock.calls.length;
    source.frameAt(3000);
    source.frameAt(3016);
    expect(cpu.detectForVideo).toHaveBeenCalledTimes(cpuCalls);
  });

  it('a stale init error does not survive a successful restart', async () => {
    const { video } = fakeVideo();
    let attempts = 0;
    const source = makeSource(video, () => {
      attempts += 1;
      // First init: GPU create fails, CPU fallback create fails too.
      if (attempts <= 2) {
        return Promise.reject(new Error('model 404'));
      }
      return Promise.resolve(
        workingLandmarker() as unknown as PoseLandmarker,
      );
    });

    source.start(0);
    await vi.waitFor(() => {
      expect(source.error?.message).toBe('model 404');
    });
    expect(source.ready).toBe(false);

    source.stop();
    await startReady(source, 0);
    expect(source.error).toBeNull();
    const frame = source.frameAt(1000);
    expect(frame).not.toBeNull();
    expect(source.error).toBeNull();
  });
});

/**
 * Fix 5 — a detached video can stall on Android Chrome, and a video whose
 * currentTime stops advancing feeds the model the same frame forever.
 * The source tracks currentTime advancement and retries play() once per
 * stall while paused. (The DOM attach/detach in camera.ts itself has no
 * DOM in this node test env — it is unverifiable here.)
 */
describe('video liveness (Fix 5)', () => {
  it('reports a frozen video when currentTime stops advancing', async () => {
    const { video } = fakeVideo();
    const landmarker = workingLandmarker();
    const source = makeSource(
      video,
      () => Promise.resolve(landmarker as unknown as PoseLandmarker),
    );
    await startReady(source);

    expect(source.videoCurrentTimeAgeMs).toBeNull();
    expect(source.videoFrozen).toBe(false);

    source.frameAt(1000);
    expect(source.videoCurrentTimeAgeMs).toBe(0);
    expect(source.videoFrozen).toBe(false);

    source.frameAt(1000 + POSE.videoFrozenMs - 1);
    expect(source.videoCurrentTimeAgeMs).toBe(POSE.videoFrozenMs - 1);
    expect(source.videoFrozen).toBe(false);

    source.frameAt(1000 + POSE.videoFrozenMs + 1);
    expect(source.videoCurrentTimeAgeMs).toBe(POSE.videoFrozenMs + 1);
    expect(source.videoFrozen).toBe(true);
  });

  it('unfreezes when currentTime advances again', async () => {
    const { video } = fakeVideo();
    const landmarker = workingLandmarker();
    const source = makeSource(
      video,
      () => Promise.resolve(landmarker as unknown as PoseLandmarker),
    );
    await startReady(source);

    source.frameAt(1000);
    source.frameAt(1000 + POSE.videoFrozenMs + 100);
    expect(source.videoFrozen).toBe(true);

    video.currentTime = 0.5;
    source.frameAt(1000 + POSE.videoFrozenMs + 116);
    expect(source.videoCurrentTimeAgeMs).toBe(0);
    expect(source.videoFrozen).toBe(false);
  });

  it('retries video.play() once per stall while paused', async () => {
    const { video, play } = fakeVideo({ paused: true });
    const landmarker = workingLandmarker();
    const source = makeSource(
      video,
      () => Promise.resolve(landmarker as unknown as PoseLandmarker),
    );
    await startReady(source);

    source.frameAt(1000);
    expect(play).toHaveBeenCalledTimes(1);

    // Still paused, still the same stall: no further retries.
    source.frameAt(1016);
    source.frameAt(1032);
    expect(play).toHaveBeenCalledTimes(1);

    // currentTime advances: a new stall window, so play() is retried.
    video.currentTime = 0.5;
    source.frameAt(1048);
    expect(play).toHaveBeenCalledTimes(2);
  });
});
