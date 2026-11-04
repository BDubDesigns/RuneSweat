/**
 * Debug HUD: FPS, inference rate, torso position, arm angles, pose-match.
 * Drawn unmirrored, after the mirrored video/skeleton pass.
 */

import { RENDER } from '../core/config';
import type { BodyState } from '../core/bodyState';

export interface HudReadout {
  fps: number;
  /** Pose inferences per second (0 when the source is not MediaPipe). */
  inferenceHz: number;
  /** Latest pose-match score, when a dance target is active (0..1). */
  poseMatchScore: number | null;
  sourceId: string;
  body: BodyState | null;
}

/** Draw the debug readout in the top-left corner of the canvas. */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  readout: HudReadout,
): void {
  const lines: string[] = [
    `fps ${readout.fps.toFixed(0)}  inference ${readout.inferenceHz.toFixed(1)} Hz`,
    `source ${readout.sourceId}`,
  ];
  const body = readout.body;
  if (body !== null && body.present) {
    lines.push(
      `torso x ${body.torsoX.toFixed(2)} y ${body.torsoY.toFixed(2)}` +
        `  vis ${body.visibilityScore.toFixed(2)}` +
        (body.inFrame ? '' : '  OUT OF FRAME'),
      `L arm ${body.leftArm.raised ? 'UP' : '--'} ${body.leftArm.extended ? 'ext' : 'bent'} ${body.leftArm.angleDeg.toFixed(0)}°`,
      `R arm ${body.rightArm.raised ? 'UP' : '--'} ${body.rightArm.extended ? 'ext' : 'bent'} ${body.rightArm.angleDeg.toFixed(0)}°`,
      `jump ${body.jumping ? 'YES' : 'no'}  duck ${body.ducking ? 'YES' : 'no'}`,
    );
  } else {
    lines.push('no person detected');
  }
  if (readout.poseMatchScore !== null) {
    lines.push(`pose match ${(readout.poseMatchScore * 100).toFixed(0)}%`);
  }

  ctx.save();
  ctx.font = RENDER.hudFont;
  const width = Math.max(
    ...lines.map((line) => ctx.measureText(line).width),
  );
  const height =
    lines.length * RENDER.hudLineHeightPx + RENDER.hudPaddingPx * 2;
  ctx.fillStyle = RENDER.hudBackdropColor;
  ctx.fillRect(RENDER.hudPaddingPx, RENDER.hudPaddingPx, width + RENDER.hudPaddingPx * 2, height);
  ctx.fillStyle = RENDER.hudColor;
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => {
    ctx.fillText(
      line,
      RENDER.hudPaddingPx * 2,
      RENDER.hudPaddingPx + i * RENDER.hudLineHeightPx + 2,
    );
  });
  ctx.restore();
}
