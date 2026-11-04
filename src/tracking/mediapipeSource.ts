/**
 * Real pose source: MediaPipe PoseLandmarker running on-device.
 *
 * Inference is decoupled from render: `frameAt()` returns the latest
 * inference result and only calls `detectForVideo()` when the throttle
 * interval has elapsed. Render runs at 60 fps; inference runs at whatever
 * the device sustains (~9 Hz on the Pixel 10 Pro XL per ToyStage's
 * measurement). Games must never block on inference.
 *
 * The model + WASM are self-hosted under `public/` (see
 * `scripts/download-model.sh`). The `@mediapipe/tasks-vision` package is
 * imported lazily so the hub loads instantly and the ~1 MB WASM runtime is
 * only fetched when the camera starts.
 *
 * Two silent-freeze guards live here (Nov 4, 2026 Pixel playtest: model
 * LOADED, inference 0.0 Hz, frame age 142.2 s — exactly one inference
 * frame ever succeeded and everything ran off that stale frame):
 * - `detectForVideo()` is never called twice with the same timestamp.
 *   MediaPipe VIDEO mode requires strictly increasing timestamps, and the
 *   fixed-step loop calls `frameAt()` several times per rAF frame with the
 *   same `nowMs` on catch-up steps, so a duplicate timestamp silently
 *   kills every inference after the first.
 * - Inference failures are counted and surfaced (`lastError`,
 *   `consecutiveFailures`, `inferenceStopped`) instead of swallowed, and
 *   the source retries on the CPU delegate after
 *   `POSE.maxConsecutiveFailures` GPU failures. The video's own liveness
 *   is tracked too (`videoFrozen`, `videoCurrentTimeAgeMs`): a video whose
 *   `currentTime` stops advancing feeds the model the same frame forever.
 *
 * API verified against the installed @mediapipe/tasks-vision 1.2.2
 * `vision.d.ts` (Nov 4, 2026): `FilesetResolver.forVisionTasks`,
 * `PoseLandmarker.createFromOptions` with `baseOptions.modelAssetPath` /
 * `delegate`, `runningMode: 'VIDEO'`, `numPoses`, and
 * `detectForVideo(video, timestampMs)` returning `{ landmarks }`.
 */

import { POSE } from '../core/config';
import { assetUrl } from '../core/assetUrl';
import type {
  NormalizedLandmark,
  PoseFrameSource,
  RawPoseFrame,
} from '../tracking/poseTypes';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';

export interface MediaPipePoseSourceOptions {
  video: HTMLVideoElement;
  /**
   * e.g. `./models/pose_landmarker_lite.task` (served from public/).
   * Base-relative, never a leading-slash absolute path: the app is hosted
   * under a subpath on GitHub Pages, where `/models/...` 404s at the
   * domain root and the landmarker silently never loads.
   */
  modelAssetPath: string;
  /** e.g. `./wasm` (served from public/). Base-relative, same reason. */
  wasmPath: string;
  delegate: 'GPU' | 'CPU';
  numPoses: number;
  /** Minimum ms between inference calls. */
  inferenceMinIntervalMs: number;
  /**
   * Test seam ONLY: overrides the real `PoseLandmarker.createFromOptions`
   * path so tests can inject a fake landmarker (counting calls, throwing
   * on demand) without loading the model or WASM. Production always
   * omits it.
   */
  createLandmarker?: (
    delegate: 'GPU' | 'CPU',
  ) => Promise<PoseLandmarkerInstance>;
}

type PoseLandmarkerInstance = PoseLandmarker;

/** Rolling inference-rate measurement, surfaced in the debug HUD. */
export class InferenceStats {
  private stamps: number[] = [];

  public record(nowMs: number): void {
    this.stamps.push(nowMs);
    while (this.stamps.length > 0 && nowMs - (this.stamps[0] ?? 0) > 2000) {
      this.stamps.shift();
    }
  }

  /** Inferences per second over the last 2 seconds. */
  public get hz(): number {
    if (this.stamps.length < 2) return 0;
    const first = this.stamps[0] ?? 0;
    const last = this.stamps[this.stamps.length - 1] ?? 0;
    const spanSec = (last - first) / 1000;
    return spanSec > 0 ? (this.stamps.length - 1) / spanSec : 0;
  }

