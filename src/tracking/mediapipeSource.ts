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

  public constructor(options: MediaPipePoseSourceOptions) {
    this.options = options;
  }

  /** The init failure, if the model/WASM could not load. Shown in the hub. */
  public get error(): Error | null {
    return this.initError;
  }

  public get ready(): boolean {
    return this.landmarker !== null;
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

  private async init(): Promise<void> {
    const { FilesetResolver, PoseLandmarker } = await import(
      '@mediapipe/tasks-vision'
    );
    const vision = await FilesetResolver.forVisionTasks(this.options.wasmPath);
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: this.options.modelAssetPath,
          delegate: this.options.delegate,
        },
        runningMode: 'VIDEO',
        numPoses: this.options.numPoses,
      });
    } catch (error) {
      // GPU delegate fails on some devices/browsers — retry once on CPU
      // before surfacing the error. A CPU pose tracker is still playable.
      if (this.options.delegate === 'GPU' && !this.cpuFallbackTried) {
        this.cpuFallbackTried = true;
        this.landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: this.options.modelAssetPath,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numPoses: this.options.numPoses,
        });
        return;
      }
      throw error;
    }
  }

  public frameAt(nowMs: number): RawPoseFrame | null {
    if (!this.started) return null;
    if (this.landmarker === null) {
      // Still loading — no frame yet, not an error.
      return this.lastFrame;
    }
    if (nowMs - this.lastInferenceMs < this.options.inferenceMinIntervalMs) {
      return this.lastFrame;
    }
    this.lastInferenceMs = nowMs;
    const video = this.options.video;
    if (video.readyState < 2 || video.videoWidth === 0) {
      return this.lastFrame;
    }
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
    } catch {
      // A single failed inference (e.g. a torn frame) must not kill the
      // game — keep the last good frame and try again next tick.
      return this.lastFrame;
    }
    this.inferenceStats.record(nowMs);
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
