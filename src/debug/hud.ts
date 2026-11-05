/**
 * Debug HUD: FPS, inference rate, torso position, arm angles, pose-match.
 * Drawn unmirrored, after the mirrored video/skeleton pass.
 */

import { FACING, RENDER } from '../core/config';
import type { BodyState } from '../core/bodyState';

export interface HudReadout {
  fps: number;
  /** Pose inferences per second (0 when the source is not MediaPipe). */
  inferenceHz: number;
  /** Latest pose-match score, when a dance target is active (0..1). */
  poseMatchScore: number | null;
  sourceId: string;
  body: BodyState | null;
  /**
   * Pose-model diagnostics, so a playtest can tell "model didn't load"
   * from "body not seen" from "body seen, game wrong". `null` when the
   * source is not the camera (sim / replay have no model).
   */
  modelReady: boolean | null;
  /** Age of the last inference frame in ms, or null when there is none. */
  lastFrameAgeMs: number | null;
  /** Landmarks in the last inference frame (33 = a person detected). */
  landmarkCount: number | null;
  /**
   * Inference-failure signals (Nov 4, 2026 freeze: the HUD showed a
   * healthy-looking body while inference had silently stopped). All
   * optional — sim/replay and older callers leave them unset. The
   * coordinator wires these from the MediaPipe source in main.ts.
   */
  /** How many inference errors the source has counted (undefined = n/a). */
  inferenceErrors?: number;
  /** Last inference error message, truncated to ~40 chars when drawn. */
  lastInferenceError?: string | null;
  /** Active MediaPipe delegate, when the source reports one. */
  delegate?: 'GPU' | 'CPU' | null;
  /** True when the camera video's currentTime has stopped advancing. */
  videoFrozen?: boolean;
  /** Age of the video element's currentTime in ms (null = unknown). */
  videoCurrentTimeAgeMs?: number | null;
  /**
   * Measured numbers behind the last weak swing (v3), e.g.
   * "peak 2.1 torso/s, need 2.5" — the reject reason the "last swing"
   * line names, with the evidence. Optional: only the Swing Lab game
   * has one, and the coordinator wires it from the game's snapshot in
   * main.ts (`game.snapshot().lastWeakDetail`). Undefined/null draws
   * no line.
   */
  swingWeakDetail?: string | null;
}

/** Truncate a message to `maxChars`, with an ellipsis when cut. */
function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/** Draw the debug readout in the top-left corner of the canvas. */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  readout: HudReadout,
): void {
  const lines: string[] = [
    `fps ${readout.fps.toFixed(0)}  inference ${readout.inferenceHz.toFixed(1)} Hz`,
    `source ${readout.sourceId}`,
    readout.modelReady === null
      ? 'model n/a (sim/replay)'
      : `model ${readout.modelReady ? 'LOADED' : 'NOT LOADED'}` +
        (readout.lastFrameAgeMs === null
          ? '  frame: none yet'
          : `  frame age ${(readout.lastFrameAgeMs / 1000).toFixed(1)}s`) +
        (readout.landmarkCount === null
          ? ''
          : `  landmarks ${readout.landmarkCount}`) +
        (readout.delegate === undefined || readout.delegate === null
          ? ''
          : `  delegate ${readout.delegate}`),
  ];
  if (readout.inferenceErrors !== undefined) {
    lines.push(
      `inference errors ${readout.inferenceErrors}` +
        (readout.lastInferenceError === undefined ||
        readout.lastInferenceError === null
          ? ''
          : `  last: ${truncate(readout.lastInferenceError, 40)}`),
    );
  }
  if (readout.videoFrozen === true) {
    lines.push('video FROZEN');
  } else if (
    readout.videoCurrentTimeAgeMs !== undefined &&
    readout.videoCurrentTimeAgeMs !== null
  ) {
    lines.push(
      `video time age ${(readout.videoCurrentTimeAgeMs / 1000).toFixed(1)}s`,
    );
  }
  const body = readout.body;
  if (body !== null && body.present) {
    const v = body.landmarkVisibility;
    lines.push(
      `torso x ${body.torsoX.toFixed(2)} y ${body.torsoY.toFixed(2)}` +
        `  vis ${body.visibilityScore.toFixed(2)}` +
        `  usable ${body.bodyUsable ? 'YES' : 'NO'}` +
        (body.inFrame ? '' : '  OUT OF FRAME'),
      `vis LS ${v.leftShoulder.toFixed(2)} RS ${v.rightShoulder.toFixed(2)}` +
        ` LH ${v.leftHip.toFixed(2)} RH ${v.rightHip.toFixed(2)}` +
        ` LK ${v.leftKnee.toFixed(2)} RK ${v.rightKnee.toFixed(2)}` +
        (body.kneesVisible ? '' : '  knees hidden'),
      `L arm ${body.leftArm.raised ? 'UP' : '--'} ${body.leftArm.extended ? 'ext' : 'bent'} ${body.leftArm.angleDeg.toFixed(0)}°`,
      `R arm ${body.rightArm.raised ? 'UP' : '--'} ${body.rightArm.extended ? 'ext' : 'bent'} ${body.rightArm.angleDeg.toFixed(0)}°`,
      `jump ${body.jumping ? 'YES' : 'no'}  duck ${body.ducking ? 'YES' : 'no'}`,
      // Facing signal (v3): live shoulder-width ratio vs the hint
      // threshold, plus the nose-offset second signal when the nose
      // is visible — the numbers the Nov 4 t30/t66 false positives
      // were missing.
      `shoulders ${body.shoulderWidthTorsoFrac.toFixed(2)} (need ${FACING.minShoulderWidthTorsoFrac.toFixed(2)})` +
        (body.noseOffsetTorsoFrac === null
          ? '  nose n/a'
          : `  nose off ${body.noseOffsetTorsoFrac.toFixed(2)} (max ${FACING.maxNoseOffsetTorsoFrac.toFixed(2)})`),
      // Latched wrist X (v3): these are the continuity-latched
      // positions the avatar is drawn from, not the raw model labels.
      // "latch SWAPPED" means the model swapped its left/right wrist
      // labels and the latch held the physical hands steady.
      `wrists L ${body.leftWristX.toFixed(2)} R ${body.rightWristX.toFixed(2)}` +
        `  latch ${body.wristLatchSwapped ? 'SWAPPED' : 'ok'}`,
    );
  } else {
    lines.push('no person detected');
  }
  if (readout.swingWeakDetail !== undefined && readout.swingWeakDetail !== null) {
    lines.push(`last weak: ${truncate(readout.swingWeakDetail, 80)}`);
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
