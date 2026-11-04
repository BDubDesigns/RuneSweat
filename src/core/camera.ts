/**
 * Camera: getUserMedia behind an explicit tap, with denial handling.
 *
 * The camera is only ever started from a user gesture ("Turn Camera On").
 * Nothing is recorded, uploaded, or sent anywhere — frames go to the
 * on-device PoseLandmarker and nowhere else.
 */

import { CAMERA } from '../core/config';

export type CameraErrorKind = 'denied' | 'unavailable' | 'insecure' | 'unknown';

/** Human-readable camera failure, for the hub status line. */
export class CameraError extends Error {
  public readonly kind: CameraErrorKind;

  public constructor(kind: CameraErrorKind, message: string) {
    super(message);
    this.name = 'CameraError';
    this.kind = kind;
  }
}

function classifyCameraError(error: unknown): CameraError {
  if (typeof globalThis !== 'undefined' && !globalThis.isSecureContext) {
    return new CameraError(
      'insecure',
      'Camera needs a secure page (https or localhost).',
    );
  }
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return new CameraError(
        'denied',
        'Camera was blocked. Tap the lock icon in the address bar to allow it, or play without a camera.',
      );
    }
    if (
      error.name === 'NotFoundError' ||
      error.name === 'OverconstrainedError'
    ) {
      return new CameraError(
        'unavailable',
        'No camera was found on this device. Try playing without a camera.',
      );
    }
  }
  return new CameraError(
    'unknown',
    'Something went wrong starting the camera. Try playing without a camera.',
  );
}

/**
 * Start the front camera. Must be called from a user gesture. Resolves with
 * a playing, muted, playsInline video element whose intrinsic size is the
 * capture size. The caller owns stopping the tracks via {@link stopCamera}.
 */
export async function startCamera(): Promise<HTMLVideoElement> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError(
      'unavailable',
      'This browser cannot access a camera. Try playing without a camera.',
    );
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: CAMERA.width },
        height: { ideal: CAMERA.height },
        facingMode: CAMERA.facingMode,
      },
      audio: false,
    });
  } catch (error) {
    throw classifyCameraError(error);
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch (error) {
    stopCamera(video);
    throw classifyCameraError(error);
  }
  return video;
}

/** Stop every track of the camera feeding `video` and detach it. */
export function stopCamera(video: HTMLVideoElement): void {
  const stream = video.srcObject;
  if (stream instanceof MediaStream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
  video.srcObject = null;
}