  public get count(): number {
    return this.stamps.length;
  }
}

export class MediaPipePoseSource implements PoseFrameSource {
  public readonly id = 'camera';
  public readonly provenance = 'observed' as const;

  private readonly options: MediaPipePoseSourceOptions;
  private landmarker: PoseLandmarkerInstance | null = null;
  private initPromise: Promise<void> | null = null;
  private initError: Error | null = null;
  private lastFrame: RawPoseFrame | null = null;
  private lastInferenceMs = 0;
  private started = false;
  private cpuFallbackTried = false;
  public readonly inferenceStats = new InferenceStats();

  /**
   * Timestamp of the last `detectForVideo()` attempt. MediaPipe VIDEO
   * mode requires strictly monotonically increasing timestamps — a
   * repeat or a step backwards must never reach the landmarker.
   */
  private lastAttemptedTs = 0;

  /** Most recent inference failure, if any. Cleared by a success. */
  private lastInferenceError: Error | null = null;
  /** Failures since the last success (or the last delegate switch). */
  private failureCount = 0;
  /** Which delegate the live landmarker runs on. */
  private currentDelegate: 'GPU' | 'CPU';
  /**
   * True once the CPU landmarker has also failed
   * `POSE.maxConsecutiveFailures` times in a row (or a CPU re-init
   * itself failed): inference is dead and `frameAt()` stops attempting
   * it. A `stop()` + `start()` cycle is the way back.
   */
  private stopped = false;
  /** In-flight GPU -> CPU re-init, so concurrent failures trigger one. */
  private reinitPromise: Promise<void> | null = null;

  /** Video liveness: `currentTime` as last observed, and when it moved. */
  private lastVideoCurrentTime: number | null = null;
  private lastVideoCurrentTimeChangeMs: number | null = null;
  private lastLivenessCheckMs: number | null = null;
  private videoLive = false;
  /** True once `video.play()` has been retried for the current stall. */
  private playRetryDone = false;

  public constructor(options: MediaPipePoseSourceOptions) {
    this.options = options;
    this.currentDelegate = options.delegate;
  }

  /** The init failure, if the model/WASM could not load. Shown in the hub. */
  public get error(): Error | null {
    return this.initError;
  }

  public get ready(): boolean {
    return this.landmarker !== null;
  }

  /** The most recent inference error, or null after a success. */
  public get lastError(): Error | null {
    return this.lastInferenceError;
  }

  /** Consecutive failed inferences since the last success. */
  public get consecutiveFailures(): number {
    return this.failureCount;
  }

  /** Which delegate the live landmarker runs on. */
  public get delegateInUse(): 'GPU' | 'CPU' {
    return this.currentDelegate;
  }

  /** True when inference has given up (see `stopped` above). */
  public get inferenceStopped(): boolean {
    return this.stopped;
  }

  /**
   * True when the live video's `currentTime` has not advanced for more
   * than `POSE.videoFrozenMs`. A frozen video feeds the model the same
   * frame forever, however healthy the model looks.
   */
  public get videoFrozen(): boolean {
    const ageMs = this.videoCurrentTimeAgeMs;
    return (
      this.videoLive && ageMs !== null && ageMs > POSE.videoFrozenMs
    );
  }

  /**
   * ms since `video.currentTime` last advanced, as of the most recent
   * `frameAt()` call; null before the first observation of a live video.
   */
  public get videoCurrentTimeAgeMs(): number | null {
    if (
      this.lastVideoCurrentTimeChangeMs === null ||
      this.lastLivenessCheckMs === null
    ) {
      return null;
    }
    return this.lastLivenessCheckMs - this.lastVideoCurrentTimeChangeMs;
  }

  /**
   * Diagnostics for the debug HUD / gate screen: timestamp of the last
   * inference frame, and how many landmarks it carried (33 when a person
   * was detected, 0 when none was). Lets a playtest tell "model didn't
   * load" from "body not seen" from "body seen, game wrong".
   */
  public get lastFrameTimestampMs(): number | null {
    return this.lastFrame === null ? null : this.lastFrame.timestampMs;
  }

