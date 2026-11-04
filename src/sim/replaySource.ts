/**
 * Replay harness: plays back a recorded pose clip from a JSON fixture.
 *
 * The clip is a fixed list of frames; `frameAt()` picks the frame for the
 * elapsed time and loops (config `REPLAY.loop`). The same `nowMs` with
 * unchanged inputs yields the same frame, which is what makes the replay
 * unit-testable without a browser — and it is how a real play session can
 * be re-run against new game code later.
 */

import { REPLAY } from '../core/config';
import {
  POSE_LANDMARK_COUNT,
  type NormalizedLandmark,
  type PoseFrameSource,
  type RawPoseFrame,
} from '../tracking/poseTypes';

export interface ReplayClipFrame {
  landmarks: NormalizedLandmark[];
}

export interface ReplayClip {
  fps?: number;
  frames: ReplayClipFrame[];
}

export class ReplayParseError extends Error {}

/**
 * Validate a parsed JSON value as a replay clip. Throws ReplayParseError
 * with a specific message — never silently accept a malformed fixture.
 */
export function parseReplayClip(value: unknown): ReplayClip {
  if (typeof value !== 'object' || value === null) {
    throw new ReplayParseError('replay clip must be an object');
  }
  const record = value as Record<string, unknown>;
  const fps = record['fps'];
  if (fps !== undefined && (typeof fps !== 'number' || !(fps > 0))) {
    throw new ReplayParseError('replay clip fps must be a positive number');
  }
  const frames = record['frames'];
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new ReplayParseError('replay clip must contain at least one frame');
  }
  const parsedFrames: ReplayClipFrame[] = frames.map((frame, i) => {
    if (typeof frame !== 'object' || frame === null) {
      throw new ReplayParseError(`replay frame ${i} must be an object`);
    }
    const landmarks = (frame as Record<string, unknown>)['landmarks'];
    if (!Array.isArray(landmarks) || landmarks.length !== POSE_LANDMARK_COUNT) {
      throw new ReplayParseError(
        `replay frame ${i} must have exactly ${POSE_LANDMARK_COUNT} landmarks`,
      );
    }
    const parsed: NormalizedLandmark[] = landmarks.map((lm, j) => {
      if (typeof lm !== 'object' || lm === null) {
        throw new ReplayParseError(`replay frame ${i} landmark ${j} must be an object`);
      }
      const point = lm as Record<string, unknown>;
      const x = point['x'];
      const y = point['y'];
      if (typeof x !== 'number' || typeof y !== 'number') {
        throw new ReplayParseError(
          `replay frame ${i} landmark ${j} must have numeric x and y`,
        );
      }
      const visibility = point['visibility'];
      return {
        x,
        y,
        visibility: typeof visibility === 'number' ? visibility : 1,
      };
    });
    return { landmarks: parsed };
  });
  return {
    ...(fps !== undefined ? { fps } : {}),
    frames: parsedFrames,
  };
}

export class ReplaySource implements PoseFrameSource {
  public readonly id = 'replay';
  public readonly provenance = 'simulated' as const;

  private readonly clip: ReplayClip;
  private readonly frameIntervalMs: number;
  private running = false;
  private startedAtMs = 0;

  public constructor(clip: ReplayClip) {
    this.clip = clip;
    const fps = clip.fps ?? REPLAY.fallbackFps;
    this.frameIntervalMs = 1000 / fps;
  }

  public start(nowMs: number): void {
    this.running = true;
    this.startedAtMs = nowMs;
  }

  public stop(): void {
    this.running = false;
  }

  public frameAt(nowMs: number): RawPoseFrame | null {
    if (!this.running) return null;
    const elapsedMs = Math.max(nowMs - this.startedAtMs, 0);
    const index = Math.floor(elapsedMs / this.frameIntervalMs);
    const frameIndex = REPLAY.loop
      ? index % this.clip.frames.length
      : Math.min(index, this.clip.frames.length - 1);
    const frame = this.clip.frames[frameIndex];
    if (frame === undefined) return null;
    return {
      timestampMs: nowMs,
      landmarks: frame.landmarks,
      sourceId: this.id,
      provenance: this.provenance,
    };
  }
}
