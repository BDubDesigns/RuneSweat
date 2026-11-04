/**
 * Canvas 2D renderer: mirrored video + skeleton + stickman.
 *
 * Mirroring rule (same as the Spider-Man repo): the video is mirrored in
 * code with `setTransform(-1, 0, 0, 1, w, 0)` and landmarks go through
 * `toCanvas()`. The transform is cleared before any HUD text is drawn, so
 * HUD text is never mirrored. Nothing here uses CSS `scaleX(-1)`.
 */

import { RENDER } from '../core/config';
import { toCanvas, type Vec2 } from './stage';
import {
  PoseLandmark,
  SKELETON_CONNECTIONS,
  type NormalizedLandmark,
} from '../tracking/poseTypes';

/** Draw the video frame mirrored, filling the canvas. */
export function drawVideoMirrored(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.setTransform(-1, 0, 0, 1, width, 0);
  ctx.drawImage(video, 0, 0, width, height);
  ctx.restore();
}

/** Fill the stage when there is no video (sim / replay mode). */
export function drawStageBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.fillStyle = RENDER.stageColor;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function canvasPoint(
  lm: NormalizedLandmark,
  width: number,
  height: number,
): Vec2 {
  return toCanvas(lm, width, height);
}

/** Draw the skeleton connections + joint dots for one pose. */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly NormalizedLandmark[],
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.strokeStyle = RENDER.skeletonColor;
  ctx.lineWidth = RENDER.skeletonLineWidthPx;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [a, b] of SKELETON_CONNECTIONS) {
    const la = landmarks[a];
    const lb = landmarks[b];
    if (la === undefined || lb === undefined) continue;
    const pa = canvasPoint(la, width, height);
    const pb = canvasPoint(lb, width, height);
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
  }
  ctx.stroke();

  // Joint dots: left side blue, right side orange, centre white.
  for (let i = 0; i < landmarks.length; i += 1) {
    const lm = landmarks[i];
    if (lm === undefined) continue;
    const p = canvasPoint(lm, width, height);
    ctx.fillStyle = jointColor(i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, RENDER.landmarkRadiusPx, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function jointColor(index: number): string {
  const leftSide: ReadonlySet<number> = new Set([
    PoseLandmark.LEFT_EYE,
    PoseLandmark.LEFT_EAR,
    PoseLandmark.LEFT_SHOULDER,
    PoseLandmark.LEFT_ELBOW,
    PoseLandmark.LEFT_WRIST,
    PoseLandmark.LEFT_HIP,
    PoseLandmark.LEFT_KNEE,
    PoseLandmark.LEFT_ANKLE,
  ]);
  const rightSide: ReadonlySet<number> = new Set([
    PoseLandmark.RIGHT_EYE,
    PoseLandmark.RIGHT_EAR,
    PoseLandmark.RIGHT_SHOULDER,
    PoseLandmark.RIGHT_ELBOW,
    PoseLandmark.RIGHT_WRIST,
    PoseLandmark.RIGHT_HIP,
    PoseLandmark.RIGHT_KNEE,
    PoseLandmark.RIGHT_ANKLE,
  ]);
  if (leftSide.has(index)) return RENDER.leftColor;
  if (rightSide.has(index)) return RENDER.rightColor;
  return RENDER.torsoColor;
}

/**
 * Draw a pose as a stickman inside an arbitrary rectangle (used for the
 * falling target in Dance Pose Drop). The pose's normalized coordinates are
 * mapped into `rect`; the drawing is NOT mirrored — the target is a picture,
 * not the player.
 */
export function drawStickmanInRect(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly NormalizedLandmark[],
  rect: { x: number; y: number; width: number; height: number },
  color: string = RENDER.skeletonColor,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, rect.width / 40);
  ctx.lineCap = 'round';
  const map = (lm: NormalizedLandmark): Vec2 => ({
    x: rect.x + lm.x * rect.width,
    y: rect.y + lm.y * rect.height,
  });
  ctx.beginPath();
  for (const [a, b] of SKELETON_CONNECTIONS) {
    const la = landmarks[a];
    const lb = landmarks[b];
    if (la === undefined || lb === undefined) continue;
    const pa = map(la);
    const pb = map(lb);
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
  }
  ctx.stroke();
  for (const lm of landmarks) {
    const p = map(lm);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2, rect.width / 60), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