  public get lastLandmarkCount(): number {
    return this.lastFrame?.landmarks?.length ?? 0;
  }

  public start(nowMs: number): void {
    this.started = true;
    this.lastInferenceMs = nowMs;
    // A restart is a fresh attempt: clear the stopped state and the
    // failure record from the previous run.
    this.stopped = false;
    this.failureCount = 0;
    this.lastInferenceError = null;
    this.lastAttemptedTs = 0;
    this.lastVideoCurrentTime = null;
    this.lastVideoCurrentTimeChangeMs = null;
    this.lastLivenessCheckMs = null;
    this.videoLive = false;
    this.playRetryDone = false;
    if (this.initPromise === null) {
      this.initPromise = this.init().catch((error: unknown) => {
        this.initError =
          error instanceof Error ? error : new Error(String(error));
      });
    }
  }

  public stop(): void {
    this.started = false;
    this.lastFrame = null;
    if (this.landmarker !== null) {
      this.landmarker.close();
      this.landmarker = null;
    }
    this.initPromise = null;
  }

  /** Create a landmarker on `delegate`, via the injected factory in tests. */
  private async buildLandmarker(
    delegate: 'GPU' | 'CPU',
  ): Promise<PoseLandmarkerInstance> {
    if (this.options.createLandmarker !== undefined) {
      return this.options.createLandmarker(delegate);
    }
    const { FilesetResolver, PoseLandmarker } = await import(
      '@mediapipe/tasks-vision'
    );
    const vision = await FilesetResolver.forVisionTasks(this.options.wasmPath);
    return PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: this.options.modelAssetPath,
        delegate,
      },
      runningMode: 'VIDEO',
      numPoses: this.options.numPoses,
    });
  }

  private async init(): Promise<void> {
    // A fresh attempt clears a stale init failure: a model that failed
    // to load once must not keep the hub reporting "failed" after a
    // later attempt succeeds.
    this.initError = null;
    try {
      this.landmarker = await this.buildLandmarker(this.options.delegate);
      this.currentDelegate = this.options.delegate;
    } catch (error) {
      // GPU delegate fails on some devices/browsers — retry once on CPU
      // before surfacing the error. A CPU pose tracker is still playable.
      if (this.options.delegate === 'GPU' && !this.cpuFallbackTried) {
        this.cpuFallbackTried = true;
        this.landmarker = await this.buildLandmarker('CPU');
        this.currentDelegate = 'CPU';
        return;
      }
      throw error;
    }
  }

  /**
   * Close the GPU landmarker and re-create it on the CPU delegate after
   * `POSE.maxConsecutiveFailures` GPU inference failures. Async: while
   * it runs, `frameAt()` keeps returning the last frame. A failed
   * re-init is terminal — there is no delegate left to fall back to.
   */
  private reinitOnCpu(): Promise<void> {
    if (this.reinitPromise !== null) {
      return this.reinitPromise;
    }
    this.reinitPromise = (async () => {
      try {
        if (this.landmarker !== null) {
          this.landmarker.close();
          this.landmarker = null;
        }
        this.landmarker = await this.buildLandmarker('CPU');
        this.currentDelegate = 'CPU';
        // A successful recovery clears a stale init failure.
        this.initError = null;
      } catch (error) {
        const failure =
          error instanceof Error ? error : new Error(String(error));
        this.lastInferenceError = failure;
        this.initError = failure;
        this.stopped = true;
      } finally {
        this.reinitPromise = null;
      }
    })();
    return this.reinitPromise;
  }

  /**
   * Track whether the video is actually advancing. Called on every
   * `frameAt()` while the video is live. A paused video gets one
   * best-effort `play()` retry per stall (a new stall starts when
   * `currentTime` advances again).
   */
  private updateVideoLiveness(nowMs: number): void {
    const video = this.options.video;
    this.videoLive = true;
    this.lastLivenessCheckMs = nowMs;
    const currentTime = video.currentTime;
    if (
      this.lastVideoCurrentTime === null ||
      currentTime !== this.lastVideoCurrentTime
    ) {
      this.lastVideoCurrentTime = currentTime;
      this.lastVideoCurrentTimeChangeMs = nowMs;
      // Time advanced: a new stall window, so a fresh play() retry is
      // allowed if the video pauses again.
      this.playRetryDone = false;
    }
    if (video.paused && !this.playRetryDone) {
      this.playRetryDone = true;
      try {
        const playResult = video.play();
        if (playResult !== undefined) {
          void playResult.catch(() => {
            // Best-effort resume: a rejection just means the video is
            // still paused; the next stall window retries.
          });
        }
      } catch {
        // play() throwing synchronously is not fatal — inference keeps
        // running on the last frame.
      }
    }
  }

  public frameAt(nowMs: number): RawPoseFrame | null {
    if (!this.started || this.stopped) return this.lastFrame;
    if (this.landmarker === null) {
      // Still loading — no frame yet, not an error.
      return this.lastFrame;
    }
    const video = this.options.video;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      this.updateVideoLiveness(nowMs);
    }
    if (nowMs - this.lastInferenceMs < this.options.inferenceMinIntervalMs) {
      return this.lastFrame;
    }
    this.lastInferenceMs = nowMs;
    if (video.readyState < 2 || video.videoWidth === 0) {
      return this.lastFrame;
    }
    if (nowMs <= this.lastAttemptedTs) {
      // MediaPipe VIDEO mode requires strictly increasing timestamps.
      // The fixed-step loop calls frameAt() several times per rAF frame
      // with the same nowMs on catch-up steps; a duplicate timestamp
      // silently kills every inference after the first, so skip the call
      // and keep the last frame.
      return this.lastFrame;
    }
    this.lastAttemptedTs = nowMs;
    let landmarks: NormalizedLandmark[] | null = null;
    try {
      const result = this.landmarker.detectForVideo(video, nowMs);
      const first = result.landmarks[0];
      if (first !== undefined && first.length > 0) {
        landmarks = first.map((lm) => ({
          x: lm.x,
          y: lm.y,
          z: lm.z,
          visibility: lm.visibility,
        }));
      }
    } catch (error) {
      const failure =
        error instanceof Error ? error : new Error(String(error));
      this.lastInferenceError = failure;
      this.failureCount += 1;
      if (this.failureCount >= POSE.maxConsecutiveFailures) {
        if (this.currentDelegate === 'GPU') {
          // Failures against the fresh CPU landmarker count from zero.
          // The re-init runs async; frameAt() keeps returning the last
          // frame until it lands.
          this.failureCount = 0;
          void this.reinitOnCpu();
        } else {
          // CPU also failed maxConsecutiveFailures times: stop
          // attempting inference and keep lastError for the HUD.
          this.stopped = true;
        }
      }
      return this.lastFrame;
    }
    this.inferenceStats.record(nowMs);
    this.failureCount = 0;
    this.lastInferenceError = null;
    // A successful inference proves the model is alive again: a stale
    // init failure must not keep the hub reporting "model failed".
    this.initError = null;
    this.lastFrame = {
      timestampMs: nowMs,
      landmarks,
      sourceId: this.id,
      provenance: this.provenance,
    };
    return this.lastFrame;
  }
}

/** Default options from config.ts (the SSOT). Paths are base-relative via
 * `assetUrl` — never leading-slash absolute — so they resolve under the
 * app's subpath on GitHub Pages as well as at the localhost root. */
export function defaultMediaPipeOptions(
  video: HTMLVideoElement,
): MediaPipePoseSourceOptions {
  const modelFile =
    POSE.variant === 'full' ? POSE.fullModelFile : POSE.liteModelFile;
  return {
    video,
    modelAssetPath: assetUrl(`models/${modelFile}`),
    wasmPath: assetUrl(POSE.wasmPath),
    delegate: POSE.delegate,
    numPoses: POSE.numPoses,
    inferenceMinIntervalMs: POSE.inferenceMinIntervalMs,
  };
}
